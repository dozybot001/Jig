import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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
