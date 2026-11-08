import assert from "node:assert/strict";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { type Decision, PermissionEngine, type Subject } from "../src/server/permissions/engine.ts";
import { parseShell, rememberPrefix, unwrap } from "../src/server/permissions/shell.ts";
import type { PermissionRule, Session } from "../src/shared/types.ts";
import { tempDir } from "./helpers/store.ts";

const cwd = realpathSync(tempDir("jig-perm-"));
const outsideDir = realpathSync(tempDir("jig-outside-"));
const jigHome = realpathSync(tempDir("jig-home-"));
const engine = new PermissionEngine(jigHome);

function session(overrides: Partial<Session> = {}): Session {
	return {
		id: "s",
		name: "s",
		kind: "task",
		groupId: null,
		responsibility: "",
		cwd,
		provider: "faux",
		model: "faux",
		thinking: "off",
		rules: [],
		options: {},
		todos: [],
		status: "idle",
		statusDetail: null,
		pinned: false,
		unread: 0,
		archivedAt: null,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		contextTokens: 0,
		eventSeq: 0,
		lastActivityAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

const shell = (command: string, s = session()) =>
	engine.decide({ kind: "command", tool: "shell", command }, s);

function askOf(decision: Decision) {
	assert.equal(decision.effect, "ask", JSON.stringify(decision));
	return decision.effect === "ask" ? decision.request : undefined;
}

describe("shell parser", () => {
	test("splits on operators but not inside quotes", () => {
		const parsed = parseShell(`git status && npm test; echo "a && b" | wc -l`);
		assert.ok(parsed.understood);
		assert.deepEqual(
			parsed.segments.map((s) => s.argv),
			[
				["git", "status"],
				["npm", "test"],
				["echo", "a && b"],
				["wc", "-l"],
			],
		);
	});

	test("records redirects and file descriptors", () => {
		const parsed = parseShell("npm test 2>&1 > out.log");
		assert.deepEqual(parsed.segments[0]?.redirects, [
			{ op: "2>&", target: "1" },
			{ op: ">", target: "out.log" },
		]);
	});

	test("flags expansions and gives up on constructs it does not follow", () => {
		assert.ok(parseShell("echo $(whoami)").segments[0]?.dynamic);
		assert.ok(parseShell('echo "$HOME"').segments[0]?.dynamic);
		assert.equal(parseShell("echo '$HOME'").segments[0]?.dynamic, false);
		for (const command of [
			"(cd x && ls)",
			"cat <<EOF\nhi\nEOF",
			"echo 'open",
			"diff <(ls a) <(ls b)",
		]) {
			assert.equal(parseShell(command).understood, false, command);
		}
	});

	test("unwraps sudo, env, xargs and shell -c", () => {
		assert.deepEqual(unwrap(["sudo", "-u", "root", "rm", "-rf", "/x"]).commands, [
			["rm", "-rf", "/x"],
		]);
		assert.ok(unwrap(["sudo", "ls"]).privileged);
		assert.deepEqual(unwrap(["env", "A=1", "B=2", "git", "push"]).commands, [["git", "push"]]);
		assert.deepEqual(unwrap(["xargs", "-n", "1", "rm"]).commands, [["rm"]]);
		assert.deepEqual(unwrap(["bash", "-c", "ls && rm x"]).commands, [["ls"], ["rm", "x"]]);
		assert.deepEqual(unwrap(["FOO=1", "npm", "test"]).commands, [["npm", "test"]]);
	});

	test("remembers commands at the right depth", () => {
		assert.equal(rememberPrefix(["git", "status", "--short"]), "git status");
		assert.equal(rememberPrefix(["npm", "run", "build", "--", "--watch"]), "npm run build");
		assert.equal(rememberPrefix(["npm", "test"]), "npm test");
		assert.equal(rememberPrefix(["node", "scripts/x.js"]), "node scripts/x.js");
		assert.equal(rememberPrefix(["ls", "-la"]), "ls");
	});
});

describe("shell permissions", () => {
	test("read-only commands inside the working folder run without asking", () => {
		for (const command of [
			"git status",
			"git diff HEAD~1 -- src",
			"git log --oneline -5",
			"ls -la src",
			"rg TODO src | head -20",
			"find . -name '*.ts'",
			"cat package.json",
			"npm --version",
			"git branch",
		]) {
			assert.equal(shell(command).effect, "allow", command);
		}
	});

	test("anything else asks, offering to remember its prefix", () => {
		assert.deepEqual(askOf(shell("npm test"))?.rememberRules, [
			{ effect: "allow", tool: "shell", pattern: "npm test" },
		]);
		assert.deepEqual(askOf(shell("git status && npm run build -- --watch"))?.rememberRules, [
			{ effect: "allow", tool: "shell", pattern: "npm run build" },
		]);
		for (const command of [
			"cat ~/.ssh/id_rsa",
			"ls ../",
			`cat ${outsideDir}/x`,
			"git -c core.pager=evil log",
			"find . -exec cat {} \\;",
			"rg --pre ./x foo",
			"echo $(whoami)",
			"git branch new-feature",
		]) {
			assert.equal(shell(command).effect, "ask", command);
		}
	});

	test("a chat session without a working folder asks even for read-only commands", () => {
		assert.equal(shell("ls", session({ cwd: null })).effect, "ask");
	});

	test("must-confirm operations always ask and cannot be remembered", () => {
		for (const command of [
			"rm -rf build",
			"git push origin main",
			"git reset --hard HEAD~1",
			"git clean -fd",
			"git checkout -- .",
			"npm publish",
			"ssh prod uptime",
			"scp a.txt prod:/tmp/",
			"curl -d a=1 https://example.com",
			"curl -X POST https://example.com",
			"sudo ls",
			"bash -c 'rm -rf x'",
			"xargs rm < list.txt",
			"find . -delete",
			"echo hi > /tmp/jig-outside.txt",
			"FOO=1 env BAR=2 git push",
		]) {
			const request = askOf(shell(command));
			assert.ok(request?.mustConfirm, command);
			assert.equal(request?.rememberRules, undefined, command);
		}
	});

	test("must-confirm stays even when a rule allows the command", () => {
		const rules: PermissionRule[] = [{ effect: "allow", tool: "shell", pattern: "git" }];
		assert.ok(askOf(shell("git push", session({ rules })))?.mustConfirm);
		assert.equal(shell("git commit -m x", session({ rules })).effect, "allow");
	});

	test("rules: deny beats ask beats allow", () => {
		const rules: PermissionRule[] = [
			{ effect: "allow", tool: "shell", pattern: "npm" },
			{ effect: "deny", tool: "shell", pattern: "npm run deploy" },
			{ effect: "ask", tool: "shell", pattern: "npm install" },
		];
		const s = session({ rules });
		assert.equal(shell("npm test", s).effect, "allow");
		assert.equal(shell("npm run deploy", s).effect, "deny");
		assert.equal(shell("npm install left-pad", s).effect, "ask");
		assert.equal(shell("npm test && npm run deploy", s).effect, "deny");
		assert.equal(
			shell(
				"npm run builder",
				session({ rules: [{ effect: "allow", tool: "shell", pattern: "npm run build" }] }),
			).effect,
			"ask",
		);
	});

	test("writing a file inside the folder through a redirect asks", () => {
		const request = askOf(shell("echo hi > notes.txt"));
		assert.equal(request?.mustConfirm, false);
	});
});

describe("file permissions", () => {
	const read = (path: string, s = session()): Decision =>
		engine.decide(
			{ kind: "read", tool: "read", paths: [path], summary: path } satisfies Subject,
			s,
		);
	const write = (path: string, s = session()): Decision =>
		engine.decide({ kind: "write", tool: "write", paths: [path], summary: path }, s);

	test("reads inside the folder are allowed; outside asks and remembers the folder", () => {
		assert.equal(read(join(cwd, "src/a.ts")).effect, "allow");
		assert.deepEqual(askOf(read(join(outsideDir, "notes/a.md")))?.rememberRules, [
			{ effect: "allow", tool: "read", pattern: join(outsideDir, "notes") },
		]);
		const remembered = session({ rules: [{ effect: "allow", tool: "read", pattern: outsideDir }] });
		assert.equal(read(join(outsideDir, "notes/a.md"), remembered).effect, "allow");
	});

	test("credential locations and Jig's own data are refused", () => {
		assert.equal(read(join(homedir(), ".ssh", "id_ed25519")).effect, "deny");
		assert.equal(read(join(jigHome, "jig.db")).effect, "deny");
		assert.equal(write(join(homedir(), ".aws", "credentials")).effect, "deny");
	});

	test("writes ask, unless direct edits are on; outside the folder they must be confirmed", () => {
		assert.deepEqual(askOf(write(join(cwd, "a.ts")))?.rememberRules, [
			{ effect: "allow", tool: "write", pattern: "**" },
		]);
		assert.equal(
			write(join(cwd, "a.ts"), session({ options: { directEdits: true } })).effect,
			"allow",
		);
		const outside = askOf(
			write(join(outsideDir, "a.ts"), session({ options: { directEdits: true } })),
		);
		assert.ok(outside?.mustConfirm);
	});

	test("path rules use globs relative to the working folder", () => {
		const s = session({ rules: [{ effect: "allow", tool: "write", pattern: "src/**" }] });
		assert.equal(write(join(cwd, "src/deep/a.ts"), s).effect, "allow");
		assert.equal(write(join(cwd, "README.md"), s).effect, "ask");
	});

	test("a symlink cannot lead a write out of the folder unnoticed", () => {
		mkdirSync(join(outsideDir, "target"), { recursive: true });
		writeFileSync(join(outsideDir, "target", "f.txt"), "x");
		symlinkSync(join(outsideDir, "target"), join(cwd, "link"));
		const engineSubject: Subject = {
			kind: "write",
			tool: "write",
			paths: [realpathSync(join(cwd, "link", "f.txt"))],
			summary: "link/f.txt",
		};
		assert.ok(
			askOf(engine.decide(engineSubject, session({ options: { directEdits: true } })))?.mustConfirm,
		);
	});
});

describe("web permissions", () => {
	const fetchUrl = (url: string, rules: PermissionRule[] = []) =>
		engine.decide({ kind: "url", tool: "web_fetch", url }, session({ rules }));

	test("asks per domain and remembers it", () => {
		assert.deepEqual(askOf(fetchUrl("https://docs.example.com/a"))?.rememberRules, [
			{ effect: "allow", tool: "web_fetch", pattern: "docs.example.com" },
		]);
		const rules: PermissionRule[] = [
			{ effect: "allow", tool: "web_fetch", pattern: "*.example.com" },
		];
		assert.equal(fetchUrl("https://docs.example.com/a", rules).effect, "allow");
		assert.equal(fetchUrl("https://example.com/a", rules).effect, "allow");
		assert.equal(fetchUrl("https://example.org/a", rules).effect, "ask");
	});
});
