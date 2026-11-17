/**
 * The connection test of a provider (settings, "providers and keys"). Local servers
 * stand in for the providers; nothing here reaches a real one.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { YewError } from "../src/server/errors.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { ModelGateway, plainError } from "../src/server/model/gateway.ts";

async function server(handle: (res: ServerResponse, headers: IncomingHttpHeaders) => void) {
	const seen: IncomingHttpHeaders[] = [];
	const http = createServer((req, res) => {
		seen.push(req.headers);
		req.resume();
		req.on("end", () => handle(res, req.headers));
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
	const { port } = http.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		seen,
		close: () => {
			http.closeAllConnections();
			http.close();
		},
	};
}

const json = (status: number, body: unknown) => (res: ServerResponse) => {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};

describe("connection test", () => {
	const local = (url: string, keyRequired = false) =>
		new ModelGateway({
			keys: new MemoryKeyStore(),
			version: "0.0.0",
			providers: [],
			custom: [
				{
					id: "local",
					name: "Local",
					baseUrl: `${url}/v1`,
					keyRequired,
					models: [
						{ id: "big", contextWindow: 32_000, maxTokens: 4_000, cost: { input: 5, output: 9 } },
						{ id: "small", contextWindow: 32_000, maxTokens: 4_000, cost: { input: 1, output: 2 } },
					],
				},
			],
		});

	test("a provider that answers is timed, with its cheapest model", async () => {
		const meta = { id: "c1", object: "chat.completion.chunk", created: 0, model: "small" };
		const provider = await server((res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.write(
				`data: ${JSON.stringify({ ...meta, choices: [{ index: 0, delta: { role: "assistant", content: "pong" }, finish_reason: null }] })}\n\n`,
			);
			res.write(
				`data: ${JSON.stringify({ ...meta, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
			);
			res.end("data: [DONE]\n\n");
		});
		try {
			const result = await local(provider.url).ping("local");
			assert.equal(result.ok, true, result.error);
			assert.equal(result.model, "small");
			assert.ok(result.firstMs !== null && result.firstMs >= 0 && result.firstMs <= result.totalMs);
			assert.equal((await local(provider.url).ping("local", "big")).model, "big");
		} finally {
			provider.close();
		}
	});

	test("a refused key is the result, asked once", async () => {
		const provider = await server(json(401, { error: { message: "Incorrect API key provided" } }));
		try {
			const result = await local(provider.url).ping("local");
			assert.equal(result.ok, false);
			assert.equal(result.error, "401: Incorrect API key provided");
			assert.equal(provider.seen.length, 1, "a test is not tried again");
		} finally {
			provider.close();
		}
	});

	test("without a key, or with a model the provider does not have, nothing is sent", async () => {
		const provider = await server(json(200, {}));
		try {
			await assert.rejects(
				local(provider.url, true).ping("local"),
				(e) => e instanceof YewError && e.code === "missing-api-key",
			);
			await assert.rejects(local(provider.url).ping("local", "nope"), YewError);
			assert.equal(provider.seen.length, 0);
		} finally {
			provider.close();
		}
	});
});

test("a provider's error is shown as one line", () => {
	assert.equal(
		plainError(
			'401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
		),
		"401: invalid x-api-key",
	);
	assert.equal(
		plainError('429 {"message":"Rate limit reached","code":"x"}'),
		"429: Rate limit reached",
	);
	assert.equal(plainError('401: {"message":"Authentication Fails"}'), "401: Authentication Fails");
	assert.equal(plainError("fetch failed"), "fetch failed");
});
