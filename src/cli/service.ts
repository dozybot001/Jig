import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type CliIo, EXIT_ERROR, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";
import { serviceRunning } from "./serve.ts";

const HELP = `Usage: jig service <install|uninstall|status> [options]

Start Jig when you log in, so your phone and scheduled tasks can reach it
without a terminal open. On macOS this is a LaunchAgent for your user, on
Linux a systemd user unit. Jig is restarted if it exits with an error, and
its log goes to the logs folder in Jig's data directory. Nothing is changed
on your system until you run install.

Commands:
  install    Start Jig at login, and start it now
  uninstall  Stop starting Jig at login, and stop it now
  status     Show whether it is installed and running

Options:
      --json  Print as JSON
  -h, --help  Show this help
`;

export const SERVICE_LABEL = "cn.tenonai.apps.jig";
const UNIT = "jig.service";

/** What the command touches on the system, so tests can stand in for launchd and systemd. */
export interface ServiceHost {
	platform: NodeJS.Platform;
	homeDir: string;
	uid: number;
	/** The Node.js that runs Jig, and Jig's entry file. */
	node: string;
	entry: string;
	/** Runs a system command; returns its exit code (null when it could not start). */
	run(command: string, args: string[]): number | null;
}

export function realServiceHost(): ServiceHost {
	return {
		platform: process.platform,
		homeDir: homedir(),
		uid: userInfo().uid,
		node: process.execPath,
		// The sources in a checkout, the compiled file in the published package.
		entry: fileURLToPath(
			new URL(import.meta.url.endsWith(".ts") ? "./main.ts" : "./main.js", import.meta.url),
		),
		run: (command, args) => spawnSync(command, args, { stdio: "ignore" }).status,
	};
}

const xml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The LaunchAgent: starts `jig serve` at login and again after an exit with an error. */
export function launchAgent(host: ServiceHost, env: Record<string, string>, log: string): string {
	const strings = (values: string[]) =>
		values.map((value) => `\t\t<string>${xml(value)}</string>`).join("\n");
	const vars = Object.entries(env)
		.map(([key, value]) => `\t\t<key>${xml(key)}</key>\n\t\t<string>${xml(value)}</string>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${SERVICE_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
${strings([host.node, host.entry, "serve"])}
	</array>
	<key>EnvironmentVariables</key>
	<dict>
${vars}
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ThrottleInterval</key>
	<integer>10</integer>
	<key>ProcessType</key>
	<string>Background</string>
	<key>StandardOutPath</key>
	<string>${xml(log)}</string>
	<key>StandardErrorPath</key>
	<string>${xml(log)}</string>
</dict>
</plist>
`;
}

const quoted = (value: string) => `"${value.replace(/(["\\$`])/g, "\\$1").replace(/%/g, "%%")}"`;

/** The systemd user unit, with the same behavior as the LaunchAgent. */
export function systemdUnit(host: ServiceHost, env: Record<string, string>, log: string): string {
	const vars = Object.entries(env)
		.map(([key, value]) => `Environment=${quoted(`${key}=${value}`)}`)
		.join("\n");
	return `[Unit]
Description=Jig, an AI-native multi-agent workbench

[Service]
ExecStart=${quoted(host.node)} ${quoted(host.entry)} serve
${vars}
Restart=on-failure
RestartSec=10
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`;
}

/** Starting at login is done with launchd on macOS and systemd on Linux. */
export const serviceSupported = (host: ServiceHost) =>
	host.platform === "darwin" || host.platform === "linux";

