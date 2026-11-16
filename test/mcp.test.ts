import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { JigError } from "../src/server/errors.ts";
import { decisionFromPhone } from "../src/server/http/agents.ts";
import { McpHub, readMcpConfig, special as specialFor } from "../src/server/mcp.ts";
import { builtinInstaller, builtinMcp, serverEnv } from "../src/server/mcp-builtin.ts";
import { listMcpEntries, patchMcpEntry, removeMcpEntry } from "../src/server/mcp-config.ts";
import { inheritableRules, PermissionEngine } from "../src/server/permissions/engine.ts";
import type { ToolContext, ToolDefinition } from "../src/server/tools/types.ts";
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

describe("servers Jig sets up by itself", () => {
	const builtin = {
		browser: { command: "npx", args: ["-y", "a-browser@1.0.0"] },
		computer: { command: "npx", args: ["-y", "a-computer@1.0.0"] },
	};

	test("run without anything in mcp.json, beside the person's own", () => {
		assert.deepEqual(readMcpConfig(tempDir("jig-home-"), {}, builtin), builtin);
		const jigHome = home({ files: { command: "node", args: ["server.js"] } });
		assert.deepEqual(Object.keys(readMcpConfig(jigHome, {}, builtin)), [
			"browser",
			"computer",
			"files",
		]);
		assert.deepEqual(
			listMcpEntries(jigHome, builtin).map((entry) => [entry.name, entry.builtin, entry.disabled]),
			[
				["browser", true, false],
				["computer", true, false],
				["files", false, false],
			],
		);
	});

	test("are turned off and on from the settings; the file only records that one is off", () => {
		const jigHome = tempDir("jig-home-");
		assert.equal(patchMcpEntry(jigHome, "computer", { disabled: true }, builtin).disabled, true);
		assert.deepEqual(readMcpConfig(jigHome, {}, builtin).computer, {
			...builtin.computer,
			disabled: true,
		});
		assert.deepEqual(readMcpConfig(jigHome, {}, builtin).browser, builtin.browser);
		assert.equal(listMcpEntries(jigHome, builtin)[1]?.disabled, true);
		assert.equal(patchMcpEntry(jigHome, "computer", { disabled: false }, builtin).disabled, false);
		assert.deepEqual(readMcpConfig(jigHome, {}, builtin), builtin);
	});

	test("cannot be removed, and an entry of the same name in mcp.json replaces one", () => {
		assert.throws(
			() => removeMcpEntry(tempDir("jig-home-"), "browser", builtin),
			(e) => e instanceof JigError && e.code === "mcp-builtin",
		);
		const jigHome = home({ browser: { command: "node", args: ["my-browser.js"] } });
		assert.deepEqual(readMcpConfig(jigHome, {}, builtin).browser, {
			command: "node",
			args: ["my-browser.js"],
		});
		const shown = listMcpEntries(jigHome, builtin).find((entry) => entry.name === "browser");
		assert.deepEqual([shown?.builtin, shown?.command], [false, "node"]);
		// The person's own entry is theirs to remove; Jig's own then comes back.
		removeMcpEntry(jigHome, "browser", builtin);
		assert.deepEqual(readMcpConfig(jigHome, {}, builtin).browser, builtin.browser);
	});

	test("are pinned by a lock file that ships with Jig: every package has its hash", () => {
		const root = fileURLToPath(new URL("../mcp-builtin/", import.meta.url));
		const wanted = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
		};
		for (const version of Object.values(wanted.dependencies))
			assert.match(version, /^\d+\.\d+\.\d+$/);
		const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
			packages: Record<string, { integrity?: string; version?: string }>;
		};
		const packages = Object.entries(lock.packages).filter(([path]) => path !== "");
		assert.ok(packages.length > 50);
		for (const [path, entry] of packages) {
			assert.match(entry.integrity ?? "", /^sha512-/, path);
			assert.match(entry.version ?? "", /^\d+\.\d+\.\d+/, path);
		}
		const pkg = JSON.parse(readFileSync(join(root, "..", "package.json"), "utf8")) as {
			files: string[];
		};
		assert.ok(pkg.files.includes("mcp-builtin"), "the lock file goes out with the package");
	});

	test("are started with node from Jig's data folder, with their files kept there", () => {
		const servers = builtinMcp("/data/jig", {});
		assert.equal(servers.browser?.command, process.execPath);
		assert.deepEqual(servers.browser?.args, [
			"/data/jig/mcp-builtin/node_modules/@playwright/mcp/cli.js",
			"--user-data-dir",
			"/data/jig/browser",
			"--output-dir",
			"/data/jig/tmp/browser",
		]);
		assert.deepEqual(servers.computer?.args, [
			"/data/jig/mcp-builtin/node_modules/computer-use-mcp/dist/main.js",
		]);
		assert.deepEqual(builtinMcp("/data/jig", { JIG_MCP_BUILTIN: "off" }), {});
	});

	test("are installed once per lock file, and again after a failure or a new lock", async () => {
		const jigHome = tempDir("jig-home-");
		const source = tempDir("jig-source-");
		writeFileSync(join(source, "package.json"), "{}");
		writeFileSync(join(source, "package-lock.json"), '{"v":1}');
		const runs: string[] = [];
		let fail = true;
		const prepare = builtinInstaller({
			jigHome,
			source,
			env: { PATH: "/bin", OPENAI_API_KEY: "sk-not-passed" },
			install: async (folder, env) => {
				runs.push(readFileSync(join(folder, "package-lock.json"), "utf8"));
				assert.deepEqual(env, { PATH: "/bin" });
				if (fail) throw new Error("no network");
			},
		});
		await assert.rejects(prepare(), /no network/);
		fail = false;
		await Promise.all([prepare(), prepare()]);
		await prepare();
		assert.equal(runs.length, 2, "once failed, once done; then nothing");
		writeFileSync(join(source, "package-lock.json"), '{"v":2}');
		await prepare();
		assert.deepEqual(runs.at(-1), '{"v":2}');
	});

	test("get little of Jig's environment", () => {
		assert.deepEqual(
			serverEnv({
				PATH: "/bin",
				HOME: "/h",
				HTTPS_PROXY: "http://p",
				ANTHROPIC_API_KEY: "x",
				AWS_SECRET: "y",
			}),
			{ PATH: "/bin", HOME: "/h", HTTPS_PROXY: "http://p" },
		);
	});

	test("a failed install is the servers' error, and the person's own servers still start", async () => {
		const jigHome = home({ mine: { command: "node", args: [server] } });
		const hub = new McpHub({
			jigHome,
			version: "0.0.0",
			log: () => {},
			builtin: { browser: { command: "node", args: ["nowhere.js"], ownEnv: true } },
			prepare: async () => {
				throw new Error("npm ci failed (1): no network");
			},
		});
		try {
			await hub.refresh();
			const status = Object.fromEntries(hub.status().map((s) => [s.name, [s.state, s.error]]));
			assert.deepEqual(status.browser, ["error", "npm ci failed (1): no network"]);
			assert.equal(status.mine?.[0], "ready");
		} finally {
			hub.stop();
		}
	});
});

