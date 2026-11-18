import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, test } from "node:test";
import { editTool, readTool, writeTool } from "../src/server/tools/files.ts";
import { htmlToMarkdown } from "../src/server/tools/html.ts";
import { Jobs } from "../src/server/tools/jobs.ts";
import { findUnique } from "../src/server/tools/match.ts";
import { todoTool } from "../src/server/tools/misc.ts";
import { commandEnvironment, loginShell } from "../src/server/tools/process.ts";
import { ReadState } from "../src/server/tools/read-state.ts";
import { globTool, grepTool } from "../src/server/tools/search.ts";
import { shellJobTool, shellTool } from "../src/server/tools/shell.ts";
import type { ToolContext, ToolResult } from "../src/server/tools/types.ts";
import { isPrivateAddress, webFetchTool } from "../src/server/tools/web.ts";
import type { JsonObject } from "../src/shared/messages.ts";
import type { Session, Todo } from "../src/shared/types.ts";
import { tempDir } from "./helpers/store.ts";

function makeContext(
	cwd: string,
	overrides: Partial<ToolContext> = {},
): ToolContext & { todos: Todo[] } {
	const todos: Todo[] = [];
	const session = { id: "s1", cwd, options: {}, rules: [] } as unknown as Session;
	return {
		session,
		signal: new AbortController().signal,
		readState: new ReadState(),
		jobs: new Jobs(() => {}),
		tmpDir: tempDir("yew-tmp-"),
		acceptsImages: false,
		version: "0.0.0",
		output: () => {},
		setTodos: (list) => todos.splice(0, todos.length, ...list),
		ask: async () => "yes",
		// File, shell and web tools never touch letters or helpers.
		mail: {} as ToolContext["mail"],
		helper: async () => ({ text: "", calls: 0 }),
		todos,
		...overrides,
	};
}

const out = (result: ToolResult) =>
	result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
const run = (
	tool: { run(a: JsonObject, c: ToolContext): Promise<ToolResult> },
	args: JsonObject,
	ctx: ToolContext,
) => tool.run(args, ctx);

describe("match", () => {
	test("exact, ambiguous and normalized matches", () => {
		assert.deepEqual(findUnique("a b c", "b"), { ok: true, start: 2, end: 3 });
		assert.deepEqual(findUnique("x x", "x"), { ok: false, reason: "ambiguous", count: 2 });
		const curly = "say “hello”   \nnext";
		const match = findUnique(curly, 'say "hello"\nnext');
		assert.ok(match.ok);
		if (match.ok) assert.equal(curly.slice(match.start, match.end), curly);
		assert.deepEqual(findUnique("abc", "zzz"), { ok: false, reason: "not_found" });
	});
});

