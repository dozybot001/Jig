import { mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { invalid } from "./errors.ts";

/** Jig's data directory: `JIG_HOME` when set, otherwise `~/.jig`. */
export function jigHome(env: Record<string, string | undefined> = process.env): string {
	const custom = env.JIG_HOME;
	return custom ? resolve(custom) : join(homedir(), ".jig");
}

/** Creates the data directory readable only by the current user. */
export function ensureDir(path: string): string {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	return path;
}

export function dbPath(home: string): string {
	return join(home, "jig.db");
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
