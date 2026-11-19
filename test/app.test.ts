import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { type AppHost, appCommand } from "../src/cli/app.ts";
import { fakeIo } from "./helpers/io.ts";
import { tempDir } from "./helpers/store.ts";

/**
 * A stand-in for the Mac: records the commands; sips and iconutil "succeed" by writing files. By
 * default this installation has the app's program, as a package built on macOS does.
 */
function fakeHost(
	options: {
		platform?: NodeJS.Platform;
		icon?: boolean;
		program?: boolean;
		fail?: "iconutil" | "codesign";
	} = {},
) {
	const calls: string[] = [];
	const homeDir = tempDir("yew-user-");
	let program: string | null = null;
	if (options.program !== false) {
		program = join(homeDir, "dist-mac-Yew");
		writeFileSync(program, "the program");
	}
	const host: AppHost = {
		platform: options.platform ?? "darwin",
		homeDir,
		node: "/opt/node 24/bin/node",
		entry: "/Users/me/it's here/dist/cli/main.js",
		icon: options.icon === false ? null : join(homeDir, "app-icon.png"),
		program,
		run(command, args) {
			calls.push([command, ...args].join(" "));
			if (options.fail === command) return 1;
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

// Paths with spaces and quotes are quoted for the shell.
const YEW = `'/opt/node 24/bin/node' '/Users/me/it'\\''s here/dist/cli/main.js'`;

describe("yew app", () => {
	test("install makes the window app: its program, a script that starts Yew and prints the link, signed ad hoc", async () => {
		const { host, calls, app } = fakeHost();
		const home = tempDir("yew-home-");
		assert.deepEqual(JSON.parse((await run(host, ["status", "--json"])).out), {
			installed: false,
			app,
			window: false,
		});
		const result = await run(host, ["install", "--json"], {
			YEW_HOME: home,
			PATH: "/opt/homebrew/bin:/usr/bin",
		});
		assert.equal(result.code, 0);
		assert.deepEqual(JSON.parse(result.out), { installed: true, app, window: true, icon: true });

		const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
		assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>Yew<\/string>/);
		assert.match(
			plist,
			/<key>CFBundleIdentifier<\/key>\s*<string>cn\.tenonai\.apps\.yew\.desktop<\/string>/,
		);
		assert.match(plist, /<key>LSMinimumSystemVersion<\/key>\s*<string>13\.0<\/string>/);
		// Plain http only to this computer, where Yew Harness answers.
		assert.match(plist, /<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
		// Not LSFileQuarantineEnabled: Yew Harness, which the app starts, and every command of its
		// sessions would mark all they write as downloaded. The app marks what it saves itself.
		assert.doesNotMatch(plist, /LSFileQuarantineEnabled/);
		assert.match(plist, /<key>LSHasLocalizedDisplayName<\/key>\s*<true\/>/);
		assert.equal(
			readFileSync(join(app, "Contents", "Resources", "en.lproj", "InfoPlist.strings"), "utf8"),
			'CFBundleDisplayName = "Yew Harness";\nCFBundleName = "Yew Harness";\n',
		);

		const program = join(app, "Contents", "MacOS", "Yew");
		assert.equal(readFileSync(program, "utf8"), "the program");
		assert.equal(statSync(program).mode & 0o111, 0o111);
		assert.equal(existsSync(join(app, "Contents", "MacOS", "yew-launcher")), false);

		const link = join(app, "Contents", "Resources", "yew-link");
		assert.equal(statSync(link).mode & 0o111, 0o111);
		const script = readFileSync(link, "utf8");
		// The link goes to the window, not to a browser; the window says itself when Yew did not start.
		assert.ok(script.includes(`if ${YEW} open --print 2>/dev/null; then exit 0; fi`));
		assert.ok(
			script.includes(
				`nohup ${YEW} serve < /dev/null >> '${join(home, "logs", "serve.log")}' 2>&1 &`,
			),
		);
		assert.equal(script.includes("osascript"), false);
		assert.ok(script.includes("export PATH='/opt/homebrew/bin:/usr/bin'"));
		assert.ok(script.includes(`export YEW_HOME='${home}'`));

		// Ten icon sizes from the one picture, then the .icns, then the signature over all of it.
		assert.equal(calls.filter((call) => call.startsWith("sips -z ")).length, 10);
		assert.ok(existsSync(join(app, "Contents", "Resources", "AppIcon.icns")));
		const signing = calls.indexOf(`codesign --force --sign - ${app}`);
		assert.ok(signing > calls.findIndex((call) => call.startsWith("iconutil")));
		assert.deepEqual(JSON.parse((await run(host, ["status", "--json"])).out), {
			installed: true,
			app,
			window: true,
		});

		const removed = await run(host, ["uninstall"]);
		assert.match(removed.out, /Removed/);
		assert.equal(existsSync(app), false);
		assert.match((await run(host, ["uninstall"])).out, /was not installed/);
	});

	test("without the program, install makes the launcher that opens the browser", async () => {
		const { host, calls, app } = fakeHost({ program: false });
		const home = tempDir("yew-home-");
		const result = await run(host, ["install"], { YEW_HOME: home, PATH: "/usr/bin" });
		assert.equal(result.code, 0);
		assert.match(result.out, /opens the web interface in your browser/);

		const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
		assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>yew-launcher<\/string>/);
		assert.equal(plist.includes("NSAppTransportSecurity"), false);
		const launcher = join(app, "Contents", "MacOS", "yew-launcher");
		assert.equal(statSync(launcher).mode & 0o111, 0o111);
		const script = readFileSync(launcher, "utf8");
		assert.ok(script.includes(`if ${YEW} open >/dev/null 2>&1; then exit 0; fi`));
		assert.ok(script.includes("osascript -e 'display alert"));
		assert.equal(existsSync(join(app, "Contents", "Resources", "yew-link")), false);
		// Nothing to sign: it is a script.
		assert.equal(
			calls.some((call) => call.startsWith("codesign")),
			false,
		);
		assert.match((await run(host, ["status"])).out, /opens the browser/);
	});

	test("without an icon the app is still made; a failed icon or signature is reported", async () => {
		const plain = fakeHost({ icon: false });
		assert.equal((await run(plain.host, ["install"])).code, 0);
		assert.ok(existsSync(join(plain.app, "Contents", "MacOS", "Yew")));
		assert.equal(
			plain.calls.some((call) => call.startsWith("sips")),
			false,
		);

		const failing = fakeHost({ fail: "iconutil" });
		const result = await run(failing.host, ["install"]);
		assert.equal(result.code, 1);
		assert.match(result.err, /icon could not be made/);
		assert.ok(existsSync(join(failing.app, "Contents", "MacOS", "Yew")));

		const unsigned = fakeHost({ fail: "codesign" });
		const signed = await run(unsigned.host, ["install"]);
		assert.equal(signed.code, 0);
		assert.match(signed.err, /could not be signed/);
		assert.ok(existsSync(join(unsigned.app, "Contents", "MacOS", "Yew")));
	});

	test("other systems and bad arguments are refused", async () => {
		await assert.rejects(run(fakeHost({ platform: "linux" }).host, ["install"]), /works on macOS/);
		await assert.rejects(run(fakeHost().host, ["open"]), /install, uninstall or status/);
		assert.match((await run(fakeHost().host, ["--help"])).out, /Usage: yew app/);
	});
});
