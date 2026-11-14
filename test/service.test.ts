import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SERVICE_LABEL, type ServiceHost, serviceCommand } from "../src/cli/service.ts";
import { fakeIo } from "./helpers/io.ts";
import { tempDir } from "./helpers/store.ts";

/** A stand-in for launchd or systemd: records the commands, and knows what is loaded. */
function fakeHost(platform: NodeJS.Platform, fail = false) {
	const calls: string[] = [];
	let loaded = false;
	const host: ServiceHost = {
		platform,
		homeDir: tempDir("jig-user-"),
		uid: 501,
		node: "/opt/node 24/bin/node",
		entry: "/Users/me/Jig & co/src/cli/main.ts",
		run(command, args) {
			calls.push([command, ...args].join(" "));
			const verb = command === "launchctl" ? args[0] : args[1];
			if (verb === "print" || verb === "is-enabled") return loaded ? 0 : 1;
			if (verb === "bootstrap" || verb === "enable") {
				if (fail) return 5;
				loaded = true;
			}
			if (verb === "bootout" || verb === "disable") loaded = false;
			return 0;
		},
	};
	return { host, calls };
}

const run = (host: ServiceHost, args: string[], env: Record<string, string>) => {
	const { io, stdout, stderr } = fakeIo({ env });
	return serviceCommand(host)
		.run(args, io)
		.then((code) => ({ code, out: stdout.text(), err: stderr.text() }));
};

describe("jig service", () => {
	test("install on macOS writes a LaunchAgent that starts jig serve and loads it", async () => {
		const { host, calls } = fakeHost("darwin");
		const home = tempDir("jig-home-");
		const env = { JIG_HOME: home, PATH: "/opt/homebrew/bin:/usr/bin" };
		const file = join(host.homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);

		const before = await run(host, ["status", "--json"], env);
		assert.deepEqual(JSON.parse(before.out), { installed: false, running: false, file });

		const installed = await run(host, ["install"], env);
		assert.equal(installed.code, 0);
		const plist = readFileSync(file, "utf8");
		assert.match(plist, /<string>\/opt\/node 24\/bin\/node<\/string>/);
		// Paths are escaped for XML.
		assert.match(plist, /<string>\/Users\/me\/Jig &amp; co\/src\/cli\/main\.ts<\/string>/);
		assert.match(plist, /<string>serve<\/string>/);
		assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
		assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
		assert.match(plist, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin<\/string>/);
		assert.match(plist, /<key>JIG_HOME<\/key>/);
		assert.ok(plist.includes(join(home, "logs", "serve.log")));
		assert.ok(existsSync(join(home, "logs")));
		assert.ok(calls.includes(`launchctl bootstrap gui/501 ${file}`));
		assert.match(installed.out, /starts when you log in/);

		const status = await run(host, ["status", "--json"], env);
		assert.equal(JSON.parse(status.out).installed, true);

		const removed = await run(host, ["uninstall"], env);
		assert.equal(removed.code, 0);
		assert.equal(existsSync(file), false);
		assert.ok(calls.includes(`launchctl bootout gui/501/${SERVICE_LABEL}`));
		const again = await run(host, ["uninstall"], env);
		assert.match(again.out, /was not set to start at login/);
	});

	test("install on Linux writes a systemd user unit and enables it", async () => {
		const { host, calls } = fakeHost("linux");
		const env = { JIG_HOME: tempDir("jig-home-"), PATH: "/usr/bin" };
		const file = join(host.homeDir, ".config", "systemd", "user", "jig.service");
		assert.equal((await run(host, ["install", "--json"], env)).code, 0);
		const unit = readFileSync(file, "utf8");
		assert.match(
			unit,
			/ExecStart="\/opt\/node 24\/bin\/node" "\/Users\/me\/Jig & co\/src\/cli\/main\.ts" serve/,
		);
		assert.match(unit, /Restart=on-failure/);
		assert.match(unit, /WantedBy=default\.target/);
		assert.deepEqual(calls.slice(-2), [
			"systemctl --user daemon-reload",
			"systemctl --user enable --now jig.service",
		]);
		await run(host, ["uninstall"], env);
		assert.equal(existsSync(file), false);
		assert.ok(calls.includes("systemctl --user disable --now jig.service"));
	});

	test("install refuses while a Jig started by hand is running", async () => {
		const { host, calls } = fakeHost("darwin");
		const home = tempDir("jig-home-");
		writeFileSync(
			join(home, "serve.json"),
			JSON.stringify({ port: 4777, pid: process.pid, startedAt: Date.now() }),
		);
		const result = await run(host, ["install"], { JIG_HOME: home });
		assert.equal(result.code, 1);
		assert.match(result.err, /already running/);
		assert.equal(
			calls.some((call) => call.includes("bootstrap")),
			false,
		);
	});

	test("a failed start is an error; other systems and bad arguments are refused", async () => {
		const { host } = fakeHost("darwin", true);
		const failed = await run(host, ["install"], { JIG_HOME: tempDir("jig-home-") });
		assert.equal(failed.code, 1);
		assert.match(failed.err, /could not start the service/);
		await assert.rejects(run(fakeHost("win32").host, ["status"], {}), /macOS and Linux/);
		await assert.rejects(run(host, ["restart"], {}), /install, uninstall or status/);
		const help = await run(host, ["--help"], {});
		assert.match(help.out, /Usage: jig service/);
	});
});
