/**
 * A long task against a real model, in a throwaway data folder: one message, then dozens of tool
 * calls, with a low compaction threshold so the context is shortened inside the turn several times.
 * It shows what the scripted tests cannot: how a real provider takes thinking blocks, prompt caching
 * and a shortened context over a long turn.
 *
 * This calls a real model and costs money; it is not part of `npm test`. The key is read from a file
 * (never from a command argument) and kept in memory only:
 *
 *   YEW_SOAK_KEY_FILE=/path/to/key node scripts/soak.ts anthropic claude-haiku-5-5 [files] [thinking] [compactAt]
 *
 * With "code" in place of the number of files, the task is a small coding job instead: a project
 * with one failing test, to be fixed, checked by running the tests, and committed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../src/server/agent/runner.ts";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { ModelGateway } from "../src/server/model/gateway.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import { Store } from "../src/server/store.ts";
import type { ThinkingLevel } from "../src/shared/types.ts";

const [
	provider = "anthropic",
	model = "claude-haiku-5-5",
	count = "40",
	thinking = "low",
	compactAt = "20000",
] = process.argv.slice(2);
const keyFile = process.env.YEW_SOAK_KEY_FILE;
if (!keyFile) {
	process.stderr.write("Set YEW_SOAK_KEY_FILE to a file that holds the provider's API key.\n");
	process.exit(2);
}
const coding = count === "code";
const files = coding ? 0 : Number(count);
const home = realpathSync(mkdtempSync(join(tmpdir(), "yew-soak-home-")));
const cwd = realpathSync(mkdtempSync(join(tmpdir(), "yew-soak-cwd-")));
const name = (i: number) => `note-${String(i).padStart(3, "0")}.txt`;
let expected = 0;
for (let i = 1; i <= files; i++) {
	const value = (i * 7919) % 1000;
	expected += value;
	const filler = Array.from(
		{ length: 60 },
		(_, n) => `line ${n} of note ${i}: nothing to see here.`,
	);
	filler.splice(30, 0, `VALUE=${value}`);
	writeFileSync(join(cwd, name(i)), `${filler.join("\n")}\n`);
}

const git = (...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
if (coding) {
	mkdirSync(join(cwd, "src"));
	mkdirSync(join(cwd, "test"));
	writeFileSync(
		join(cwd, "package.json"),
		`${JSON.stringify({ name: "slug", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
	);
	writeFileSync(
		join(cwd, "src/slug.js"),
		'export function slug(text) {\n\treturn text.toLowerCase().replace(/[^a-z0-9]/g, "-");\n}\n',
	);
	writeFileSync(
		join(cwd, "test/slug.test.js"),
		[
			'import assert from "node:assert/strict";',
			'import { test } from "node:test";',
			'import { slug } from "../src/slug.js";',
			"",
			'test("lowercases", () => assert.equal(slug("Hello"), "hello"));',
			'test("joins words with one dash", () => assert.equal(slug("Hello,  World"), "hello-world"));',
			'test("no dash at either end", () => assert.equal(slug(" Hello! "), "hello"));',
			"",
		].join("\n"),
	);
	git("init", "-q", "-b", "main");
	git("add", ".");
	git(
		"-c",
		"user.name=soak",
		"-c",
		"user.email=soak@example.invalid",
		"commit",
		"-q",
		"-m",
		"start",
	);
	git("config", "user.name", "soak");
	git("config", "user.email", "soak@example.invalid");
}

const bus = new EventBus();
const store = new Store(openDatabase(":memory:"), bus);
const gateway = new ModelGateway({
	keys: new MemoryKeyStore({ [provider]: readFileSync(keyFile, "utf8").trim() }),
	version: "soak",
});
const log = (line: string) => process.stderr.write(`${line}\n`);
const agents = new Agents({
	store,
	gateway,
	permissions: new PermissionEngine(home),
	home,
	version: "soak",
	log,
});
const session = store.createSession({
	name: "soak",
	kind: "task",
	provider,
	model,
	cwd,
	thinking: thinking as ThinkingLevel,
	options: { permissionMode: "skip", compactAt: Number(compactAt) },
});
bus.subscribe((event) => {
	if (event.scope === "live" && event.event.type === "retrying") {
		log(`  retrying: ${JSON.stringify(event.event)}`);
	}
});

const started = Date.now();
const task = coding
	? "这个项目的测试有没通过的。找出原因修好，跑测试确认全部通过，然后提交。"
	: `This folder has ${files} files named ${name(1)} to ${name(files)}. Each has one line "VALUE=<number>". Read them one at a time with the read tool, one file per step, in order; do not use the shell or search tools. After every 10 files, write the running total to total.txt. When all are read, reply with exactly "TOTAL=<sum>".`;
agents.send(session.id, task);
const tick = setInterval(() => {
	const now = store.getSession(session.id);
	log(
		`  ${Math.round((Date.now() - started) / 1000)}s status=${now.status} context=${now.contextTokens} cost=$${now.usage.cost.toFixed(4)}`,
	);
	// Nobody answers here: a session that waits for the person would wait for ever.
	if (now.status === "waiting") {
		for (const approval of store.pendingApprovals(session.id)) {
			log(`  waiting for the person: ${JSON.stringify(approval.request).slice(0, 600)}`);
		}
		agents.stop(session.id);
	}
}, 15_000);
await agents.whenIdle(session.id);
clearInterval(tick);

const end = store.getSession(session.id);
const all = store.listEntries(session.id, { limit: 250 }).entries;
const last = [...store.contextEntries(session.id)]
	.reverse()
	.find((entry) => entry.role === "assistant");
const lastReply =
	last?.role === "assistant"
		? last.message.content
				.flatMap((block) => (block.type === "text" ? [block.text] : []))
				.join("\n")
		: "";
let total: string | null = null;
try {
	total = readFileSync(join(cwd, "total.txt"), "utf8").trim();
} catch {}
let code: { testsPass: boolean; commits: number; clean: boolean } | null = null;
if (coding) {
	let testsPass = true;
	try {
		execFileSync("node", ["--test"], { cwd, stdio: "ignore" });
	} catch {
		testsPass = false;
	}
	code = {
		testsPass,
		commits: Number(git("rev-list", "--count", "HEAD")),
		clean: git("status", "--porcelain") === "",
	};
}
const ok = coding
	? Boolean(code?.testsPass && code.commits >= 2 && code.clean)
	: lastReply.includes(`TOTAL=${expected}`);
process.stdout.write(
	`${JSON.stringify(
		{
			provider,
			model,
			thinking,
			seconds: Math.round((Date.now() - started) / 1000),
			status: end.status,
			statusDetail: end.statusDetail,
			expected: coding ? "tests pass, a new commit, a clean tree" : `TOTAL=${expected}`,
			code,
			lastReply,
			totalFile: total,
			toolCalls: store.toolCallsByStatus(session.id, ["done", "error", "denied"]).length,
			toolErrors: store.toolCallsByStatus(session.id, ["error", "denied"]).length,
			notices: all.flatMap((entry) =>
				entry.role === "notice" ? [`${entry.notice.kind}: ${entry.notice.text ?? ""}`] : [],
			),
			usage: end.usage,
			contextTokens: end.contextTokens,
		},
		null,
		2,
	)}\n`,
);
agents.shutdown();
process.exit(end.status === "idle" && ok ? 0 : 1);
