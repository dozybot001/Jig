import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { dirname } from "node:path";
import type { FileOpener } from "../shared/types.ts";
import { conflict, YewError } from "./errors.ts";

/** Runs a program with its arguments, without a shell; rejects when it cannot start or fails. */
export type RunCommand = (command: string, args: string[]) => Promise<void>;

export const runProgram: RunCommand = (command, args) =>
	new Promise((resolve, reject) => {
		execFile(command, args, { timeout: 15_000 }, (error) => (error ? reject(error) : resolve()));
	});

/** What the interface calls the file manager on this system, or null where Yew knows none. */
export type RevealKind = "finder" | "files" | null;

export function revealKind(platform: string = process.platform): RevealKind {
	return platform === "darwin" ? "finder" : platform === "linux" ? "files" : null;
}

/**
 * The program that shows a folder in the system's file manager, or null where Yew knows none.
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
 * Yew knows.
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
		throw new YewError("reveal-failed", 500, "The folder could not be shown.");
	}
}

function encodeFileUrlPath(absPath: string): string {
	return absPath
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

/**
 * Builds the command that opens a local file or folder with the chosen program, jumping to
 * `line`/`column` when the editor supports it. Never invokes a shell.
 */
export function openFileCommand(
	targetPath: string,
	options: {
		opener: FileOpener;
		line?: number;
		column?: number;
		platform?: string;
		isDir?: boolean;
	},
): { command: string; args: string[] } | null {
	const platform = options.platform ?? process.platform;
	const { opener, line, column, isDir } = options;
	const lineSuffix =
		!isDir && line && line > 0 ? `:${line}${column && column > 0 ? `:${column}` : ""}` : "";
	if (platform === "darwin") {
		switch (opener) {
			case "system":
				return { command: "open", args: [targetPath] };
			case "finder":
				return { command: "open", args: ["-R", targetPath] };
			case "vscode":
				return lineSuffix
					? {
							command: "open",
							args: [`vscode://file${encodeFileUrlPath(targetPath)}${lineSuffix}`],
						}
					: { command: "open", args: ["-a", "Visual Studio Code", targetPath] };
			case "cursor":
				return lineSuffix
					? {
							command: "open",
							args: [`cursor://file${encodeFileUrlPath(targetPath)}${lineSuffix}`],
						}
					: { command: "open", args: ["-a", "Cursor", targetPath] };
			case "zed":
				return lineSuffix
					? { command: "open", args: [`zed://file${encodeFileUrlPath(targetPath)}${lineSuffix}`] }
					: { command: "open", args: ["-a", "Zed", targetPath] };
		}
	}
	if (platform === "linux") {
		switch (opener) {
			case "system":
				return { command: "xdg-open", args: [targetPath] };
			case "finder":
				return { command: "xdg-open", args: [isDir ? targetPath : dirname(targetPath)] };
			case "vscode":
				return lineSuffix
					? { command: "code", args: ["--goto", `${targetPath}${lineSuffix}`] }
					: { command: "code", args: [targetPath] };
			case "cursor":
				return lineSuffix
					? { command: "cursor", args: ["--goto", `${targetPath}${lineSuffix}`] }
					: { command: "cursor", args: [targetPath] };
			case "zed":
				return { command: "zed", args: [lineSuffix ? `${targetPath}${lineSuffix}` : targetPath] };
		}
	}
	return null;
}

/** Opens a verified local file or folder in the person's configured editor or file manager. */
export async function openLocalFile(
	targetPath: string,
	options: {
		opener: FileOpener;
		line?: number;
		column?: number;
		platform?: string;
		run?: RunCommand;
	},
): Promise<void> {
	let isDir = false;
	try {
		isDir = statSync(targetPath).isDirectory();
	} catch {
		// Caller already verified existence; treat as file if stat races.
	}
	const program = openFileCommand(targetPath, { ...options, isDir });
	if (!program) {
		throw conflict(
			"Opening local files works on macOS and Linux.",
			{ field: "path" },
			"not-on-this-system",
		);
	}
	try {
		await (options.run ?? runProgram)(program.command, program.args);
	} catch {
		throw new YewError(
			"open-file-failed",
			500,
			`Could not open ${targetPath} with ${options.opener}. Check that the app is installed.`,
		);
	}
}