describe("file tools", () => {
	test("read numbers lines and pages through long files", async () => {
		const cwd = realpathSync(tempDir());
		writeFileSync(
			join(cwd, "a.txt"),
			Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"),
		);
		const ctx = makeContext(cwd);
		const page = out(await run(readTool, { path: "a.txt", offset: 5, limit: 3 }, ctx));
		assert.match(
			page,
			/^5\tline 5\n6\tline 6\n7\tline 7\n\[Showing lines 5–7 of 30\. Continue with offset 8\.\]$/,
		);
		assert.ok((await run(readTool, { path: "missing.txt" }, ctx)).isError);
		writeFileSync(join(cwd, "bin.dat"), Buffer.from([1, 0, 2]));
		assert.match(out(await run(readTool, { path: "bin.dat" }, ctx)), /binary/);
	});

	test("write creates files, and refuses to overwrite unread or changed files", async () => {
		const cwd = realpathSync(tempDir());
		const ctx = makeContext(cwd);
		const created = await run(writeTool, { path: "new/dir/a.txt", content: "hello\n" }, ctx);
		assert.equal(created.isError, undefined);
		assert.equal(readFileSync(join(cwd, "new/dir/a.txt"), "utf8"), "hello\n");
		assert.equal(created.detail?.created, true);

		writeFileSync(join(cwd, "b.txt"), "old\n");
		assert.match(out(await run(writeTool, { path: "b.txt", content: "x" }, ctx)), /Read the file/);
		await run(readTool, { path: "b.txt" }, ctx);
		writeFileSync(join(cwd, "b.txt"), "changed by someone else\n");
		utimesSync(join(cwd, "b.txt"), new Date(), new Date(Date.now() + 5000));
		assert.match(
			out(await run(writeTool, { path: "b.txt", content: "x" }, ctx)),
			/changed after you read it/,
		);
		await run(readTool, { path: "b.txt" }, ctx);
		assert.equal(
			(await run(writeTool, { path: "b.txt", content: "mine\n" }, ctx)).isError,
			undefined,
		);
	});

	test("edit replaces a unique match, keeps CRLF, and shows the changed lines", async () => {
		const cwd = realpathSync(tempDir());
		const ctx = makeContext(cwd);
		writeFileSync(join(cwd, "c.ts"), "const a = 1;\r\nconst b = 2;\r\nconst a2 = 1;\r\n");
		await run(readTool, { path: "c.ts" }, ctx);
		const ambiguous = await run(
			editTool,
			{ path: "c.ts", old_text: "= 1;", new_text: "= 3;" },
			ctx,
		);
		assert.match(out(ambiguous), /appears 2 times/);
		const edited = await run(
			editTool,
			{ path: "c.ts", old_text: "const b = 2;\nconst a2", new_text: "const b = 20;\nconst a2" },
			ctx,
		);
		assert.equal(edited.isError, undefined, out(edited));
		assert.equal(
			readFileSync(join(cwd, "c.ts"), "utf8"),
			"const a = 1;\r\nconst b = 20;\r\nconst a2 = 1;\r\n",
		);
		assert.match(out(edited), /const b = 20;/);
		assert.equal(edited.detail?.added, 1);
		const all = await run(
			editTool,
			{ path: "c.ts", old_text: "= 1;", new_text: "= 9;", replace_all: true },
			ctx,
		);
		assert.match(out(all), /2 replacements/);
	});

	test("todo replaces the session's list", async () => {
		const ctx = makeContext("/");
		await run(todoTool, { items: [{ text: "write tests", status: "in_progress" }] }, ctx);
		assert.deepEqual(ctx.todos, [{ text: "write tests", status: "in_progress" }]);
	});
});

describe("search tools", () => {
	test("glob and grep use ripgrep and report paths relative to the folder", async () => {
		const cwd = realpathSync(tempDir());
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src/a.ts"), "export const needle = 1;\n");
		writeFileSync(join(cwd, "src/b.md"), "no match here\n");
		const ctx = makeContext(cwd);
		assert.equal(out(await run(globTool, { pattern: "**/*.ts" }, ctx)), "src/a.ts");
		assert.equal(
			out(await run(grepTool, { pattern: "needle" }, ctx)),
			"src/a.ts\n1: export const needle = 1;",
		);
		assert.equal(out(await run(grepTool, { pattern: "absent" }, ctx)), "No matches.");
	});

	test("searches leave out what sessions may not read", async () => {
		const cwd = realpathSync(tempDir());
		mkdirSync(join(cwd, ".private"));
		writeFileSync(join(cwd, "open.md"), "needle in the open\n");
		writeFileSync(join(cwd, ".private", "keys.md"), "needle in the keys\n");
		const ctx = makeContext(cwd, {
			offLimits: (path) => path.startsWith(join(cwd, ".private")),
		});
		assert.equal(out(await run(globTool, { pattern: "**/*.md" }, ctx)), "open.md");
		assert.equal(
			out(await run(grepTool, { pattern: "needle" }, ctx)),
			"open.md\n1: needle in the open",
		);
		assert.equal(
			out(await run(grepTool, { pattern: "keys", path: join(cwd, ".private") }, ctx)),
			"No matches.",
		);
	});
});

