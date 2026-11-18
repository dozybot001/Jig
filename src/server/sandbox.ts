import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The system sandbox for sessions' commands and the MCP servers people add (blueprint, section 11:
 * the next version's main item; security group, 11-18). A command can read what the person can and
 * use the network, but:
 * - it writes only in the session's working folder, the temporary folders and the usual caches, so it
 *   cannot plant anything in ~/.zshrc, ~/.gitconfig or the like that would run outside later; in any
 *   repository, `.git/hooks` and `.git/config` stay as they are;
 * - it can neither read nor change Yew Harness's data folder (the database with the person's
 *   decisions, sign-in tokens, logs);
 * - it cannot change the program, the launcher in Applications, or what starts at login;
 * - it cannot connect to Yew Harness's own port on this computer;
 * - on macOS it cannot get items from the keychain, where the API keys and MCP sign-ins are; on Linux
 *   the session bus, where the Secret Service is, is not there.
 * macOS uses Seatbelt (sandbox-exec); Linux uses bubblewrap when it is installed, which cannot close
 * the port. Elsewhere commands run as the person, and the interface says so.
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

/** What one command may do besides the usual: folders it may write, folders in the data folder it may read. */
export interface SandboxGrant {
	/** Folders the command may change, such as the session's working folder. */
	writable?: string[];
	/** Folders in the data folder it may read, such as the code of an MCP server installed there. */
	readable?: string[];
}

/** The folder with this Yew Harness's package.json: the repository, or the installed package. */
export const INSTALL_DIR = fileURLToPath(new URL("../..", import.meta.url));

export interface Sandbox {
	readonly kind: SandboxKind;
	/** The command line that runs `command` with `args` inside the sandbox. */
	wrap(command: string, args: string[], grant?: SandboxGrant): { command: string; args: string[] };
}

/** The services macOS hands out keychain items through; certificate checks (trustd) stay open. */
const KEYCHAIN_SERVICES = [
	"com.apple.SecurityServer",
	"com.apple.securityd.xpc",
	"com.apple.security.keychaind",
	"com.apple.security.agent",
];

/** Caches in the home folder that package managers and build tools write to. */
const CACHES = [
	".npm",
	".cache",
	".yarn",
	".pnpm-store",
	".bun",
	".deno",
	".node-gyp",
	".cargo/registry",
	".cargo/git",
	".gradle",
	".m2",
	"go/pkg/mod",
	"Library/Caches",
	"Library/pnpm",
	".local/share/pnpm",
];

const real = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

/** The temporary folders: the system's, and this user's (with its cache next to it on macOS). */
function temporary(): string[] {
	const own = real(tmpdir());
	const folders = new Set(["/tmp", "/var/tmp", real("/tmp"), real("/var/tmp"), own]);
	// On macOS the user's temporary folder is …/T inside a per-user folder that also holds …/C.
	if (own.startsWith("/private/var/folders/")) folders.add(dirname(own));
	return [...folders];
}

/** A string literal for a Seatbelt profile. */
const literal = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The Seatbelt profile (SBPL). Rules are read in order, and a later one wins over an earlier one. */
export function seatbeltProfile(places: SandboxPlaces, grant: SandboxGrant = {}): string {
	const home = real(places.home);
	const user = real(places.userHome);
	const writable = [
		...temporary(),
		...CACHES.map((cache) => join(user, cache)),
		...(grant.writable ?? []).map(real),
	];
	return [
		"(version 1)",
		"(allow default)",
		";; Writes go only where a command's work belongs: its folder, temporary folders, caches.",
		"(deny file-write*)",
		"(allow file-write*",
		'\t(literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper")',
		'\t(regex #"^/dev/fd/") (regex #"^/dev/ttys")',
		...writable.map((folder) => `\t(subpath ${literal(folder)})`),
		")",
		";; A repository's hooks and settings would run commands outside the sandbox later.",
		'(deny file-write* (regex #"/\\.git/hooks(/|$)") (regex #"/\\.git/config$"))',
		";; Yew Harness's data: the database with the person's decisions, sign-in tokens, logs.",
		`(deny file-read* file-write* (subpath ${literal(home)}))`,
		...(grant.readable ?? []).map(
			(folder) => `(allow file-read* (subpath ${literal(join(home, folder))}))`,
		),
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

/**
 * bubblewrap's arguments. The system is read-only; the working folder, temporary folders and caches
 * are bound writable over it; the data folder and the session bus are replaced by empty folders; a
 * repository's hooks and settings, and the program, are bound read-only on top. Later mounts win.
 */
export function bubblewrapArguments(places: SandboxPlaces, grant: SandboxGrant = {}): string[] {
	const home = real(places.home);
	const user = real(places.userHome);
	const uid = process.getuid?.() ?? 0;
	const writable = (grant.writable ?? []).map(real);
	return [
		"--ro-bind",
		"/",
		"/",
		"--dev",
		"/dev",
		"--proc",
		"/proc",
		"--bind",
		"/tmp",
		"/tmp",
		"--bind-try",
		"/var/tmp",
		"/var/tmp",
		...CACHES.flatMap((cache) => ["--bind-try", join(user, cache), join(user, cache)]),
		...writable.flatMap((folder) => ["--bind", folder, folder]),
		...writable.flatMap((folder) => [
			"--ro-bind-try",
			join(folder, ".git", "hooks"),
			join(folder, ".git", "hooks"),
			"--ro-bind-try",
			join(folder, ".git", "config"),
			join(folder, ".git", "config"),
		]),
		"--tmpfs",
		home,
		...(grant.readable ?? []).flatMap((folder) => [
			"--ro-bind",
			join(home, folder),
			join(home, folder),
		]),
		"--ro-bind",
		real(places.install),
		real(places.install),
		// The session bus carries the Secret Service, where keys are kept.
		"--tmpfs",
		`/run/user/${uid}`,
		"--unsetenv",
		"DBUS_SESSION_BUS_ADDRESS",
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
		return {
			kind: "seatbelt",
			wrap: (command, args, grant = {}) => ({
				command: "/usr/bin/sandbox-exec",
				args: ["-p", seatbeltProfile(places, grant), command, ...args],
			}),
		};
	}
	if (platform === "linux" && available("bwrap")) {
		return {
			kind: "bubblewrap",
			wrap: (command, args, grant = {}) => ({
				command: "bwrap",
				args: [...bubblewrapArguments(places, grant), command, ...args],
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

/**
 * Settings for a command approved to run outside the sandbox: git runs no hooks and no file system
 * monitor there, so one a session planted inside cannot come along with an innocent-looking push.
 */
export const OUTSIDE_GIT = {
	GIT_CONFIG_COUNT: "2",
	GIT_CONFIG_KEY_0: "core.hooksPath",
	GIT_CONFIG_VALUE_0: "/dev/null",
	GIT_CONFIG_KEY_1: "core.fsmonitor",
	GIT_CONFIG_VALUE_1: "false",
};
