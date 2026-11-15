import { execFile } from "node:child_process";
import { Hono } from "hono";
import { conflict, invalid, JigError, notFound } from "../errors.ts";
import { readSettings } from "../settings.ts";
import { listSkills, type SkillEntry, type SkillListing } from "../skills.ts";
import type { Store } from "../store.ts";
import { optBoolean, readJson, reqString } from "./input.ts";
import type { AppEnv } from "./problem.ts";

/** Runs a program with its arguments, without a shell; rejects when it cannot start or fails. */
export type RunCommand = (command: string, args: string[]) => Promise<void>;

const runProgram: RunCommand = (command, args) =>
	new Promise((resolve, reject) => {
		execFile(command, args, { timeout: 15_000 }, (error) => (error ? reject(error) : resolve()));
	});

export interface SkillRoutesOptions {
	/** Jig's data folder; its `skills` folder is one of the global ones. */
	home: string;
	/** The person's home folder, for `~/.claude/skills`; null reads nothing outside Jig's folder. */
	userHome: string | null;
	/** Replace the system and the program runner; tests use them so no window opens. */
	platform?: string;
	run?: RunCommand;
}

/** The program that shows a folder in the system's file manager, or null where Jig knows none. */
export function revealCommand(
	dir: string,
	platform: string = process.platform,
): { command: string; args: string[] } | null {
	// Finder opens the folder that holds the skill, with the skill's folder selected.
	if (platform === "darwin") return { command: "open", args: ["-R", dir] };
	if (platform === "linux") return { command: "xdg-open", args: [dir] };
	return null;
}

/**
 * Skills in the settings (blueprint 6.10, item 35): list what was read and what could not be, switch
 * one off or on, show one's folder in the file manager. Computer-only: these are this computer's
 * folders. Nothing here changes a skill's files.
 */
export function skillRoutes(store: Store, options: SkillRoutesOptions): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	const platform = options.platform ?? process.platform;
	const run = options.run ?? runProgram;

	const listing = (): SkillListing => {
		const settings = readSettings(store);
		return listSkills(settings.workspaces, options.home, options.userHome, settings.disabledSkills);
	};
	// Only a folder in the list is ever acted on: the request names one, it never supplies a path.
	const listed = (id: string): SkillEntry => {
		const entry = listing().items.find((item) => item.id === id);
		if (!entry) throw notFound("skill", id);
		return entry;
	};

	app.get("/skills", (c) =>
		c.json({
			...listing(),
			reveal: platform === "darwin" ? "finder" : platform === "linux" ? "files" : null,
			nextCursor: null,
		}),
	);

	app.patch("/skills", async (c) => {
		const fields = await readJson(c);
		const id = reqString(fields, "id", 4096);
		const disabled = optBoolean(fields, "disabled");
		if (disabled === undefined) throw invalid("disabled is required.", "disabled");
		const entry = listed(id);
		// A folder that could not be read has nothing to switch.
		if (entry.problem) throw notFound("skill", id);
		const others = readSettings(store).disabledSkills.filter((item) => item !== id);
		store.setSetting("disabledSkills", disabled ? [...others, id] : others);
		return c.json({ ...entry, disabled });
	});

	app.post("/skills/reveal", async (c) => {
		const fields = await readJson(c);
		const entry = listed(reqString(fields, "id", 4096));
		const program = revealCommand(entry.dir, platform);
		if (!program) {
			throw conflict(
				"Showing a folder in the file manager works on macOS and Linux.",
				{ field: "id" },
				"not-on-this-system",
			);
		}
		try {
			await run(program.command, program.args);
		} catch {
			throw new JigError("reveal-failed", 500, "The folder could not be shown.");
		}
		return c.body(null, 204);
	});

	return app;
}
