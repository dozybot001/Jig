import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { VERSION } from "../shared/version.ts";
import { type CliIo, EXIT_ERROR, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";

const HELP = `Usage: jig app <install|uninstall|status> [options]

Put a Jig icon in your Applications folder (macOS). Clicking it starts Jig in
the background if it is not running, then opens the web interface, signed in.

The icon is a small launcher for this installation of Jig: it runs the same
jig you run in a terminal, with the Node.js found now. Run install again after
you move or update Node.js or Jig.

Commands:
  install    Create ~/Applications/Jig.app
  uninstall  Remove it; Jig itself and your data stay
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
	/** Runs a system command; returns its exit code (null when it could not start). */
	run(command: string, args: string[]): number | null;
}

export function realAppHost(): AppHost {
	const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
	const icon = ["../../web/dist/icons/app-icon.png", "../../web/public/icons/app-icon.png"]
		.map(here)
		.find((path) => existsSync(path));
	return {
		platform: process.platform,
		homeDir: homedir(),
		node: process.execPath,
		entry: here(import.meta.url.endsWith(".ts") ? "./main.ts" : "./main.js"),
		icon: icon ?? null,
		run: (command, args) => spawnSync(command, args, { stdio: "ignore" }).status,
	};
}

const xml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A value inside single quotes in a shell script. */
const quoted = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function infoPlist(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>Jig</string>
	<key>CFBundleDisplayName</key>
	<string>Jig</string>
	<key>CFBundleIdentifier</key>
	<string>cn.tenonai.apps.jig.launcher</string>
	<key>CFBundleExecutable</key>
	<string>jig-launcher</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${xml(VERSION)}</string>
	<key>CFBundleVersion</key>
	<string>${xml(VERSION)}</string>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
`;
}

/**
 * The launcher: open Jig's interface; when Jig is not running, start it in the background first
 * and wait until it answers. Its log goes where the login service's does.
 */
export function launcherScript(host: AppHost, env: Record<string, string>, log: string): string {
	const jig = `${quoted(host.node)} ${quoted(host.entry)}`;
	return `#!/bin/sh
# Jig's launcher, written by 'jig app install'. Run that again after moving Node.js or Jig.
${Object.entries(env)
	.map(([key, value]) => `export ${key}=${quoted(value)}`)
	.join("\n")}
if ${jig} open >/dev/null 2>&1; then exit 0; fi
mkdir -p ${quoted(join(log, ".."))}
nohup ${jig} serve >> ${quoted(log)} 2>&1 &
tries=0
while [ "$tries" -lt 60 ]; do
	sleep 0.25
	if ${jig} open >/dev/null 2>&1; then exit 0; fi
	tries=$((tries + 1))
done
osascript -e 'display alert "Jig did not start" message "Run jig serve in a terminal to see why."' >/dev/null 2>&1
exit 1
`;
}

const SIZES = [16, 32, 128, 256, 512] as const;

/** Where the launcher goes: the person's own Applications folder. */
export const appPath = (host: AppHost) => join(host.homeDir, "Applications", "Jig.app");

export const appInstalled = (host: AppHost) =>
	existsSync(join(appPath(host), "Contents", "MacOS", "jig-launcher"));

/** Makes Jig.app; returns whether its icon could be made (the app works without it). */
export function installApp(
	host: AppHost,
	home: string,
	env: Record<string, string | undefined>,
): { app: string; icon: boolean } {
	const app = appPath(host);
	// Sessions' commands need your PATH; an app starts with a bare one.
	const vars: Record<string, string> = { PATH: env.PATH ?? "/usr/bin:/bin" };
	if (env.JIG_HOME) vars.JIG_HOME = home;
	rmSync(app, { recursive: true, force: true });
	const contents = join(app, "Contents");
	mkdirSync(join(contents, "MacOS"), { recursive: true });
	mkdirSync(join(contents, "Resources"), { recursive: true });
	writeFileSync(join(contents, "Info.plist"), infoPlist());
	const launcher = join(contents, "MacOS", "jig-launcher");
	writeFileSync(launcher, launcherScript(host, vars, join(home, "logs", "serve.log")));
	chmodSync(launcher, 0o755);

	// The icon: macOS's own tools make the sizes and the .icns. Without it the app still works.
	let icon = false;
	if (host.icon) {
		const work = mkdtempSync(join(tmpdir(), "jig-icon-"));
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
	// Tells Finder and the Dock about the new app and its icon.
	host.run("touch", [app]);
	return { app, icon };
}

export function uninstallApp(host: AppHost): void {
	rmSync(appPath(host), { recursive: true, force: true });
}

export function appCommand(host: AppHost = realAppHost()): Command {
	return {
		name: "app",
		summary: "Put a Jig icon in Applications (macOS)",
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
				throw new UsageError("jig app needs one of install, uninstall or status");
			}
			if (host.platform !== "darwin") throw new Error("jig app works on macOS.");
			const app = appPath(host);
			const installed = appInstalled(host);

			if (action === "status") {
				if (values.json) io.stdout.write(`${JSON.stringify({ installed, app })}\n`);
				else io.stdout.write(`Jig icon: ${installed ? app : "not installed"}\n`);
				return EXIT_OK;
			}
			if (action === "uninstall") {
				uninstallApp(host);
				if (values.json) io.stdout.write(`${JSON.stringify({ installed: false, app })}\n`);
				else io.stdout.write(installed ? `Removed ${app}.\n` : "The Jig icon was not installed.\n");
				return EXIT_OK;
			}

			const { jigHome } = await import("../server/paths.ts");
			const { icon } = installApp(host, jigHome(io.env), io.env);
			if (values.json) io.stdout.write(`${JSON.stringify({ installed: true, app, icon })}\n`);
			else {
				io.stdout.write(
					`Jig is in your Applications folder: ${app}\nOpen it from Launchpad or Spotlight, or drag it to the Dock.\n`,
				);
				if (!icon) io.stderr.write("jig: the icon could not be made; the app has a plain one.\n");
			}
			return icon || !host.icon ? EXIT_OK : EXIT_ERROR;
		},
	};
}