export function serviceFile(host: ServiceHost): string {
	if (host.platform === "darwin") {
		return join(host.homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
	}
	if (host.platform === "linux") return join(host.homeDir, ".config", "systemd", "user", UNIT);
	throw new Error("jig service works on macOS and Linux.");
}

const target = (host: ServiceHost) => `gui/${host.uid}/${SERVICE_LABEL}`;

/** The service file is there and the system has it loaded (macOS) or enabled (Linux). */
export function serviceLoaded(host: ServiceHost): boolean {
	return (
		existsSync(serviceFile(host)) &&
		(host.platform === "darwin"
			? host.run("launchctl", ["print", target(host)]) === 0
			: host.run("systemctl", ["--user", "is-enabled", "--quiet", UNIT]) === 0)
	);
}

/**
 * Whether Jig will be started at the next login. On macOS the file is enough: launchd loads what is
 * in LaunchAgents when the person logs in. On Linux the unit has to be enabled.
 */
export function serviceAtLogin(host: ServiceHost): boolean {
	if (!existsSync(serviceFile(host))) return false;
	return (
		host.platform === "darwin" ||
		host.run("systemctl", ["--user", "is-enabled", "--quiet", UNIT]) === 0
	);
}

export interface ServiceInstall {
	/** The exit code of launchctl or systemctl; 0 when the service was set up. */
	code: number | null;
	file: string;
	log: string;
}

/**
 * Writes the service file and registers it. With `start` (what `jig service install` does) the
 * service is also started now; without it Jig starts at the next login and what runs now is left
 * alone, which is what the settings need: they are served by the Jig that is running.
 */
export function installService(
	host: ServiceHost,
	home: string,
	env: Record<string, string | undefined>,
	options: { start: boolean },
): ServiceInstall {
	const file = serviceFile(host);
	const mac = host.platform === "darwin";
	const log = join(home, "logs", "serve.log");
	mkdirSync(join(home, "logs"), { recursive: true, mode: 0o700 });
	// Shell commands the sessions run need your PATH; launchd and systemd start with a bare one.
	const vars: Record<string, string> = { PATH: env.PATH ?? "/usr/bin:/bin" };
	if (env.JIG_HOME) vars.JIG_HOME = home;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, mac ? launchAgent(host, vars, log) : systemdUnit(host, vars, log), {
		mode: 0o644,
	});
	let code: number | null = 0;
	if (mac) {
		if (options.start) {
			// Loading it again picks up a new Node.js or Jig path after an update.
			host.run("launchctl", ["bootout", target(host)]);
			code = host.run("launchctl", ["bootstrap", `gui/${host.uid}`, file]);
		}
	} else {
		host.run("systemctl", ["--user", "daemon-reload"]);
		code = host.run("systemctl", ["--user", "enable", ...(options.start ? ["--now"] : []), UNIT]);
	}
	return { code, file, log };
}

/**
 * Removes the service file and its registration; returns whether the file was there. With `stop`
 * (what `jig service uninstall` does) the running service is stopped too; without it the Jig that
 * is running keeps running and is only not started at the next login.
 */
export function uninstallService(host: ServiceHost, options: { stop: boolean }): boolean {
	const file = serviceFile(host);
	const mac = host.platform === "darwin";
	const had = existsSync(file);
	if (mac) {
		if (options.stop) host.run("launchctl", ["bootout", target(host)]);
	} else if (had) {
		host.run("systemctl", ["--user", "disable", ...(options.stop ? ["--now"] : []), UNIT]);
	}
	rmSync(file, { force: true });
	if (!mac && had) host.run("systemctl", ["--user", "daemon-reload"]);
	return had;
}

export function serviceCommand(host: ServiceHost = realServiceHost()): Command {
	return {
		name: "service",
		summary: "Start Jig when you log in",
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
				throw new UsageError("jig service needs one of install, uninstall or status");
			}
			const { jigHome } = await import("../server/paths.ts");
			const home = jigHome(io.env);
			const file = serviceFile(host);
			const mac = host.platform === "darwin";

			if (action === "status") {
				const state = { installed: serviceLoaded(host), running: serviceRunning(home), file };
				if (values.json) io.stdout.write(`${JSON.stringify(state)}\n`);
				else {
					io.stdout.write(
						`Start at login: ${state.installed ? `on (${file})` : "off"}\nJig service: ${state.running ? "running" : "not running"}\n`,
					);
				}
				return EXIT_OK;
			}

			if (action === "uninstall") {
				const had = uninstallService(host, { stop: true });
				if (values.json) io.stdout.write(`${JSON.stringify({ installed: false, file })}\n`);
				else {
					io.stdout.write(
						had
							? "Jig no longer starts at login, and was stopped.\n"
							: "Jig was not set to start at login.\n",
					);
				}
				return EXIT_OK;
			}

			if (!serviceLoaded(host) && serviceRunning(home)) {
				io.stderr.write(
					"jig: Jig is already running, started by hand. Stop that 'jig serve' first, then run this again.\n",
				);
				return EXIT_ERROR;
			}
			const { code, log } = installService(host, home, io.env, { start: true });
			if (code !== 0) {
				io.stderr.write(
					`jig: ${mac ? "launchctl" : "systemctl"} could not start the service (exit ${code ?? "none"}). The file is at ${file}.\n`,
				);
				return EXIT_ERROR;
			}
			if (values.json) io.stdout.write(`${JSON.stringify({ installed: true, file, log })}\n`);
			else {
				io.stdout.write(
					`Jig now starts when you log in, and was started.\nLog: ${log}\nOpen the web interface with 'jig open'.\n`,
				);
			}
			return EXIT_OK;
		},
	};
}
