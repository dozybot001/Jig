import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

interface Seen {
	mtimeMs: number;
	size: number;
	hash: string;
}

/**
 * What a session has read, so write and edit can refuse to overwrite a file the session has not seen
 * or that changed since (Gemini CLI's check, prior-art 4.2): compare modification time and size first,
 * and the content hash only when those differ.
 */
export class ReadState {
	readonly #seen = new Map<string, Seen>();

	record(path: string, content: Buffer | string): void {
		const stat = statSync(path);
		this.#seen.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, hash: hash(content) });
	}

	/** null when the file is safe to change; otherwise why not. */
	check(path: string): string | null {
		const seen = this.#seen.get(path);
		if (!seen) return "Read the file before changing it.";
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			return "The file no longer exists. Read the folder again before changing it.";
		}
		if (stat.mtimeMs === seen.mtimeMs && stat.size === seen.size) return null;
		if (hash(readFileSync(path)) === seen.hash) {
			this.#seen.set(path, { ...seen, mtimeMs: stat.mtimeMs, size: stat.size });
			return null;
		}
		return "The file changed after you read it. Read it again before changing it.";
	}

	forget(path: string): void {
		this.#seen.delete(path);
	}
}

function hash(content: Buffer | string): string {
	return createHash("sha256").update(content).digest("hex");
}
