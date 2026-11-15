import { execFile } from "node:child_process";
import { conflict, JigError } from "./errors.ts";

/** Runs a program with its arguments, without a shell; rejects when it cannot start or fails. */
export type RunCommand = (command: string, args: string[]) => Promise<void>;

export const runProgram: RunCommand = (command, args) =>
	new Promise((resolve, reject) => {
		execFile(command, args, { timeout: 15_000 }, (error) => (error ? reject(error) : resolve()));
	});

/** What the interface calls the file manager on this system, or null where Jig knows none. */
export type RevealKind = "finder" | "files" | null;

export function revealKind(platform: string = process.platform): RevealKind {
	return platform === "darwin" ? "finder" : platform === "linux" ? "files" : null;
}

/**
 * The program that shows a folder in the system's file manager, or null where Jig knows none.
 * `inside` opens the folder itself; otherwise Finder opens the folder that holds it, with it selected.
 */
export function revealCommand(
	dir: string,
	platform: string = process.platform,
	inside = false,
): { command: string; args: string[] } | null {
	if (platform === "darwin") return { command: "open", args: inside ? [dir] : ["-R", dir] };
	if (platform === "linux") return { command: "xdg-open", args: [dir] };
	return null;
}

/**
 * Shows a folder in the file manager. The caller decides which folder: it is never a path taken from
 * a request. `field` names the request field in the problem when this system has no file manager
 * Jig knows.
 */
export async function showInFileManager(
	dir: string,
	options: { platform?: string; run?: RunCommand; inside?: boolean; field: string },
): Promise<void> {
	const program = revealCommand(dir, options.platform, options.inside);
	if (!program) {
		throw conflict(
			"Showing a folder in the file manager works on macOS and Linux.",
			{ field: options.field },
			"not-on-this-system",
		);
	}
	try {
		await (options.run ?? runProgram)(program.command, program.args);
	} catch {
		throw new JigError("reveal-failed", 500, "The folder could not be shown.");
	}
}
