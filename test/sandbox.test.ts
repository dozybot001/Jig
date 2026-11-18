import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
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
		const profile = seatbeltProfile(
			{ ...where, home: join(where.root, 'da"ta') },
			{ readable: ["mcp-presets"], writable: [where.root] },
		);
		// Writes: nothing but the listed folders, and never a repository's hooks or settings.
		assert.ok(profile.indexOf("(deny file-write*)") < profile.indexOf(`(subpath "${where.root}")`));
		assert.ok(
			profile.includes(
				'(deny file-write* (regex #"/\\.git/hooks(/|$)") (regex #"/\\.git/config$"))',
			),
		);
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

	test("bubblewrap keeps the system read-only, hides the data folder and the session bus", () => {
		const where = places();
		const args = bubblewrapArguments(where, { readable: ["mcp-presets"], writable: [where.root] });
		const line = args.join(" ");
		assert.deepEqual(args.slice(0, 3), ["--ro-bind", "/", "/"]);
		assert.ok(line.includes(`--bind ${where.root} ${where.root}`));
		assert.ok(line.includes(`--ro-bind-try ${where.root}/.git/hooks ${where.root}/.git/hooks`));
		assert.ok(line.indexOf(`--tmpfs ${where.home}`) > line.indexOf(`--bind ${where.root}`));
		assert.ok(line.includes(`--ro-bind ${where.home}/mcp-presets ${where.home}/mcp-presets`));
		assert.ok(line.includes(`--ro-bind ${where.install} ${where.install}`));
		assert.ok(line.includes("--unsetenv DBUS_SESSION_BUS_ADDRESS"));
		assert.match(line, /--tmpfs \/run\/user\/\d+/);
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
			// Nothing outside the working folder can be planted, such as a startup file in the home folder
			// (a probe file here, removed if the sandbox ever let it through).
			const probe = join(homedir(), `.yew-sandbox-probe-${process.pid}`);
			const planted = await run(`echo evil > '${probe}'`, cwd);
			const leaked = existsSync(probe);
			rmSync(probe, { force: true });
			assert.notEqual(planted.exitCode, 0);
			assert.equal(leaked, false);
			// In a repository, commits go on; its hooks and settings stay as they are. Making a new one
			// (init, clone) writes both, so it runs outside the sandbox, after the person agrees.
			const made = await run("git init -q r", cwd, true);
			assert.equal(made.exitCode, 0, made.output);
			const repo = await run(
				"cd r && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m one && git log --oneline | wc -l",
				cwd,
			);
			assert.equal(repo.exitCode, 0, repo.output);
			assert.notEqual((await run("git init -q other", cwd)).exitCode, 0);
			const hook = await run("echo evil > r/.git/hooks/pre-push", cwd);
			assert.notEqual(hook.exitCode, 0);
			const config = await run("git -C r config core.hooksPath /tmp/elsewhere", cwd);
			assert.notEqual(config.exitCode, 0);
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
