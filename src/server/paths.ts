import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { invalid } from "./errors.ts";
import { fromJigEnv, JIG_DATABASE, unmovedJigHome } from "./from-jig.ts";

/**
 * Yew's data directory: `YEW_HOME` when set, otherwise `~/.yew`. A folder from Jig, Yew's earlier
 * name, counts until it has moved (from-jig.ts).
 */
export function yewHome(
	env: Record<string, string | undefined> = process.env,
	user: string = homedir(),
): string {
	const custom = fromJigEnv(env, "HOME");
	if (custom) return resolve(custom);
	const home = join(user, ".yew");
	return unmovedJigHome(home, user) ?? home;
}

/** Creates the data directory readable only by the current user. */
export function ensureDir(path: string): string {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	return path;
}

/** The database file, `yew.db`; Jig's `jig.db` until it is renamed (from-jig.ts). */
export function dbPath(home: string): string {
	const yew = join(home, "yew.db");
	const jig = join(home, JIG_DATABASE);
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
