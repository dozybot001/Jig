import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { ThinkingLevel } from "../shared/types.ts";
import { invalid } from "./errors.ts";
import type { Store } from "./store.ts";

/** Jig's settings: what the settings menu and new sessions read, shared by the API and manage_jig. */
export interface DefaultModel {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
}

/** A saved working folder, offered first when you pick a folder for a session. */
export interface Workspace {
	id: string;
	name: string;
	path: string;
}

export const SETTING_DEFAULTS = {
	defaultModel: {
		provider: "deepseek",
		model: "deepseek-v4-pro",
		thinking: "medium",
	} as DefaultModel,
	theme: "system" as "system" | "light" | "dark",
	language: "system" as "system" | "zh" | "en",
	workspaces: [] as Workspace[],
	/** The main conversation (blueprint section 5). */
	mainSessionId: null as string | null,
	/** A Markdown file each decision is added to (blueprint 6.4, item 14). */
	decisionLog: null as string | null,
};

export type Settings = typeof SETTING_DEFAULTS;

export function readSettings(store: Store): Settings {
	return {
		defaultModel: store.getSetting("defaultModel", SETTING_DEFAULTS.defaultModel),
		theme: store.getSetting("theme", SETTING_DEFAULTS.theme),
		language: store.getSetting("language", SETTING_DEFAULTS.language),
		workspaces: store.getSetting("workspaces", SETTING_DEFAULTS.workspaces),
		mainSessionId: store.getSetting("mainSessionId", SETTING_DEFAULTS.mainSessionId),
		decisionLog: store.getSetting("decisionLog", SETTING_DEFAULTS.decisionLog),
	};
}

/** The decision log must be a Markdown file in an existing folder; `~` is expanded. */
export function resolveLogFile(path: string): string {
	const expanded = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	if (!isAbsolute(expanded))
		throw invalid("The decision log must be an absolute path.", "decisionLog");
	if (!/\.(md|markdown)$/i.test(expanded)) {
		throw invalid("The decision log must be a Markdown file (.md).", "decisionLog");
	}
	let folder: string;
	try {
		folder = realpathSync(dirname(expanded));
	} catch {
		throw invalid(`The folder ${dirname(path)} does not exist.`, "decisionLog");
	}
	const file = join(folder, basename(expanded));
	if (existsSync(file) && !statSync(file).isFile()) {
		throw invalid(`${path} is not a file.`, "decisionLog");
	}
	return file;
}
