import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { describe, test } from "node:test";
import { createApp } from "../src/server/http/app.ts";
import { problemType } from "../src/server/http/problem.ts";
import { newStore, tempDir } from "./helpers/store.ts";

/** Response whose JSON body is loosely typed, which is what these assertions want. */
// biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON
type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };

function setup() {
	const { store } = newStore();
	const app = createApp({ store, log: () => {} });
	const call = async (
		method: string,
		path: string,
		body?: unknown,
		headers: Record<string, string> = {},
	): Promise<TestResponse> =>
		app.request(path, {
			method,
			headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	return { store, app, call };
}

describe("api: sessions", () => {
	test("create, read, rename and list", async () => {
		const { call } = setup();
		const created = await call("POST", "/api/sessions", { name: "总办", kind: "standing" });
		assert.equal(created.status, 201);
		const session = await created.json();
		assert.equal(session.provider, "deepseek");
		assert.equal(session.model, "deepseek-v4-pro");
		assert.equal(session.cwd, null);

		const renamed = await call("PATCH", `/api/sessions/${session.id}`, {
			name: "总办会话",
			pinned: true,
		});
		assert.equal(renamed.status, 200);
		const updated = await renamed.json();
		assert.equal(updated.name, "总办会话");
		assert.equal(updated.pinned, true);

		const list = await (await call("GET", "/api/sessions?limit=10")).json();
		assert.deepEqual(
			list.items.map((s: { name: string }) => s.name),
			["总办会话"],
		);
		assert.equal(list.nextCursor, null);
	});

	test("a session switches between chat and code by setting or clearing its folder", async () => {
		const { call } = setup();
		const session = await (await call("POST", "/api/sessions", { name: "改代码" })).json();
		const folder = realpathSync(tempDir("jig-cwd-"));
		const code = await (await call("PATCH", `/api/sessions/${session.id}`, { cwd: folder })).json();
		assert.equal(code.cwd, folder);
		const chat = await (await call("PATCH", `/api/sessions/${session.id}`, { cwd: null })).json();
		assert.equal(chat.cwd, null);
		const missing = await call("PATCH", `/api/sessions/${session.id}`, { cwd: "/no/such/folder" });
		assert.equal(missing.status, 400);
	});

	test("errors are RFC 9457 problems with a request ID", async () => {
		const { call } = setup();
		await call("POST", "/api/sessions", { name: "A" });
		const response = await call("POST", "/api/sessions", { name: "a" });
		assert.equal(response.status, 409);
		assert.equal(response.headers.get("Content-Type"), "application/problem+json");
		const problem = await response.json();
		assert.equal(problem.type, problemType("conflict"));
		assert.equal(problem.status, 409);
		assert.equal(typeof problem.title, "string");
		assert.match(problem.detail, /already exists/);
		assert.equal(problem.requestId, response.headers.get("X-Request-Id"));

		const missing = await call("GET", "/api/sessions/nope");
		assert.equal(missing.status, 404);
		const unknown = await call("GET", "/api/nothing-here");
		assert.equal(unknown.status, 404);
		assert.equal((await unknown.json()).type, problemType("not-found"));
	});

	test("rejects bodies that are not JSON objects", async () => {
		const { app, call } = setup();
		const plain = await app.request("/api/sessions", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: JSON.stringify({ name: "x" }),
		});
		assert.equal(plain.status, 415);
		assert.equal((await call("POST", "/api/sessions", ["x"])).status, 400);
		assert.equal((await call("POST", "/api/sessions", { name: 3 })).status, 400);
		assert.equal((await call("GET", "/api/sessions?limit=0")).status, 400);
		assert.equal((await call("GET", "/api/sessions?limit=999")).status, 400);
	});

	test("a working folder must exist and is stored as its real path", async () => {
		const { call } = setup();
		const dir = tempDir();
		const ok = await call("POST", "/api/sessions", { name: "s1", cwd: dir });
		assert.equal(ok.status, 201);
		assert.equal((await ok.json()).cwd, realpathSync(dir));
		const missing = await call("POST", "/api/sessions", { name: "s2", cwd: `${dir}/missing` });
		assert.equal(missing.status, 400);
		const relative = await call("POST", "/api/sessions", { name: "s3", cwd: "relative/path" });
		assert.equal(relative.status, 400);
	});

	test("the same Idempotency-Key returns the first result without creating twice", async () => {
		const { call, store } = setup();
		const headers = { "Idempotency-Key": "create-1" };
		const first = await call("POST", "/api/sessions", { name: "once" }, headers);
		const again = await call("POST", "/api/sessions", { name: "once" }, headers);
		assert.equal(first.status, 201);
		assert.equal(again.status, 201);
		assert.equal(again.headers.get("Idempotent-Replayed"), "true");
		assert.equal((await first.json()).id, (await again.json()).id);
		assert.equal(store.listSessions({ limit: 10 }).items.length, 1);
		const reused = await call("POST", "/api/sessions", { name: "other" }, headers);
		assert.equal(reused.status, 422);
	});

	test("transcript returns entries and a resumable event sequence", async () => {
		const { call, store } = setup();
		const session = await (await call("POST", "/api/sessions", { name: "t" })).json();
		store.appendEntry(session.id, {
			role: "user",
			message: { role: "user", content: "hi", timestamp: 1 },
		});
		const transcript = await (await call("GET", `/api/sessions/${session.id}/transcript`)).json();
		assert.equal(transcript.entries.length, 1);
		assert.equal(transcript.session.eventSeq, store.getSession(session.id).eventSeq);
		assert.equal(transcript.olderCursor, null);
	});
});

describe("api: groups, settings, search", () => {
	test("groups can be created, renamed and deleted", async () => {
		const { call } = setup();
		const group = await (await call("POST", "/api/groups", { name: "产品" })).json();
		const renamed = await (
			await call("PATCH", `/api/groups/${group.id}`, { name: "产品组" })
		).json();
		assert.equal(renamed.name, "产品组");
		assert.equal((await call("DELETE", `/api/groups/${group.id}`)).status, 204);
		assert.deepEqual((await (await call("GET", "/api/groups")).json()).items, []);
	});

	test("settings validate their values", async () => {
		const { call } = setup();
		const saved = await (
			await call("PATCH", "/api/settings", { theme: "dark", language: "zh" })
		).json();
		assert.equal(saved.theme, "dark");
		assert.equal(saved.language, "zh");
		assert.equal((await call("PATCH", "/api/settings", { theme: "blue" })).status, 400);
		assert.equal(
			(await call("PATCH", "/api/settings", { defaultRules: [{ effect: "maybe", tool: "shell" }] }))
				.status,
			400,
		);
	});

	test("search caps the query length", async () => {
		const { call } = setup();
		assert.equal((await call("GET", `/api/search?q=${"x".repeat(201)}`)).status, 400);
		const result = await (await call("GET", "/api/search?q=abc")).json();
		assert.deepEqual(result, { sessions: [], hits: [] });
	});
});

describe("api: providers and keys", () => {
	async function providerSetup() {
		const { MemoryKeyStore } = await import("../src/server/keys.ts");
		const { ModelGateway } = await import("../src/server/model/gateway.ts");
		const { store } = newStore();
		const keys = new MemoryKeyStore();
		const gateway = new ModelGateway({ keys, version: "0.0.0" });
		const app = createApp({ store, gateway, log: () => {} });
		const call = async (method: string, path: string, body?: unknown): Promise<TestResponse> =>
			app.request(path, {
				method,
				...(body === undefined
					? {}
					: { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
			});
		return { store, keys, gateway, call };
	}

	test("keys go to the key store and are never returned", async () => {
		const { keys, call } = await providerSetup();
		assert.equal(
			(await call("PUT", "/api/providers/deepseek/key", { key: " sk-abc " })).status,
			204,
		);
		assert.equal(await keys.get("deepseek"), "sk-abc");
		const list = await (await call("GET", "/api/providers")).json();
		const deepseek = list.items.find((p: { id: string }) => p.id === "deepseek");
		assert.equal(deepseek.hasKey, true);
		assert.ok(!JSON.stringify(list).includes("sk-abc"));
		assert.equal((await call("DELETE", "/api/providers/deepseek/key")).status, 204);
		assert.equal(await keys.get("deepseek"), null);
		assert.equal((await call("PUT", "/api/providers/nope/key", { key: "x" })).status, 404);
	});

	test("custom OpenAI-compatible providers can be added, used for sessions and removed", async () => {
		const { store, call } = await providerSetup();
		const body = {
			name: "Local Ollama",
			baseUrl: "http://127.0.0.1:11434/v1/",
			keyRequired: false,
			models: [{ id: "qwen3:8b", contextWindow: 32768, maxTokens: 8192 }],
		};
		const created = await call("PUT", "/api/providers/ollama", body);
		assert.equal(created.status, 201);
		assert.equal((await created.json()).region, "custom");
		assert.equal(store.listCustomProviders()[0]?.baseUrl, "http://127.0.0.1:11434/v1");
		const session = await call("POST", "/api/sessions", {
			name: "local",
			provider: "ollama",
			model: "qwen3:8b",
		});
		assert.equal(session.status, 201);
		const models = await (await call("GET", "/api/providers/ollama/models")).json();
		assert.equal(models.items[0].id, "qwen3:8b");
		assert.equal((await call("PUT", "/api/providers/deepseek", body)).status, 400);
		assert.equal((await call("PUT", "/api/providers/bad", { ...body, models: [] })).status, 400);
		assert.equal((await call("DELETE", "/api/providers/ollama")).status, 204);
		assert.deepEqual(store.listCustomProviders(), []);
		const unknownModel = await call("POST", "/api/sessions", {
			name: "x",
			provider: "ollama",
			model: "qwen3:8b",
		});
		assert.equal(unknownModel.status, 400);
	});
});
