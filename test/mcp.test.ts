import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { McpHub, readMcpConfig } from "../src/server/mcp.ts";
import type { ToolContext } from "../src/server/tools/types.ts";
import type { JsonObject } from "../src/shared/messages.ts";
import type { Session } from "../src/shared/types.ts";
import { tempDir } from "./helpers/store.ts";

const server = fileURLToPath(new URL("./helpers/mcp-server.mjs", import.meta.url));
const ctx = { signal: new AbortController().signal, acceptsImages: false } as ToolContext;

function home(servers: unknown) {
	const jigHome = tempDir("jig-home-");
	writeFileSync(join(jigHome, "mcp.json"), JSON.stringify({ mcpServers: servers }));
	return jigHome;
}

const textOf = (result: { content: { type: string; text?: string }[] }) =>
	result.content.map((block) => block.text ?? "").join("");

describe("MCP configuration", () => {
	test("reads the usual mcpServers shape; names in braces come from the environment; odd entries are skipped", () => {
		const jigHome = home({
			files: { command: "node", args: ["server.js", `\${ROOT}`], env: { TOKEN: `\${TOKEN}` } },
			search: {
				url: "https://mcp.example.com/mcp",
				headers: { Authorization: `Bearer \${TOKEN}` },
			},
			"bad name": { command: "x" },
			nothing: { type: "stdio" },
			local: { url: "ftp://example.com" },
		});
		assert.deepEqual(readMcpConfig(jigHome, { ROOT: "/data", TOKEN: "t0" }), {
			files: { command: "node", args: ["server.js", "/data"], env: { TOKEN: "t0" } },
			search: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer t0" } },
		});
		assert.deepEqual(readMcpConfig(tempDir("jig-home-")), {});
	});
});

describe("MCP servers", () => {
	test("a stdio server is started, its tools are offered by name, and a call goes through", async () => {
		const jigHome = home({
			test: { command: process.execPath, args: [server], env: { GREETING: "你好" } },
			broken: { command: join(jigHome_missing(), "no-such-program") },
		});
		const hub = new McpHub({ jigHome, version: "0.0.0", log: () => {} });
		try {
			await hub.refresh();
			const status = hub.status();
			assert.deepEqual(
				status.find((s) => s.name === "test"),
				{
					name: "test",
					kind: "stdio",
					state: "ready",
					error: null,
					tools: ["echo", "env"],
				},
			);
			// A server that cannot start is reported and does not stand in the others' way.
			assert.equal(status.find((s) => s.name === "broken")?.state, "error");
			const tools = hub.tools();
			assert.deepEqual(
				tools.map((tool) => tool.name),
				["mcp__test__echo", "mcp__test__env"],
			);
			const echo = tools[0];
			// Every MCP tool asks the first time, in every permission mode, and can be remembered.
			assert.deepEqual(echo?.subject({ text: "hi" }, {} as Session), {
				kind: "act",
				tool: "mcp__test__echo",
				summary: 'test: echo {"text":"hi"}',
				always: true,
			});
			assert.equal(echo?.readOnly, false);
			assert.equal(
				textOf(await (echo as NonNullable<typeof echo>).run({ text: "hi" }, ctx)),
				"echo: hi",
			);
			const env = tools[1] as NonNullable<(typeof tools)[number]>;
			assert.equal(textOf(await env.run({ name: "GREETING" }, ctx)), "你好");
			const failed = await env.run({ name: "FAIL" }, ctx);
			assert.equal(failed.isError, true);
		} finally {
			hub.stop();
		}
	});

	test("an HTTP server is called with POST, answers as JSON or an event stream, and keeps its session", async () => {
		const jigHome = home({
			web: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer k" } },
		});
		const requests: { headers: Record<string, string>; body: JsonObject }[] = [];
		const fetcher = (async (_url: string, init: RequestInit) => {
			if (init.method === "DELETE") return new Response(null, { status: 204 });
			const body = JSON.parse(init.body as string) as JsonObject;
			requests.push({ headers: init.headers as Record<string, string>, body });
			const reply = (result: unknown, stream = false) =>
				new Response(
					stream
						? `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`
						: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
					{
						headers: {
							"Content-Type": stream ? "text/event-stream" : "application/json",
							"Mcp-Session-Id": "s-1",
						},
					},
				);
			if (body.method === "initialize")
				return reply({ protocolVersion: "2025-06-18", capabilities: {} });
			if (body.method === "tools/list") {
				return reply({
					tools: [{ name: "lookup", description: "Looks up.", inputSchema: { type: "object" } }],
				});
			}
			if (body.method === "tools/call")
				return reply({ content: [{ type: "text", text: "found" }] }, true);
			return new Response(null, { status: 202 });
		}) as unknown as typeof fetch;
		const hub = new McpHub({ jigHome, version: "1.2.3", fetch: fetcher, log: () => {} });
		try {
			await hub.refresh();
			assert.deepEqual(hub.status()[0]?.tools, ["lookup"]);
			const [tool] = hub.tools();
			assert.equal(textOf(await (tool as NonNullable<typeof tool>).run({ q: "x" }, ctx)), "found");
			const call = requests.find((request) => request.body.method === "tools/call");
			assert.equal(call?.headers.Authorization, "Bearer k");
			assert.equal(call?.headers["Mcp-Session-Id"], "s-1");
			assert.equal(call?.headers["User-Agent"], "jig/1.2.3");
			assert.deepEqual(call?.body.params, { name: "lookup", arguments: { q: "x" } });
			// The configuration is read again only when the file changed.
			const before = requests.length;
			await hub.refresh();
			assert.equal(requests.length, before);
		} finally {
			hub.stop();
		}
	});
});

function jigHome_missing(): string {
	return tempDir("jig-none-");
}
