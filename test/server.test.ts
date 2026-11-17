import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createApp } from "../src/server/http/app.ts";
import { issueLoginToken } from "../src/server/http/security.ts";
import { newStore, sessionInput } from "./helpers/store.ts";

const PORT = 4777;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function setup() {
	const { store, bus } = newStore();
	const app = createApp({ store, bus, log: () => {}, security: { port: PORT } });
	const request = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
		app.request(`${ORIGIN}${path}`, {
			...init,
			headers: { Host: `127.0.0.1:${PORT}`, "Sec-Fetch-Site": "same-origin", ...init.headers },
		});
	const signIn = async () => {
		const response = await request("/api/auth/exchange", {
			method: "POST",
			headers: { Origin: ORIGIN, "Content-Type": "application/json" },
			body: JSON.stringify({ token: issueLoginToken(store) }),
		});
		assert.equal(response.status, 204);
		const cookie = response.headers.get("Set-Cookie") ?? "";
		return cookie.split(";")[0] as string;
	};
	return { store, app, request, signIn };
}

describe("local interface security", () => {
	test("only answers to 127.0.0.1 and localhost on its own port", async () => {
		const { request } = setup();
		assert.equal(
			(await request("/api/health", { headers: { Host: "evil.example:4777" } })).status,
			421,
		);
		assert.equal(
			(await request("/api/health", { headers: { Host: "127.0.0.1:9999" } })).status,
			421,
		);
		assert.equal(
			(await request("/api/health", { headers: { Host: `localhost:${PORT}` } })).status,
			200,
		);
		assert.equal(
			(await request("/api/health", { headers: { "X-Forwarded-For": "1.2.3.4" } })).status,
			403,
		);
	});

	test("the API needs the browser cookie; a login token works once", async () => {
		const { store, request } = setup();
		assert.equal((await request("/api/sessions")).status, 401);
		const token = issueLoginToken(store);
		const exchange = () =>
			request("/api/auth/exchange", {
				method: "POST",
				headers: { Origin: ORIGIN, "Content-Type": "application/json" },
				body: JSON.stringify({ token }),
			});
		const first = await exchange();
		assert.equal(first.status, 204);
		const cookie = first.headers.get("Set-Cookie") ?? "";
		assert.match(cookie, /^yew_4777=[\w-]+;/);
		assert.match(cookie, /HttpOnly/);
		assert.match(cookie, /SameSite=Strict/);
		assert.equal((await exchange()).status, 401);
		const ok = await request("/api/sessions", {
			headers: { Cookie: cookie.split(";")[0] as string },
		});
		assert.equal(ok.status, 200);
		assert.equal(
			(await request("/api/sessions", { headers: { Cookie: "yew_4777=forged" } })).status,
			401,
		);
	});

	test("requests from other sites, other local ports or without Origin are refused", async () => {
		const { request, signIn } = setup();
		const cookie = await signIn();
		const create = (headers: Record<string, string>) =>
			request("/api/sessions", {
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ name: "x" }),
			});
		assert.equal((await create({ Origin: "http://localhost:3000" })).status, 403);
		assert.equal((await create({})).status, 403);
		assert.equal((await create({ Origin: ORIGIN, "Sec-Fetch-Site": "same-site" })).status, 403);
		assert.equal((await create({ Origin: ORIGIN })).status, 201);
		const framed = await request("/api/sessions", {
			headers: { Cookie: cookie, "Sec-Fetch-Dest": "iframe" },
		});
		assert.equal(framed.status, 403);
	});

	test("responses carry the security headers", async () => {
		const { request } = setup();
		const response = await request("/api/health");
		assert.match(response.headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
		assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
		assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
		assert.equal(response.headers.get("Cache-Control"), "no-store");
	});
});

/** Reads server-sent events until `count` have arrived or the time runs out. */
async function readEvents(response: Response, count: number, ms = 2000) {
	const reader = (response.body as ReadableStream<Uint8Array>).getReader();
	const decoder = new TextDecoder();
	const events: { id?: string; event?: string; data: string }[] = [];
	let buffer = "";
	const deadline = Date.now() + ms;
	while (events.length < count && Date.now() < deadline) {
		const chunk = await Promise.race([
			reader.read(),
			new Promise<{ done: true; value: undefined }>((resolve) =>
				setTimeout(() => resolve({ done: true, value: undefined }), deadline - Date.now()),
			),
		]);
		if (chunk.done) break;
		buffer += decoder.decode(chunk.value, { stream: true });
		let end = buffer.indexOf("\n\n");
		while (end >= 0) {
			const block = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			const event: { id?: string; event?: string; data: string } = { data: "" };
			for (const line of block.split("\n")) {
				if (line.startsWith("id: ")) event.id = line.slice(4);
				else if (line.startsWith("event: ")) event.event = line.slice(7);
				else if (line.startsWith("data: ")) event.data += line.slice(6);
			}
			if (event.event) events.push(event);
			end = buffer.indexOf("\n\n");
		}
	}
	await reader.cancel();
	return events;
}

describe("event stream", () => {
	test("replays transcript events after Last-Event-ID, then streams new ones", async () => {
		const { store, request, signIn } = setup();
		const cookie = await signIn();
		const session = store.createSession(sessionInput());
		store.appendEntry(session.id, {
			role: "user",
			message: { role: "user", content: "one", timestamp: 1 },
		});
		const watermark = store.getSession(session.id).eventSeq;
		store.appendEntry(session.id, {
			role: "user",
			message: { role: "user", content: "two", timestamp: 2 },
		});

		const response = await request(`/api/events?session=${session.id}`, {
			headers: { Cookie: cookie, "Last-Event-ID": String(watermark) },
		});
		assert.equal(response.headers.get("Content-Type"), "text/event-stream");
		setTimeout(() => {
			store.appendEntry(session.id, {
				role: "user",
				message: { role: "user", content: "three", timestamp: 3 },
			});
		}, 50);
		const events = await readEvents(response, 8);
		const transcript = events.filter((event) => event.event === "session");
		const ids = transcript.map((event) => Number(event.id));
		assert.ok(
			ids.every((id) => id > watermark),
			"nothing before the watermark is replayed",
		);
		assert.deepEqual(
			ids,
			[...ids].sort((a, b) => a - b),
		);
		const texts = transcript
			.map((event) => JSON.parse(event.data))
			.filter((e) => e.type === "entry");
		assert.deepEqual(
			texts.map((e) => e.entry.message.content),
			["two", "three"],
		);
		assert.ok(events.some((event) => event.event === "global"));
	});

	test("asks the client to reload when the requested events were pruned", async () => {
		const { store, request, signIn } = setup();
		const cookie = await signIn();
		const session = store.createSession(sessionInput());
		store.appendEntry(session.id, {
			role: "user",
			message: { role: "user", content: "x", timestamp: 1 },
		});
		store.pruneEvents(Date.now() + 1000);
		store.appendEntry(session.id, {
			role: "user",
			message: { role: "user", content: "y", timestamp: 1 },
		});
		const response = await request(`/api/events?session=${session.id}&after=0`, {
			headers: { Cookie: cookie },
		});
		const events = await readEvents(response, 2);
		assert.equal(events[1]?.event, "reset");
	});
});