describe("the browser and computer control", () => {
	const engine = new PermissionEngine(tempDir("jig-home-"));
	const session = (rules: Session["rules"], mode: "skip" | "auto" = "skip") =>
		({ id: "s1", cwd: null, rules, options: { permissionMode: mode } }) as unknown as Session;
	async function tools(name: string) {
		const hub = new McpHub({
			jigHome: home({ [name]: { command: "node", args: [server] } }),
			version: "0.0.0",
			log: () => {},
		});
		await hub.refresh();
		const echo = hub.tools().find((tool) => tool.name === `mcp__${name}__echo`);
		assert.ok(echo);
		return { hub, echo };
	}
	const lookup = {} as Parameters<ToolDefinition["subject"]>[2];

	test("an action of computer control is asked about every time and cannot be remembered", async () => {
		const { hub, echo } = await tools("computer");
		try {
			const allowed = session([{ effect: "allow", tool: "mcp__computer__echo" }]);
			for (const action of ["left_click", "type", "key", "scroll", "mouse_move", "something_new"]) {
				const decision = engine.decide(echo.subject({ action }, allowed, lookup), allowed);
				assert.equal(decision.effect, "ask", action);
				if (decision.effect !== "ask") continue;
				assert.equal(decision.request.mustConfirm, true, action);
				assert.deepEqual(decision.request.reasons, ["computer-control"]);
				assert.equal(decision.request.rememberRules, undefined);
			}
			// Looking can be remembered, and a remembered rule then covers looking only.
			const fresh = session([]);
			const look = engine.decide(echo.subject({ action: "get_screenshot" }, fresh, lookup), fresh);
			assert.ok(look.effect === "ask" && look.request.rememberRules?.length === 1);
			assert.equal(
				engine.decide(echo.subject({ action: "get_screenshot" }, allowed, lookup), allowed).effect,
				"allow",
			);
		} finally {
			hub.stop();
		}
	});

	test("an action in the browser can be remembered, with a warning about what that covers", async () => {
		const { hub, echo } = await tools("browser");
		try {
			const fresh = session([]);
			const decision = engine.decide(echo.subject({}, fresh, lookup), fresh);
			assert.ok(decision.effect === "ask");
			assert.equal(decision.request.warning, "acts-as-you");
			assert.equal(decision.request.rememberRules?.length, 1);
		} finally {
			hub.stop();
		}
		const other = await tools("files");
		try {
			const fresh = session([]);
			const decision = engine.decide(other.echo.subject({}, fresh, lookup), fresh);
			assert.ok(decision.effect === "ask" && decision.request.warning === undefined);
		} finally {
			other.hub.stop();
		}
	});

	test("opening an address counts as acting; going back does not", async () => {
		const { hub } = await tools("browser");
		try {
			const fresh = session([]);
			const warningOf = (tool: string) => {
				const subject = { kind: "act", tool: `mcp__browser__${tool}`, summary: "", always: true };
				// The hub decides by the tool's name; ask it through the definition it would build.
				const definition = hub.tools()[0];
				assert.ok(definition);
				return engine.decide({ ...subject, ...specialFor("browser", tool) } as never, fresh);
			};
			const go = warningOf("browser_navigate");
			assert.ok(go.effect === "ask" && go.request.warning === "acts-as-you");
			const back = warningOf("browser_navigate_back");
			assert.ok(back.effect === "ask" && back.request.warning === undefined);
		} finally {
			hub.stop();
		}
	});

	test("always-allow from a phone, for a request that carries the warning, allows once", () => {
		assert.equal(decisionFromPhone("allow_always", { warning: "acts-as-you" }), "allow_once");
		assert.equal(decisionFromPhone("allow_always", { tool: "shell" }), "allow_always");
		assert.equal(decisionFromPhone("deny", { warning: "acts-as-you" }), "deny");
		assert.equal(decisionFromPhone("allow_once", { warning: "acts-as-you" }), "allow_once");
	});

	test("always-allow for these tools is not taken over by a new session", () => {
		const rules: Session["rules"] = [
			{ effect: "allow", tool: "mcp__browser__browser_click" },
			{ effect: "allow", tool: "mcp__computer__computer" },
			{ effect: "deny", tool: "mcp__browser__browser_evaluate" },
			{ effect: "allow", tool: "mcp__files__read" },
			{ effect: "allow", tool: "shell", pattern: "npm test" },
		];
		assert.deepEqual(inheritableRules(rules), rules.slice(2));
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
