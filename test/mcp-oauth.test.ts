/**
 * Signing in to MCP servers in the browser (blueprint 6.11, item 40). A local server plays both the
 * MCP server that wants a token and its authorization server; the browser's part is played by the
 * test, which takes the address Jig would open and hands back a code.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, test } from "node:test";
import { oauthCallbackRoute } from "../src/server/http/mcp.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { McpHub } from "../src/server/mcp.ts";
import { McpAuth } from "../src/server/mcp-oauth.ts";
import type { ToolContext } from "../src/server/tools/types.ts";
import { tempDir } from "./helpers/store.ts";

const REDIRECT = "http://127.0.0.1:4777/oauth/callback";

/** An MCP server that wants a bearer token, and the authorization server that hands them out. */
async function provider(options: { register?: boolean } = {}) {
	const seen = {
		registrations: [] as unknown[],
		tokens: [] as URLSearchParams[],
		bearers: [] as string[],
	};
	let challenge = "";
	let valid = new Set<string>();
	const http = createServer((req: IncomingMessage, res: ServerResponse) => {
		let body = "";
		req.on("data", (piece: Buffer) => {
			body += piece.toString("utf8");
		});
		req.on("end", () => {
			const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
			const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
				res.writeHead(status, { "Content-Type": "application/json", ...headers });
				res.end(JSON.stringify(value));
			};
			const path = req.url ?? "";
			if (path === "/mcp" && req.method === "POST") {
				const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
				seen.bearers.push(bearer);
				if (!valid.has(bearer)) {
					return json(
						401,
						{ error: "unauthorized" },
						{
							"WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="read"`,
						},
					);
				}
				const message = JSON.parse(body) as { id?: number; method: string };
				if (message.id === undefined) return json(202, {});
				const result =
					message.method === "initialize"
						? {
								protocolVersion: "2025-06-18",
								capabilities: { tools: {} },
								serverInfo: { name: "demo", version: "1" },
							}
						: message.method === "tools/list"
							? { tools: [{ name: "hello", inputSchema: { type: "object", properties: {} } }] }
							: { content: [{ type: "text", text: `hi with ${bearer}` }] };
				return json(200, { jsonrpc: "2.0", id: message.id, result });
			}
			if (path === "/.well-known/oauth-protected-resource/mcp") {
				return json(200, { resource: `${base}/mcp`, authorization_servers: [`${base}/as`] });
			}
			if (path === "/.well-known/oauth-authorization-server/as") {
				return json(200, {
					issuer: `${base}/as`,
					authorization_endpoint: `${base}/as/authorize`,
					token_endpoint: `${base}/as/token`,
					...(options.register === false ? {} : { registration_endpoint: `${base}/as/register` }),
					code_challenge_methods_supported: ["S256"],
				});
			}
			if (path === "/as/register") {
				seen.registrations.push(JSON.parse(body));
				return json(201, { client_id: "c-1" });
			}
			if (path === "/as/token") {
				const form = new URLSearchParams(body);
				seen.tokens.push(form);
				if (form.get("grant_type") === "authorization_code") {
					const verifier = form.get("code_verifier") ?? "";
					const derived = createHash("sha256").update(verifier).digest("base64url");
					if (form.get("code") !== "code-1" || derived !== challenge) {
						return json(400, { error: "invalid_grant" });
					}
					valid = new Set(["at-1"]);
					return json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 });
				}
				if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "rt-1") {
					valid = new Set(["at-2"]);
					return json(200, { access_token: "at-2", expires_in: 3600 });
				}
				return json(400, { error: "invalid_grant" });
			}
			res.writeHead(404);
			res.end();
		});
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
	return {
		base,
		seen,
		/** What the authorization server remembers from the address the browser opened. */
		expect: (url: URL) => {
			challenge = url.searchParams.get("code_challenge") ?? "";
		},
		close: () => {
			http.closeAllConnections();
			http.close();
		},
	};
}

function setup(entry: Record<string, unknown>, now = () => Date.now()) {
	const jigHome = tempDir("jig-home-");
	writeFileSync(join(jigHome, "mcp.json"), JSON.stringify({ mcpServers: { demo: entry } }));
	const keys = new MemoryKeyStore();
	const auth = new McpAuth({ keys, redirectUri: REDIRECT, version: "0.0.0", now });
	const hub = new McpHub({ jigHome, version: "0.0.0", log: () => {}, auth });
	const status = () => hub.status().find((server) => server.name === "demo");
	return { jigHome, keys, auth, hub, status };
}

const ctx = { signal: new AbortController().signal, acceptsImages: false } as ToolContext;