describe("shell tool", () => {
	test("commands run in SHELL when it is there, else zsh, bash or sh, whichever there is", () => {
		const has =
			(...paths: string[]) =>
			(path: string) =>
				paths.includes(path);
		assert.equal(loginShell({ SHELL: "/opt/fish" }, has("/opt/fish", "/bin/zsh")), "/opt/fish");
		// A container or a service started at login: no SHELL, and on Linux often no zsh.
		assert.equal(loginShell({}, has("/bin/bash", "/bin/sh")), "/bin/bash");
		assert.equal(loginShell({ SHELL: "/bin/zsh" }, has("/bin/sh")), "/bin/sh");
		assert.equal(loginShell({}, has("/usr/bin/zsh", "/bin/bash")), "/usr/bin/zsh");
	});

	test("commands get neither provider keys nor an evaluation's switches", () => {
		const saved = { ...process.env };
		process.env.DEEPSEEK_API_KEY = "sk-test";
		process.env.YEW_SIM = "1";
		process.env.YEW_SIM_RUN = "{}";
		try {
			const env = commandEnvironment("s1");
			assert.equal(env.DEEPSEEK_API_KEY, undefined);
			assert.equal(env.YEW_SIM, undefined);
			assert.equal(env.YEW_SIM_RUN, undefined);
			assert.equal(env.YEW_SESSION, "s1");
		} finally {
			for (const name of ["DEEPSEEK_API_KEY", "YEW_SIM", "YEW_SIM_RUN"]) {
				if (saved[name] === undefined) delete process.env[name];
				else process.env[name] = saved[name];
			}
		}
	});

	test("runs a command and reports the exit code", async () => {
		const ctx = makeContext(realpathSync(tempDir()));
		assert.match(
			out(await run(shellTool, { command: "echo hello" }, ctx)),
			/^Exit code 0\.\nhello/,
		);
		assert.match(out(await run(shellTool, { command: "exit 3" }, ctx)), /^Exit code 3\./);
	});

	test("provider keys are kept out of the environment, and the session is marked", async () => {
		process.env.DEEPSEEK_API_KEY = "sk-should-not-leak";
		try {
			const ctx = makeContext(realpathSync(tempDir()));
			const text = out(
				await run(shellTool, { command: 'echo "[$DEEPSEEK_API_KEY] [$YEW_SESSION]"' }, ctx),
			);
			assert.match(text, /\[\] \[s1\]/);
		} finally {
			delete process.env.DEEPSEEK_API_KEY;
		}
	});

	test("timeouts and stops end the whole process group", async () => {
		const ctx = makeContext(realpathSync(tempDir()));
		const started = Date.now();
		const timedOut = await run(
			shellTool,
			{ command: "sleep 30 & sleep 30; echo never", timeout_seconds: 1 },
			ctx,
		);
		assert.match(out(timedOut), /timeout/);
		assert.ok(Date.now() - started < 10_000);

		const controller = new AbortController();
		const stopped = run(
			shellTool,
			{ command: "sleep 30" },
			makeContext(ctx.session.cwd as string, { signal: controller.signal }),
		);
		setTimeout(() => controller.abort(), 300);
		assert.match(out(await stopped), /Stopped by the user/);
	});

	test("background jobs report their output later", async () => {
		const ctx = makeContext(realpathSync(tempDir()));
		const started = await run(shellTool, { command: "echo from-job", background: true }, ctx);
		assert.match(out(started), /job-1/);
		await ctx.jobs.get("job-1")?.running.done;
		assert.match(
			out(await run(shellJobTool, { job: "job-1" }, ctx)),
			/ended with exit code 0\.\nfrom-job/,
		);
	});
});

describe("web_fetch", () => {
	test("refuses loopback, private and Tailscale addresses", async () => {
		for (const address of [
			"127.0.0.1",
			"10.1.2.3",
			"192.168.1.1",
			"100.100.1.1",
			"::1",
			"fd00::1",
			"::ffff:127.0.0.1",
		]) {
			assert.ok(isPrivateAddress(address), address);
		}
		assert.equal(isPrivateAddress("93.184.216.34"), false);
		const server = createServer((_req, res) => res.end("secret"));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		try {
			const ctx = makeContext("/");
			const direct = await run(webFetchTool, { url: `http://127.0.0.1:${port}/` }, ctx);
			assert.ok(direct.isError);
			assert.match(out(direct), /private address/);
			const named = await run(webFetchTool, { url: `http://localhost:${port}/` }, ctx);
			assert.ok(named.isError);
		} finally {
			server.close();
		}
	});

	test("HTML becomes Markdown with absolute links, without scripts", () => {
		const { title, markdown } = htmlToMarkdown(
			`<html><head><title>Doc</title><script>alert(1)</script></head><body>
			<h1>Hello</h1><p>See <a href="/guide">the guide</a> and <strong>this</strong>.</p>
			<ul><li>one</li><li>two</li></ul><pre><code>x = 1</code></pre>
			<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>`,
			"https://example.com/docs/",
		);
		assert.equal(title, "Doc");
		assert.ok(!markdown.includes("alert"));
		assert.match(markdown, /^# Hello/);
		assert.match(markdown, /\[the guide\]\(https:\/\/example\.com\/guide\)/);
		assert.match(markdown, /\*\*this\*\*/);
		assert.match(markdown, /- one\n- two/);
		assert.match(markdown, /```\nx = 1\n```/);
		assert.match(markdown, /\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
	});
});
