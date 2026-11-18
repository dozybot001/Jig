import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { type AppHost, appCommand } from "../src/cli/app.ts";
import { fakeIo } from "./helpers/io.ts";
import { tempDir } from "./helpers/store.ts";

/** A stand-in for the Mac: records the commands; sips and iconutil "succeed" by writing files. */
function fakeHost(options: { platform?: NodeJS.Platform; icon?: boolean; fail?: boolean } = {}) {
	const calls: string[] = [];
	const homeDir = tempDir("yew-user-");
	const host: AppHost = {
		platform: options.platform ?? "darwin",
		homeDir,
		node: "/opt/node 24/bin/node",
		entry: "/Users/me/it's here/dist/cli/main.js",
		icon: options.icon === false ? null : join(homeDir, "app-icon.png"),
		run(command, args) {
			calls.push([command, ...args].join(" "));
			if (options.fail && command === "iconutil") return 1;
			if (command === "iconutil") writeFileSync(args[4] as string, "icns");
			return 0;
		},
	};
	return { host, calls, app: join(homeDir, "Applications", "Yew.app") };
}

const run = (host: AppHost, args: string[], env: Record<string, string> = {}) => {
	const { io, stdout, stderr } = fakeIo({ env });
	return appCommand(host)
		.run(args, io)
		.then((code) => ({ code, out: stdout.text(), err: stderr.text() }));
};

describe("yew app", () => {
	test("install makes an app that opens Yew, starting it first when it is not running", async () => {
		const { host, calls, app } = fakeHost();
		const home = tempDir("yew-home-");
		assert.deepEqual(JSON.parse((await run(host, ["status", "--json"])).out), {
			installed: false,
			app,
		});
		const result = await run(host, ["install"], {
			YEW_HOME: home,
			PATH: "/opt/homebrew/bin:/usr/bin",
		});
		assert.equal(result.code, 0);
		assert.match(result.out, /Applications folder/);

		const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
		assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>yew-launcher<\/string>/);
		assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>AppIcon<\/string>/);
		const launcher = join(app, "Contents", "MacOS", "yew-launcher");
		assert.equal(statSync(launcher).mode & 0o111, 0o111);
		const script = readFileSync(launcher, "utf8");
		// Paths with spaces and quotes are quoted for the shell.
		const yew = `'/opt/node 24/bin/node' '/Users/me/it'\\''s here/dist/cli/main.js'`;
		assert.ok(script.includes(`if ${yew} open >/dev/null 2>&1; then exit 0; fi`));
		assert.ok(script.includes(`nohup ${yew} serve >> '${join(home, "logs", "serve.log")}' 2>&1 &`));
		assert.ok(script.includes("export PATH='/opt/homebrew/bin:/usr/bin'"));
		assert.ok(script.includes(`export YEW_HOME='${home}'`));

		// Ten icon sizes from the one picture, then the .icns.
		assert.equal(calls.filter((call) => call.startsWith("sips -z ")).length, 10);
		assert.ok(calls.some((call) => call.includes("icon_512x512@2x.png")));
		assert.ok(existsSync(join(app, "Contents", "Resources", "AppIcon.icns")));
		assert.equal(JSON.parse((await run(host, ["status", "--json"])).out).installed, true);

		const removed = await run(host, ["uninstall"]);
		assert.match(removed.out, /Removed/);
		assert.equal(existsSync(app), false);
		assert.match((await run(host, ["uninstall"])).out, /was not installed/);
	});

	test("without an icon the app is still made; a failed icon is reported", async () => {
		const plain = fakeHost({ icon: false });
		assert.equal((await run(plain.host, ["install"])).code, 0);
		assert.ok(existsSync(join(plain.app, "Contents", "MacOS", "yew-launcher")));
		assert.equal(
			plain.calls.some((call) => call.startsWith("sips")),
			false,
		);

		const failing = fakeHost({ fail: true });
		const result = await run(failing.host, ["install"]);
		assert.equal(result.code, 1);
		assert.match(result.err, /icon could not be made/);
		assert.ok(existsSync(join(failing.app, "Contents", "MacOS", "yew-launcher")));
	});

	test("other systems and bad arguments are refused", async () => {
		await assert.rejects(run(fakeHost({ platform: "linux" }).host, ["install"]), /works on macOS/);
		await assert.rejects(run(fakeHost().host, ["open"]), /install, uninstall or status/);
		assert.match((await run(fakeHost().host, ["--help"])).out, /Usage: yew app/);
	});
});
