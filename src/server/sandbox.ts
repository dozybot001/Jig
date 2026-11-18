import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The system sandbox for sessions' commands and the MCP servers people add (blueprint, section 11:
 * the next version's main item; security group, 11-18). Everything is allowed except what would let a
 * command act as the person or change Yew Harness itself:
 * - reading or changing Yew Harness's data folder (its database, sign-in tokens, logs);
 * - changing the program, the launcher in Applications, or what starts at login;
 * - connecting to Yew Harness's own port on this computer;
 * - on macOS, the keychain, where the API keys and MCP sign-ins are.
 * macOS uses Seatbelt (sandbox-exec); Linux uses bubblewrap when it is installed, which hides the data
 * folder and keeps the program read-only but cannot close the port. Elsewhere commands run as before.
 */
export interface SandboxPlaces {
	/** Yew Harness's data folder. */
	home: string;
	/** Where the running Yew Harness is installed: the folder with its package.json. */
	install: string;
	/** The person's home folder. */
	userHome: string;
	/** The port `yew serve` listens on. */
	port: number;
}

export type SandboxKind = "seatbelt" | "bubblewrap" | "none";

/** The folder with this Yew Harness's package.json: the repository, or the installed package. */
export const INSTALL_DIR = fileURLToPath(new URL("../..", import.meta.url));

export interface Sandbox {
	readonly kind: SandboxKind;
	/**
	 * The command line that runs `command` with `args` inside the sandbox. `readable` names folders in
	 * the data folder it may still read, such as the code of an MCP server Yew Harness installed there.
	 */
	wrap(command: string, args: string[], readable?: string[]): { command: string; args: string[] };
}

/** The services macOS hands out keychain items through. */
const KEYCHAIN_SERVICES = [
	"com.apple.SecurityServer",
	"com.apple.securityd.xpc",
	"com.apple.security.keychaind",
	"com.apple.security.agent",
];

const real = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

/** A string literal for a Seatbelt profile. */
const literal = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The Seatbelt profile (SBPL): everything allowed, then the few things denied, last rule wins. */
export function seatbeltProfile(places: SandboxPlaces, readable: string[] = []): string {
	const home = real(places.home);
	const user = real(places.userHome);
	return [
		"(version 1)",
		"(allow default)",
		";; Yew Harness's data: the database with the person's decisions, sign-in tokens, logs.",
		`(deny file-read* file-write* (subpath ${literal(home)}))`,
		...readable.map((folder) => `(allow file-read* (subpath ${literal(join(home, folder))}))`),
		";; The program and what starts it: changed, they would run the next time Yew Harness starts.",
		`(deny file-write* (subpath ${literal(real(places.install))}))`,
		`(deny file-write* (subpath ${literal(join(user, "Library", "LaunchAgents"))}))`,
		`(deny file-write* (subpath ${literal(join(user, "Applications", "Yew.app"))}))`,
		";; Yew Harness's own port: the local API answers the person only.",
		`(deny network-outbound (remote ip ${literal(`localhost:${places.port}`)}))`,
		";; The keychain: the API keys and MCP sign-ins.",
		`(deny mach-lookup ${KEYCHAIN_SERVICES.map((name) => `(global-name ${literal(name)})`).join(" ")})`,
		"",
	].join("\n");
}

/** bubblewrap's arguments: the whole system as it is, the data folder empty, the program read-only. */
export function bubblewrapArguments(places: SandboxPlaces, readable: string[] = []): string[] {
	const home = real(places.home);
	const install = real(places.install);
	const user = real(places.userHome);
	const units = join(user, ".config", "systemd", "user");
	return [
		"--dev-bind",
		"/",
		"/",
		"--tmpfs",
		home,
		...readable.flatMap((folder) => ["--ro-bind", join(home, folder), join(home, folder)]),
		"--ro-bind",
		install,
		install,
		...(existsSync(units) ? ["--ro-bind", units, units] : []),
		"--die-with-parent",
		"--",
	];
}

function has(command: string): boolean {
	return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

/** The sandbox this computer offers; `none` when it has none. */
export function systemSandbox(
	places: SandboxPlaces,
	platform: NodeJS.Platform = process.platform,
	available: (command: string) => boolean = has,
): Sandbox {
	if (platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
		const profile = seatbeltProfile(places);
		return {
			kind: "seatbelt",
			wrap: (command, args, readable = []) => ({
				command: "/usr/bin/sandbox-exec",
				args: [
					"-p",
					readable.length > 0 ? seatbeltProfile(places, readable) : profile,
					command,
					...args,
				],
			}),
		};
	}
	if (platform === "linux" && available("bwrap")) {
		return {
			kind: "bubblewrap",
			wrap: (command, args, readable = []) => ({
				command: "bwrap",
				args: [...bubblewrapArguments(places, readable), command, ...args],
			}),
		};
	}
	return NO_SANDBOX;
}

export const NO_SANDBOX: Sandbox = { kind: "none", wrap: (command, args) => ({ command, args }) };

let current: Sandbox = NO_SANDBOX;

/** Set once when `yew serve` starts; until then, and in tests, commands run without a sandbox. */
export function setSandbox(sandbox: Sandbox): void {
	current = sandbox;
}

export function activeSandbox(): Sandbox {
	return current;
}
