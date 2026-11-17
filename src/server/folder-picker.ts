import { execFile } from "node:child_process";
import { JigError } from "./errors.ts";

/** Runs osascript with the given arguments and returns its standard output. */
export type RunScript = (args: string[]) => Promise<string>;

const runOsascript: RunScript = (args) =>
	new Promise((resolve, reject) => {
		// Waits for as long as the person keeps the picker open, within reason.
		execFile("osascript", args, { timeout: 10 * 60_000 }, (error, stdout, stderr) => {
			if (error) reject(Object.assign(error, { stderr }));
			else resolve(stdout);
		});
	});

/**
 * Opens the system folder picker on the computer that runs Yew and returns the chosen folder, or null
 * when the person cancels. The script is fixed text with nothing from the request in it. Only macOS has
 * a picker Yew can open this way; elsewhere the interface asks for a typed path.
 */
export async function pickFolder(
	platform: string = process.platform,
	run: RunScript = runOsascript,
): Promise<string | null> {
	if (platform !== "darwin") {
		throw new JigError(
			"not-supported",
			501,
			"Yew cannot open a folder picker on this computer. Type the folder's path instead.",
		);
	}
	try {
		const out = (await run(["-e", "activate", "-e", "POSIX path of (choose folder)"])).trim();
		return out.length > 1 ? out.replace(/\/+$/, "") : out;
	} catch (error) {
		const text = `${(error as Error).message} ${(error as { stderr?: string }).stderr ?? ""}`;
		// osascript reports a cancelled dialog as error -128.
		if (text.includes("-128")) return null;
		throw new JigError("picker-failed", 500, "The folder picker could not be opened.");
	}
}
