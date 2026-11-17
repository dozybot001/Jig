/**
 * What is left of Jig, Yew's name until 2026-11-18 (blueprint, section 12): only what carries a
 * person's data and settings over from Jig, so upgrading loses nothing. Everything else uses Yew's
 * names. Remove this file, and the few places that use it, once nobody upgrades from Jig any more.
 */
import { existsSync, lstatSync, readFileSync, renameSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Jig's data folder, in the home folder. */
const JIG_FOLDER = ".jig";
/** Jig's database file. */
export const JIG_DATABASE = "jig.db";
/** Jig's database files, for counting what a data folder holds before they are renamed. */
export const JIG_DATABASE_FILES = ["jig.db", "jig.db-wal", "jig.db-shm"];
/** Where Jig kept keys and tokens in the system keychain. */
export const JIG_KEYCHAIN_SERVICE = "asia.tenon.jig";
/** Jig's login service: the LaunchAgent's label on macOS, the systemd unit on Linux. */
export const JIG_SERVICE_LABEL = "cn.tenonai.apps.jig";
export const JIG_SERVICE_UNIT = "jig.service";
/** Jig's launcher app, and the program inside that shows it is the one Jig made. */
export const JIG_APP = "Jig.app";
export const JIG_LAUNCHER = "jig-launcher";
/** A project folder Jig read skills from. */
export const JIG_PROJECT_FOLDER = ".jig";
/** How Jig marked its own notes in a conversation. */
const JIG_NOTE = "[From Jig, not from the person]";

/** Whether a stored message is a note Jig wrote, not something the person wrote. */
export const isJigNote = (text: string): boolean => text.startsWith(JIG_NOTE);

/** An environment variable by Yew's name, or by Jig's: `YEW_HOME`, else `JIG_HOME`. */
export function fromJigEnv(
	env: Record<string, string | undefined>,
	name: "HOME" | "KEYCHAIN" | "MCP_BUILTIN" | "SESSION",
): string | undefined {
	return env[`YEW_${name}`] || env[`JIG_${name}`] || undefined;
}

/** A real folder, not a link to one. */
function isFolder(path: string): boolean {
	try {
		return lstatSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Jig's data folder while it has not been moved to Yew's: there, real, and Yew's not made yet. */
export function unmovedJigHome(home: string, user: string = homedir()): string | null {
	const old = join(user, JIG_FOLDER);
	return !existsSync(home) && isFolder(old) ? old : null;
}

/** The process a server running from this folder has, by its serve file; null when none runs. */
function runningIn(home: string): number | null {
	try {
		const { pid } = JSON.parse(readFileSync(join(home, "serve.json"), "utf8")) as { pid?: unknown };
		if (typeof pid !== "number") return null;
		process.kill(pid, 0);
		return pid;
	} catch {
		return null;
	}
}

/** Jig's database file becomes Yew's, with its write-ahead log and shared memory. */
function renameDatabase(home: string): void {
	if (existsSync(join(home, "yew.db"))) return;
	for (const suffix of ["", "-wal", "-shm"]) {
		const from = join(home, `jig.db${suffix}`);
		if (existsSync(from)) renameSync(from, join(home, `yew.db${suffix}`));
	}
}

export type HomeMove =
	| { moved: string; to: string }
	| { renamed: string }
	| { busy: number; folder: string }
	| null;

/**
 * The first time Yew runs, Jig's data folder `~/.jig` moves to `~/.yew` and a link to it is left at
 * `~/.jig`, so paths written down before (in conversations, scripts, the person's notes) still work;
 * the database file becomes `yew.db`. In a folder set by `YEW_HOME` or `JIG_HOME` only the database
 * file is renamed. Nothing moves while a server runs from the folder: then the result names it, and
 * Yew goes on using the folder where it is.
 */
export function moveJigHome(
	env: Record<string, string | undefined> = process.env,
	user: string = homedir(),
): HomeMove {
	const custom = fromJigEnv(env, "HOME");
	const home = custom ? resolve(custom) : join(user, ".yew");
	const old = unmovedJigHome(home, user);
	if (!custom && old) {
		const busy = runningIn(old);
		if (busy !== null) return { busy, folder: old };
		renameSync(old, home);
		symlinkSync(home, old);
		renameDatabase(home);
		return { moved: old, to: home };
	}
	if (existsSync(join(home, JIG_DATABASE)) && !existsSync(join(home, "yew.db"))) {
		const busy = runningIn(home);
		if (busy !== null) return { busy, folder: home };
		renameDatabase(home);
		return { renamed: home };
	}
	return null;
}
