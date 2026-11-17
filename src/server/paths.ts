import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { invalid } from "./errors.ts";

/**
 * Yew's data directory: `YEW_HOME` when set (or `JIG_HOME`, its name before Jig was renamed Yew on
 * 2026-11-18), otherwise `~/.yew`. While Jig's folder `~/.jig` has not been moved there yet
 * (`moveJigHome`), it is that folder.
 */
export function jigHome(
	env: Record<string, string | undefined> = process.env,
	user: string = homedir(),
): string {
	const custom = env.YEW_HOME || env.JIG_HOME;
	if (custom) return resolve(custom);
	const home = join(user, ".yew");
	const old = join(user, ".jig");
	return !existsSync(home) && isFolder(old) ? old : home;
}

/** A real folder, not a link to one. */
function isFolder(path: string): boolean {
	try {
		return lstatSync(path).isDirectory();
	} catch {
		return false;
	}
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
 * Jig was renamed Yew on 2026-11-18 (blueprint, section 12). The first time Yew runs, Jig's data
 * folder `~/.jig` moves to `~/.yew` and a link to it is left at `~/.jig`, so paths written down
 * before (in conversations, scripts, the person's notes) still work; the database file becomes
 * `yew.db`. In a folder set by `YEW_HOME` or `JIG_HOME` only the database file is renamed. Nothing
 * moves while a server runs from the folder: then the result names it, and Yew goes on using the
 * folder where it is.
 */
export function moveJigHome(
	env: Record<string, string | undefined> = process.env,
	user: string = homedir(),
): HomeMove {
	const custom = env.YEW_HOME || env.JIG_HOME;
	const home = custom ? resolve(custom) : join(user, ".yew");
	const old = join(user, ".jig");
	if (!custom && !existsSync(home) && isFolder(old)) {
		const busy = runningIn(old);
		if (busy !== null) return { busy, folder: old };
		renameSync(old, home);
		symlinkSync(home, old);
		renameDatabase(home);
		return { moved: old, to: home };
	}
	if (existsSync(join(home, "jig.db")) && !existsSync(join(home, "yew.db"))) {
		const busy = runningIn(home);
		if (busy !== null) return { busy, folder: home };
		renameDatabase(home);
		return { renamed: home };
	}
	return null;
}

/** Creates the data directory readable only by the current user. */
export function ensureDir(path: string): string {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	return path;
}

/** The database file: `yew.db`, or Jig's `jig.db` in a folder whose server kept it from moving. */
export function dbPath(home: string): string {
	const yew = join(home, "yew.db");
	const jig = join(home, "jig.db");
	return !existsSync(yew) && existsSync(jig) ? jig : yew;
}

/** Resolves `~`, requires an existing folder and stores its real path, so permission checks compare like with like. */
export function resolveWorkingFolder(path: string): string {
	const expanded =
		path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	if (!isAbsolute(expanded)) throw invalid("The working folder must be an absolute path.", "cwd");
	let real: string;
	try {
		real = realpathSync(expanded);
	} catch {
		throw invalid(`The folder ${path} does not exist.`, "cwd");
	}
	if (!statSync(real).isDirectory()) throw invalid(`${path} is not a folder.`, "cwd");
	return real;
}
