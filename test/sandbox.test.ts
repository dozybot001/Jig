import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, test } from "node:test";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import {
	bubblewrapArguments,
	NO_SANDBOX,
	seatbeltProfile,
	setSandbox,
	systemSandbox,
} from "../src/server/sandbox.ts";
import { startCommand } from "../src/server/tools/process.ts";
import type { Session } from "../src/shared/types.ts";
import { tempDir } from "./helpers/store.ts";

function places() {
	const root = realpathSync(tempDir("yew-sandbox-"));
	const home = join(root, "data");
	const install = join(root, "install");
	const userHome = join(root, "user");
	for (const dir of [home, install, userHome]) mkdirSync(dir, { recursive: true });
	return { root, home, install, userHome, port: 4777 };
}

async function run(command: string, cwd: string, outsideSandbox = false) {
	const running = startCommand({
		command,
		cwd,
		sessionId: "s1",
		logDir: join(cwd, "logs"),
		outsideSandbox,
	});
	const { exitCode } = await running.done;
	return { exitCode, output: running.output.render() };
}

describe("the system sandbox (blueprint, section 11)", () => {
	test("its Seatbelt profile allows everything but the data folder, the program, the port and the keychain", () => {
		const where = places();
		const profile = seatbeltProfile({ ...where, home: join(where.root, 'da"ta') }, ["mcp-presets"]);
		assert.match(profile, /^\(version 1\)\n\(allow default\)/);
		assert.ok(profile.includes(`(deny file-read* file-write* (subpath "${where.root}/da\\"ta"))`));
		// A folder it may still read comes after the deny, which it overrides.
		assert.ok(
			profile.indexOf("(allow file-read* (subpath") >
				profile.indexOf("(deny file-read* file-write*"),
		);
		assert.ok(profile.includes(`(deny file-write* (subpath "${where.install}"))`));
		assert.ok(
			profile.includes(`(deny file-write* (subpath "${where.userHome}/Library/LaunchAgents"))`),
		);
		assert.ok(profile.includes('(deny network-outbound (remote ip "localhost:4777"))'));
		assert.match(profile, /\(deny mach-lookup \(global-name "com\.apple\.SecurityServer"\)/);
	});

	test("bubblewrap hides the data folder and keeps the program read-only", () => {
		const where = places();
		const args = bubblewrapArguments(where, ["mcp-presets"]);
		assert.deepEqual(args.slice(0, 5), ["--dev-bind", "/", "/", "--tmpfs", where.home]);
		assert.ok(
			args.join(" ").includes(`--ro-bind ${where.home}/mcp-presets ${where.home}/mcp-presets`),
		);
		assert.ok(args.join(" ").includes(`--ro-bind ${where.install} ${where.install}`));
		assert.equal(args.at(-1), "--");
	});

	test("each system gets the sandbox it has, and none where it has none", () => {
		const where = places();
		assert.equal(systemSandbox(where, "linux", () => true).kind, "bubblewrap");
		assert.equal(systemSandbox(where, "linux", () => false).kind, "none");
		assert.equal(systemSandbox(where, "win32", () => true).kind, "none");
		const wrapped = systemSandbox(where, "linux", () => true).wrap("/bin/zsh", ["-lc", "ls"]);
		assert.equal(wrapped.command, "bwrap");
		assert.deepEqual(wrapped.args.slice(-3), ["/bin/zsh", "-lc", "ls"]);
	});

	test("on macOS a command cannot read the data folder or reach the port, unless approved to run outside", {
		skip: process.platform !== "darwin",
	}, async () => {
		const where = places();
		writeFileSync(join(where.home, "yew.db"), "the person's decisions");
		const server = createServer((_req, res) => res.end("answered"));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		setSandbox(systemSandbox({ ...where, port }));
		try {
			const cwd = where.root;
			const read = await run(`cat '${join(where.home, "yew.db")}'`, cwd);
			assert.notEqual(read.exitCode, 0);
			assert.match(read.output, /Operation not permitted/);
			const write = await run(`echo x > '${join(where.home, "new.txt")}'`, cwd);
			assert.notEqual(write.exitCode, 0);
			const port_ = await run(`curl -s --max-time 3 http://127.0.0.1:${port}/`, cwd);
			assert.notEqual(port_.exitCode, 0);
			assert.doesNotMatch(port_.output, /answered/);
			// Everything else works as usual.
			const work = await run("echo ok > made.txt && cat made.txt", cwd);
			assert.equal(work.exitCode, 0);
			assert.match(work.output, /ok/);
			// Approved to run outside, the same command reads the file.
			const outside = await run(`cat '${join(where.home, "yew.db")}'`, cwd, true);
			assert.equal(outside.exitCode, 0);
			assert.match(outside.output, /the person's decisions/);
		} finally {
			setSandbox(NO_SANDBOX);
			server.close();
		}
	});

	test("a command asked to run outside the sandbox is asked about every time, in every mode", () => {
		const engine = new PermissionEngine(tempDir("yew-home-"));
		const session = {
			id: "s1",
			cwd: tempDir("yew-work-"),
			rules: [],
			options: { permissionMode: "skip" },
		} as unknown as Session;
		const decision = engine.decide(
			{ kind: "command", tool: "shell", command: "git push", outsideSandbox: true },
			session,
		);
		assert.equal(decision.effect, "ask");
		assert.ok(decision.effect === "ask" && decision.request.mustConfirm);
		assert.ok(decision.effect === "ask" && decision.request.reasons?.includes("outside-sandbox"));
		// The same harmless command, in the sandbox, runs without asking.
		assert.equal(
			engine.decide({ kind: "command", tool: "shell", command: "ls" }, session).effect,
			"allow",
		);
		assert.equal(
			engine.decide(
				{ kind: "command", tool: "shell", command: "ls", outsideSandbox: true },
				session,
			).effect,
			"ask",
		);
	});
});
