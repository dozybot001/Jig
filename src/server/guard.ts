import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The outer guard (the security group, 11-18; blueprint, section 11). A session's command that does
 * not run in the system sandbox (one the person let run outside it, or every command where the
 * sandbox is off) still runs in a layer that keeps it out of the places where decisions are kept
 * and answered: Yew Harness's data folder, and the Mac app's web storage, which holds its sign-in.
 * Nothing else is closed: the command may write anywhere, go online and use credentials. Without
 * it, a command could reach those places in a way Yew cannot see in its text (a path a script puts
 * together) and answer a decision in the person's place, even in skip mode.
 *
 * macOS: sandbox-exec with a profile that allows everything but those places. Linux: bubblewrap
 * with the whole system as it is and an empty folder laid over each place. This is not the system
 * sandbox (sandbox.ts) and does not use its library: the library cannot leave everything else open.
 */
export type GuardKind = "macos" | "linux" | "none";

interface Guard {
	kind: GuardKind;
	program: string | null;
	places: string[];
}

let guard: Guard = { kind: "none", program: null, places: [] };

/** A path as the system sees it: links resolved, through its nearest folder that exists. */
export function resolved(path: string): string {
	if (existsSync(path)) return realpathSync(path);
	const parent = dirname(path);
	return parent === path ? path : join(resolved(parent), basename(path));
}

/** A string in a Seatbelt profile. */
const quoted = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The macOS profile: everything allowed, but reading or writing the places. */
export function guardProfile(places: string[]): string {
	return [
		"(version 1)",
		"(allow default)",
		`(deny file-read* file-write* ${places.map((place) => `(subpath ${quoted(place)})`).join(" ")})`,
	].join("\n");
}

/** How to run `shell -lc command` in the guard; null when there is no guard. */
export function guardedArgs(
	shell: string,
	command: string,
	state: Guard = guard,
): { file: string; args: string[] } | null {
	if (state.kind === "none" || !state.program || state.places.length === 0) return null;
	if (state.kind === "macos") {
		return {
			file: state.program,
			args: ["-p", guardProfile(state.places), shell, "-lc", command],
		};
	}
	// An empty folder over each place that is a folder; bubblewrap cannot lay one over a file.
	const covers = state.places.flatMap((place) =>
		existsSync(place) && statSync(place).isDirectory() ? ["--tmpfs", place] : [],
	);
	return {
		file: state.program,
		args: ["--dev-bind", "/", "/", ...covers, "--", shell, "-lc", command],
	};
}

/**
 * Starts the guard for these places. It first runs a command in it that must not see an entry of the
 * data folder; a system where that does not work gets no guard, and the reason.
 */
export function startGuard(
	places: string[],
	find: (name: string) => string | null,
	platform: NodeJS.Platform = process.platform,
): { kind: GuardKind; problem: string | null } {
	const program =
		platform === "darwin" ? "/usr/bin/sandbox-exec" : platform === "linux" ? find("bwrap") : null;
	if (!program || !existsSync(program)) {
		guard = { kind: "none", program: null, places: [] };
		return { kind: "none", problem: platform === "linux" ? "bubblewrap is missing" : null };
	}
	const kind: GuardKind = platform === "darwin" ? "macos" : "linux";
	const state: Guard = { kind, program, places: [...new Set(places.map(resolved))] };
	// It must run a command, and that command must not see what is in a place (the data folder).
	const folder = state.places.find(
		(place) => existsSync(place) && statSync(place).isDirectory() && readdirSync(place).length > 0,
	);
	const entry = folder ? join(folder, readdirSync(folder)[0] as string) : null;
	const probe = guardedArgs(
		"/bin/sh",
		entry ? `test ! -e '${entry.replace(/'/g, "'\\''")}'` : "true",
		state,
	);
	const ran = probe
		? spawnSync(probe.file, probe.args, { stdio: "ignore", timeout: 10_000 })
		: null;
	if (!ran || ran.status !== 0) {
		guard = { kind: "none", program: null, places: [] };
		const why = ran?.error?.message ?? `exit ${ran?.status}`;
		return { kind: "none", problem: `the guard did not keep a command out of Yew's data (${why})` };
	}
	guard = state;
	return { kind, problem: null };
}

export function guardKind(): GuardKind {
	return guard.kind;
}

/** For tests: no guard. */
export function stopGuard(): void {
	guard = { kind: "none", program: null, places: [] };
}
