import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PRODUCT, VERSION } from "../shared/version.ts";
import { type CliIo, EXIT_ERROR, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";

const HELP = `Usage: yew app <install|uninstall|status> [options]

Put Yew Harness in your Applications folder (macOS). It opens in a window of
its own with an icon in the Dock, and starts Yew Harness in the background
first if it is not running. Closing the window or quitting the app leaves Yew
Harness running, so sessions keep working.

The app runs the same yew you run in a terminal, with the Node.js found now.
Run install again after you move or update Node.js or Yew Harness. A copy of
Yew Harness not built on macOS has no app program; then the icon opens the
web interface in your browser instead.

Commands:
  install    Create ~/Applications/Yew.app
  uninstall  Remove it; Yew Harness itself and your data stay
  status     Show whether it is there

Options:
      --json  Print as JSON
  -h, --help  Show this help
`;

/** What the command touches on the system, so tests can stand in for it. */
export interface AppHost {
	platform: NodeJS.Platform;
	homeDir: string;
	node: string;
	entry: string;
	/** The icon as a 1024 px PNG; null when this installation has none. */
	icon: string | null;
	/**
	 * The Mac app's program (macos/, built into dist/mac/Yew on macOS); null when this installation
	 * has none, and the icon is then a launcher that opens the browser.
	 */
	program: string | null;
	/** Runs a system command; returns its exit code (null when it could not start). */
	run(command: string, args: string[]): number | null;
}

export function realAppHost(): AppHost {
	const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
	const icon = ["../../web/dist/icons/app-icon.png", "../../web/public/icons/app-icon.png"]
		.map(here)
		.find((path) => existsSync(path));
	// From src/cli in a checkout and from dist/cli in the package, the same place.
	const program = here("../../dist/mac/Yew");
	return {
		platform: process.platform,
		homeDir: homedir(),
		node: process.execPath,
		entry: here(import.meta.url.endsWith(".ts") ? "./main.ts" : "./main.js"),
		icon: icon ?? null,
		program: existsSync(program) ? program : null,
		run: (command, args) => spawnSync(command, args, { stdio: "ignore" }).status,
	};
}

const xml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A value inside single quotes in a shell script. */
const quoted = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Shown for the app in every language: macOS falls back to the development region's. */
export const DISPLAY_NAME = `CFBundleDisplayName = "${PRODUCT}";\nCFBundleName = "${PRODUCT}";\n`;

/** The app's program in Contents/MacOS, and the launcher used when there is none. */
const PROGRAM = "Yew";
const LAUNCHER = "yew-launcher";

/** The app's Info.plist: the window app, or the launcher that opens the browser. */
export function infoPlist(window: boolean): string {
	const app = window
		? `	<key>CFBundleIdentifier</key>
	<string>cn.tenonai.apps.yew.desktop</string>
	<key>CFBundleExecutable</key>
	<string>${PROGRAM}</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.developer-tools</string>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
`
		: `	<key>CFBundleIdentifier</key>
	<string>cn.tenonai.apps.yew.launcher</string>
	<key>CFBundleExecutable</key>
	<string>${LAUNCHER}</string>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>Yew</string>
	<key>CFBundleDisplayName</key>
	<string>Yew</string>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>LSHasLocalizedDisplayName</key>
	<true/>
${app}	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${xml(VERSION)}</string>
	<key>CFBundleVersion</key>
	<string>${xml(VERSION)}</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
`;
}

/**
 * Opens Yew's interface; when Yew is not running, starts it in the background first and waits until
 * it answers. Its log goes where the login service's does. With `print`, the window app's script:
 * it prints the one-time link for the app's window instead of opening the browser, and the app says
 * itself when Yew did not start.
 */
export function launcherScript(
	host: AppHost,
	env: Record<string, string>,
	log: string,
	print = false,
): string {
	const yew = `${quoted(host.node)} ${quoted(host.entry)}`;
	const open = print ? `${yew} open --print 2>/dev/null` : `${yew} open >/dev/null 2>&1`;
	return `#!/bin/sh
# ${print ? "Prints a link that signs Yew Harness's window in" : "Yew's launcher"}, written by 'yew app install'. Run that again after moving Node.js or Yew.
${Object.entries(env)
	.map(([key, value]) => `export ${key}=${quoted(value)}`)
	.join("\n")}
if ${open}; then exit 0; fi
mkdir -p ${quoted(join(log, ".."))}
nohup ${yew} serve < /dev/null >> ${quoted(log)} 2>&1 &
tries=0
while [ "$tries" -lt 60 ]; do
	sleep 0.25
	if ${open}; then exit 0; fi
	tries=$((tries + 1))
done
${print ? "" : `osascript -e 'display alert "Yew Harness did not start" message "Run yew serve in a terminal to see why."' >/dev/null 2>&1\n`}exit 1
`;
}

const SIZES = [16, 32, 128, 256, 512] as const;

/** Where the app goes: the person's own Applications folder. */
export const appPath = (host: AppHost) => join(host.homeDir, "Applications", "Yew.app");

const inMacOS = (host: AppHost, name: string) => join(appPath(host), "Contents", "MacOS", name);

export const appInstalled = (host: AppHost) =>
	existsSync(inMacOS(host, PROGRAM)) || existsSync(inMacOS(host, LAUNCHER));

/**
 * Makes Yew.app: the window app when this installation has its program, else the launcher. Returns
 * whether the icon could be made and the app signed (it works without either).
 */
export function installApp(
	host: AppHost,
	home: string,
	env: Record<string, string | undefined>,
): { app: string; window: boolean; icon: boolean; signed: boolean } {
	const app = appPath(host);
	const window = host.program !== null;
	// Sessions' commands need your PATH; an app starts with a bare one.
	const vars: Record<string, string> = { PATH: env.PATH ?? "/usr/bin:/bin" };
	if (env.YEW_HOME) vars.YEW_HOME = home;
	const log = join(home, "logs", "serve.log");
	rmSync(app, { recursive: true, force: true });
	const contents = join(app, "Contents");
	mkdirSync(join(contents, "MacOS"), { recursive: true });
	mkdirSync(join(contents, "Resources"), { recursive: true });
	writeFileSync(join(contents, "Info.plist"), infoPlist(window));
	// Finder, Launchpad and the Dock show the product's name; the file keeps the short one.
	mkdirSync(join(contents, "Resources", "en.lproj"));
	writeFileSync(join(contents, "Resources", "en.lproj", "InfoPlist.strings"), DISPLAY_NAME);
	if (host.program) {
		const program = join(contents, "MacOS", PROGRAM);
		copyFileSync(host.program, program);
		chmodSync(program, 0o755);
		// The window asks this for its link, so Yew is started the same way as by the launcher.
		const link = join(contents, "Resources", "yew-link");
		writeFileSync(link, launcherScript(host, vars, log, true));
		chmodSync(link, 0o755);
	} else {
		const launcher = join(contents, "MacOS", LAUNCHER);
		writeFileSync(launcher, launcherScript(host, vars, log));
		chmodSync(launcher, 0o755);
	}

	// The icon: macOS's own tools make the sizes and the .icns. Without it the app still works.
	let icon = false;
	if (host.icon) {
		const work = mkdtempSync(join(tmpdir(), "yew-icon-"));
		const set = join(work, "AppIcon.iconset");
		mkdirSync(set);
		const made = SIZES.every((size) =>
			[1, 2].every(
				(factor) =>
					host.run("sips", [
						"-z",
						String(size * factor),
						String(size * factor),
						host.icon as string,
						"--out",
						join(set, `icon_${size}x${size}${factor === 2 ? "@2x" : ""}.png`),
					]) === 0,
			),
		);
		icon =
			made &&
			host.run("iconutil", [
				"-c",
				"icns",
				set,
				"-o",
				join(contents, "Resources", "AppIcon.icns"),
			]) === 0;
		rmSync(work, { recursive: true, force: true });
	}
	// Made by a process that marks what it writes as downloaded (an app before 1.8.2 passed that on to
	// Yew Harness and its commands), the app would be run from a moved copy and asked about by macOS:
	// it is Yew Harness's own, so the mark comes off.
	if (host.platform === "darwin") host.run("xattr", ["-r", "-d", "com.apple.quarantine", app]);
	// The window app is signed ad hoc, which needs no identity: macOS then takes the program, its
	// Info.plist and its script as one app. Last, so the seal covers the icon too.
	const signed = !window || host.run("codesign", ["--force", "--sign", "-", app]) === 0;
	// Tells Finder and the Dock about the new app and its icon.
	host.run("touch", [app]);
	return { app, window, icon, signed };
}

export function uninstallApp(host: AppHost): void {
	rmSync(appPath(host), { recursive: true, force: true });
}

export function appCommand(host: AppHost = realAppHost()): Command {
	return {
		name: "app",
		summary: "Put Yew Harness in Applications, in a window of its own (macOS)",
		async run(args: string[], io: CliIo): Promise<number> {
			const { values, positionals } = parseArgs({
				args,
				options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
				allowPositionals: true,
				strict: true,
			});
			if (values.help) {
				io.stdout.write(HELP);
				return EXIT_OK;
			}
			const action = positionals[0];
			if (positionals.length !== 1 || !["install", "uninstall", "status"].includes(action ?? "")) {
				throw new UsageError("yew app needs one of install, uninstall or status");
			}
			if (host.platform !== "darwin") throw new Error("yew app works on macOS.");
			const app = appPath(host);
			const installed = appInstalled(host);

			if (action === "status") {
				const window = existsSync(inMacOS(host, PROGRAM));
				if (values.json) io.stdout.write(`${JSON.stringify({ installed, app, window })}\n`);
				else
					io.stdout.write(
						`Yew Harness app: ${installed ? `${app}${window ? "" : " (opens the browser)"}` : "not installed"}\n`,
					);
				return EXIT_OK;
			}
			if (action === "uninstall") {
				uninstallApp(host);
				if (values.json) io.stdout.write(`${JSON.stringify({ installed: false, app })}\n`);
				else
					io.stdout.write(
						installed ? `Removed ${app}.\n` : "The Yew Harness app was not installed.\n",
					);
				return EXIT_OK;
			}

			const { yewHome } = await import("../server/paths.ts");
			const { window, icon, signed } = installApp(host, yewHome(io.env), io.env);
			if (values.json)
				io.stdout.write(`${JSON.stringify({ installed: true, app, window, icon })}\n`);
			else {
				io.stdout.write(
					window
						? `Yew Harness is in your Applications folder: ${app}\nOpen it from Launchpad or Spotlight; it opens in a window of its own, and you can keep it in the Dock.\n`
						: `Yew Harness is in your Applications folder: ${app}\nOpen it from Launchpad or Spotlight, or drag it to the Dock. This copy of Yew Harness has no app program (it is built on macOS), so the icon opens the web interface in your browser.\n`,
				);
			}
			if (!icon && host.icon)
				io.stderr.write("yew: the icon could not be made; the app has a plain one.\n");
			if (!signed)
				io.stderr.write(
					"yew: the app could not be signed with codesign; macOS may refuse to open it.\n",
				);
			return icon || !host.icon ? EXIT_OK : EXIT_ERROR;
		},
	};
}