describe("signing in to an MCP server", () => {
	test("Jig finds where to sign in, registers itself, and keeps the tokens in the keychain", async () => {
		const server = await provider();
		const { jigHome, keys, hub, status } = setup({ url: `${server.base}/mcp` });
		try {
			await hub.refresh();
			assert.equal(status()?.state, "sign-in");
			const url = new URL(await hub.signInUrl("demo"));
			assert.equal(url.origin + url.pathname, `${server.base}/as/authorize`);
			const params = Object.fromEntries(url.searchParams);
			assert.equal(params.client_id, "c-1");
			assert.equal(params.redirect_uri, REDIRECT);
			assert.equal(params.code_challenge_method, "S256");
			assert.equal(params.resource, `${server.base}/mcp`);
			assert.equal(params.scope, "read", "the scope the server named");
			assert.deepEqual(server.seen.registrations[0], {
				client_name: "Jig",
				redirect_uris: [REDIRECT],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
				software_version: "0.0.0",
			});

			server.expect(url);
			assert.equal(await hub.completeSignIn(params.state as string, "code-1", null), "demo");
			assert.equal(status()?.state, "ready");
			assert.equal(status()?.signedIn, true);
			const tool = hub.tools().find((item) => item.name === "mcp__demo__hello");
			const result = await tool?.run({}, ctx);
			assert.match(JSON.stringify(result), /hi with at-1/);
			// The token went with the request; nothing of it is in mcp.json.
			assert.ok(server.seen.bearers.includes("at-1"));
			assert.doesNotMatch(readFileSync(join(jigHome, "mcp.json"), "utf8"), /at-1|rt-1|c-1/);
			assert.match((await keys.get("demo")) ?? "", /"access":"at-1"/);

			// A state works once.
			await assert.rejects(
				hub.completeSignIn(params.state as string, "code-1", null),
				/not valid any more/,
			);

			await hub.signOut("demo");
			assert.equal(status()?.state, "sign-in");
			assert.equal(await keys.get("demo"), null);
		} finally {
			hub.stop();
			server.close();
		}
	});

	test("a token about to run out is refreshed", async () => {
		const server = await provider();
		let now = Date.now();
		const { auth, hub } = setup({ url: `${server.base}/mcp` }, () => now);
		try {
			await hub.refresh();
			const url = new URL(await hub.signInUrl("demo"));
			server.expect(url);
			await hub.completeSignIn(url.searchParams.get("state") as string, "code-1", null);
			assert.equal(await auth.bearer("demo", `${server.base}/mcp`), "at-1");
			now += 3600 * 1000;
			assert.equal(await auth.bearer("demo", `${server.base}/mcp`), "at-2");
			const refresh = server.seen.tokens.find((form) => form.get("grant_type") === "refresh_token");
			assert.equal(refresh?.get("resource"), `${server.base}/mcp`);
		} finally {
			hub.stop();
			server.close();
		}
	});

	test("with a client the person made, Jig registers nothing and asks for the scopes given", async () => {
		const server = await provider({ register: false });
		const { hub } = setup({
			url: `${server.base}/mcp`,
			oauth: { clientId: "mine", clientSecret: "shh", scopes: ["a", "b"] },
		});
		try {
			await hub.refresh();
			const url = new URL(await hub.signInUrl("demo"));
			assert.equal(url.searchParams.get("client_id"), "mine");
			assert.equal(url.searchParams.get("scope"), "a b");
			assert.equal(server.seen.registrations.length, 0);
			server.expect(url);
			await hub.completeSignIn(url.searchParams.get("state") as string, "code-1", null);
			const exchange = server.seen.tokens.at(-1);
			assert.equal(exchange?.get("client_secret"), "shh");
			assert.equal(exchange?.get("client_id"), "mine");
		} finally {
			hub.stop();
			server.close();
		}
	});

	test("a server that only takes clients registered in advance says so", async () => {
		const server = await provider({ register: false });
		const { hub } = setup({ url: `${server.base}/mcp` });
		try {
			await hub.refresh();
			await assert.rejects(hub.signInUrl("demo"), /only accepts clients registered in advance/);
		} finally {
			hub.stop();
			server.close();
		}
	});

	test("the page the browser comes back to finishes the sign-in, and only with a state Jig made", async () => {
		const server = await provider();
		const { hub, status } = setup({ url: `${server.base}/mcp` });
		const page = oauthCallbackRoute(hub);
		try {
			await hub.refresh();
			const bad = await page.request("/oauth/callback?state=forged&code=code-1");
			assert.equal(bad.status, 400);
			assert.match(await bad.text(), /not valid any more/);
			const url = new URL(await hub.signInUrl("demo"));
			server.expect(url);
			const good = await page.request(
				`/oauth/callback?state=${url.searchParams.get("state")}&code=code-1`,
			);
			assert.equal(good.status, 200);
			assert.match(await good.text(), /已登录 demo/);
			assert.equal(status()?.state, "ready");
		} finally {
			hub.stop();
			server.close();
		}
	});
});
