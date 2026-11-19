import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { Agents } from "../src/server/agent/runner.ts";
import { AttachmentStore } from "../src/server/attachments.ts";
import { exportAll } from "../src/server/data-export.ts";
import { createApp } from "../src/server/http/app.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { ModelGateway } from "../src/server/model/gateway.ts";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "../src/server/model/testing.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import { buildPdf } from "./helpers/pdf.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

// Valid 1x1 red PNG.
const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

// biome-ignore lint/suspicious/noExplicitAny: test assertions inspect arbitrary JSON
type Json = any;

function waitForStatus(
	store: ReturnType<typeof newStore>["store"],
	sessionId: string,
	status: string,
	timeoutMs = 5000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (store.getSession(sessionId).status === status) return resolve();
			if (Date.now() - started > timeoutMs) {
				return reject(new Error(`Timed out waiting for status ${status}`));
			}
			setTimeout(tick, 20);
		};
		tick();
	});
}

describe("message attachments subsystem", () => {
	test("validates magic bytes, rejects spoofed headers and SVG, extracts dimensions and PDF pages", async () => {
		const { store } = newStore();
		const home = tempDir("yew-att-home-");
		const attachments = new AttachmentStore(store, home);
		const session = store.createSession(sessionInput("S1"));

		const img = await attachments.save(session.id, {
			name: "screen.png",
			mimeType: "image/png",
			data: TINY_PNG,
		});
		assert.equal(img.kind, "image");
		assert.equal(img.mimeType, "image/png");
		assert.equal(img.width, 1);
		assert.equal(img.height, 1);

		const pdf = await attachments.save(session.id, {
			name: "brief.pdf",
			mimeType: "application/pdf",
			data: buildPdf(["Attachment page one with enough words to extract cleanly."]),
		});
		assert.equal(pdf.kind, "pdf");
		assert.equal(pdf.pages, 1);

		// Spoofed binary bytes claiming image/png must be rejected.
		await assert.rejects(
			attachments.save(session.id, {
				name: "fake.png",
				mimeType: "image/png",
				data: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
			}),
			/unsupported|invalid/i,
		);

		// Spoofed ASCII text claiming image/png must also be rejected.
		await assert.rejects(
			attachments.save(session.id, {
				name: "fake-text.png",
				mimeType: "image/png",
				data: Buffer.from("not actually a png"),
			}),
			/unsupported|invalid/i,
		);

		// SVG is explicitly rejected whether declared as image/svg+xml or plain text.
		await assert.rejects(
			attachments.save(session.id, {
				name: "vector.svg",
				mimeType: "image/svg+xml",
				data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
			}),
			/svg/i,
		);
		await assert.rejects(
			attachments.save(session.id, {
				name: "vector.txt",
				mimeType: "text/plain",
				data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
			}),
			/svg/i,
		);
	});

	test("HTTP multipart & JSON base64 upload/download, thumbnail, and delete pending", async () => {
		const { store, bus } = newStore();
		const home = tempDir("yew-att-http-");
		const faux = fauxProvider();
		const gateway = new ModelGateway({
			keys: new MemoryKeyStore({ [faux.provider.id]: "test-key" }),
			version: "0.0.0",
			providers: [faux.provider],
		});
		const permissions = new PermissionEngine(home);
		const agents = new Agents({ store, gateway, permissions, home, version: "0.0.0" });
		const app = createApp({ store, gateway, agents, bus });
		const session = store.createSession({
			...sessionInput("HTTP"),
			provider: faux.provider.id,
			model: faux.getModel().id,
		});

		// Multipart upload (browser / Mac app).
		const form = new FormData();
		form.append("file", new File([TINY_PNG], "shot.png", { type: "image/png" }));
		const upRes = await app.request(`/api/sessions/${session.id}/attachments`, {
			method: "POST",
			body: form,
		});
		assert.equal(upRes.status, 201);
		const ref = (await upRes.json()) as Json;
		assert.equal(ref.kind, "image");
		assert.equal(ref.name, "shot.png");

		// Binary GET & JSON base64 GET (mobile Noise channel).
		const rawRes = await app.request(`/api/attachments/${ref.id}`);
		assert.equal(rawRes.status, 200);
		assert.equal(rawRes.headers.get("Content-Type"), "image/png");
		assert.equal(rawRes.headers.get("Cache-Control"), "no-store");
		assert.deepEqual(Buffer.from(await rawRes.arrayBuffer()), TINY_PNG);

		const jsonRes = await app.request(`/api/attachments/${ref.id}?thumb=1&format=json`);
		assert.equal(jsonRes.status, 200);
		const jsonBody = (await jsonRes.json()) as Json;
		assert.equal(jsonBody.mimeType, "image/png");
		assert.deepEqual(Buffer.from(jsonBody.data, "base64"), TINY_PNG);

		// JSON base64 upload (mobile Noise channel) + pending delete.
		const mobileRes = await app.request(`/api/sessions/${session.id}/attachments`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "note.txt",
				mimeType: "text/plain",
				data: Buffer.from("Hello from phone").toString("base64"),
			}),
		});
		assert.equal(mobileRes.status, 201);
		const mobileRef = (await mobileRes.json()) as Json;
		assert.equal(mobileRef.kind, "text");

		const delRes = await app.request(`/api/sessions/${session.id}/attachments/${mobileRef.id}`, {
			method: "DELETE",
		});
		assert.equal(delRes.status, 204);
		const missing = await app.request(`/api/attachments/${mobileRef.id}`);
		assert.equal(missing.status, 404);
	});

	test("hydrates images for vision models, degrades cleanly on text-only models, and scopes read_attachment", async () => {
		const { store } = newStore();
		const home = tempDir("yew-att-run-");
		const seenContexts: unknown[] = [];

		const faux = fauxProvider({
			models: [
				{ id: "vision-model", input: ["text", "image"] },
				{ id: "text-only-model", input: ["text"] },
			],
		});
		faux.setResponses([
			(ctx) => {
				seenContexts.push(ctx);
				return fauxAssistantMessage("I see the screenshot clearly.");
			},
			(ctx) => {
				seenContexts.push(ctx);
				return fauxAssistantMessage("Understood the text-only fallback.");
			},
		]);

		const gateway = new ModelGateway({
			keys: new MemoryKeyStore({ [faux.provider.id]: "test-key" }),
			version: "0.0.0",
			providers: [faux.provider],
		});
		const permissions = new PermissionEngine(home);
		const agents = new Agents({ store, gateway, permissions, home, version: "0.0.0" });

		const s1 = store.createSession({
			...sessionInput("Vision"),
			provider: faux.provider.id,
			model: "vision-model",
		});
		const imgRef = await agents.attachments.save(s1.id, {
			name: "ui.png",
			mimeType: "image/png",
			data: TINY_PNG,
		});
		const pdfRef = await agents.attachments.save(s1.id, {
			name: "contract.pdf",
			mimeType: "application/pdf",
			data: buildPdf(["Clause 1: All source code remains under MIT license."]),
		});

		// Send attachment-only message (empty text allowed when attachments present).
		agents.send(s1.id, "", [imgRef.id, pdfRef.id]);
		await waitForStatus(store, s1.id, "idle");

		const firstCtx = seenContexts[0] as { messages: Array<{ role: string; content: unknown }> };
		const firstUser = firstCtx.messages.find((m) => m.role === "user");
		assert.ok(firstUser && Array.isArray(firstUser.content));
		assert.ok(
			firstUser.content.some(
				(b: { type: string; mimeType?: string }) =>
					b.type === "image" && b.mimeType === "image/png",
			),
		);
		assert.ok(
			firstUser.content.some(
				(b: { type: string; text?: string }) =>
					b.type === "text" && b.text?.includes("All source code remains under MIT license"),
			),
		);

		// Switch same session to text-only model: image must NOT be sent as an ImageBlock, degrades to text note.
		store.updateSession(s1.id, { model: "text-only-model" });
		agents.send(s1.id, "Summarize what I sent earlier.");
		await waitForStatus(store, s1.id, "idle");

		const secondCtx = seenContexts[1] as { messages: Array<{ role: string; content: unknown }> };
		const secondUsers = secondCtx.messages.filter((m) => m.role === "user");
		const earliestUser = secondUsers[0];
		assert.ok(earliestUser && Array.isArray(earliestUser.content));
		assert.equal(
			earliestUser.content.some((b: { type: string }) => b.type === "image"),
			false,
		);
		assert.ok(
			earliestUser.content.some(
				(b: { type: string; text?: string }) =>
					b.type === "text" && b.text?.includes("the current model cannot read images"),
			),
		);

		// Cross-session read_attachment must be refused even when session 2 has attachments of its own!
		const s2 = store.createSession({
			...sessionInput("Other"),
			provider: faux.provider.id,
			model: "vision-model",
		});
		const s2Ref = await agents.attachments.save(s2.id, {
			name: "own.txt",
			mimeType: "text/plain",
			data: Buffer.from("Session 2 own note"),
		});
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read_attachment", { id: pdfRef.id })]),
			fauxAssistantMessage("Denied as expected."),
		]);
		agents.send(s2.id, "Try reading session 1 attachment", [s2Ref.id]);
		await waitForStatus(store, s2.id, "idle");
		const toolResultEntry = store.allEntries(s2.id).find((e) => e.role === "toolResult");
		assert.ok(toolResultEntry && toolResultEntry.role === "toolResult");
		assert.equal(toolResultEntry.message.isError, true);
		const errBlock = toolResultEntry.message.content[0];
		assert.ok(errBlock && errBlock.type === "text");
		assert.match(errBlock.text, /does not belong to this session/i);
	});

	test("fork copies attachment files, rewind wipes files, export links them, deleteArchived cleans folder", async () => {
		const { store } = newStore();
		const home = tempDir("yew-att-life-");
		const faux = fauxProvider({ models: [{ id: "m", input: ["text", "image"] }] });
		faux.setResponses([fauxAssistantMessage("Got it.")]);
		const gateway = new ModelGateway({
			keys: new MemoryKeyStore({ [faux.provider.id]: "test-key" }),
			version: "0.0.0",
			providers: [faux.provider],
		});
		const permissions = new PermissionEngine(home);
		const agents = new Agents({ store, gateway, permissions, home, version: "0.0.0" });

		const session = store.createSession({
			...sessionInput("Lifecycle"),
			provider: faux.provider.id,
			model: "m",
		});
		const ref = await agents.attachments.save(session.id, {
			name: "diagram.png",
			mimeType: "image/png",
			data: TINY_PNG,
		});
		const sent = agents.send(session.id, "Check this diagram", [ref.id]);
		assert.ok("entry" in sent);
		await waitForStatus(store, session.id, "idle");

		const origPath = agents.attachments.get(ref.id).filePath;
		assert.equal(existsSync(origPath), true);

		// Export includes attachment file and relative link in Markdown.
		const exportDir = tempDir("yew-att-exp-");
		const counts = exportAll(store, exportDir, Date.now(), home);
		assert.equal(counts.attachments, 1);
		const md = readFileSync(join(exportDir, "sessions", "Lifecycle.md"), "utf8");
		assert.match(md, /!\[diagram\.png\]\(\.\.\/attachments\/Lifecycle\/diagram\.png\)/);
		assert.deepEqual(
			readFileSync(join(exportDir, "attachments", "Lifecycle", "diagram.png")),
			TINY_PNG,
		);

		// Fork creates an independent copy of the attachment file with a new id.
		const reply = store.allEntries(session.id).find((e) => e.role === "assistant");
		assert.ok(reply);
		const forked = store.forkSession(session.id, reply.id, "Lifecycle (fork)");
		const forkedEntries = store.allEntries(forked.id);
		const forkedUser = forkedEntries.find((e) => e.role === "user");
		assert.ok(forkedUser && forkedUser.role === "user" && forkedUser.attachments?.[0]);
		const copiedId = forkedUser.attachments[0].id;
		assert.notEqual(copiedId, ref.id);
		const copiedPath = agents.attachments.get(copiedId).filePath;
		assert.equal(existsSync(copiedPath), true);

		// Rewinding original session before the user entry deletes original file, fork copy survives!
		agents.rewind(session.id, sent.entry.id);
		assert.equal(existsSync(origPath), false);
		assert.equal(existsSync(copiedPath), true);

		// Archiving and permanently deleting the fork deletes its attachment directory.
		store.updateSession(forked.id, { archived: true });
		agents.deleteArchived();
		assert.equal(existsSync(copiedPath), false);
	});
});
