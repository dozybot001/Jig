import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
	DEFAULT_RELAY_URL,
	normalizePermissionMode,
	type PermissionMode,
	type ThinkingLevel,
} from "../shared/types.ts";
import { invalid } from "./errors.ts";
import { canonical } from "./permissions/paths.ts";
import type { Store } from "./store.ts";

/** Yew's settings: what the settings menu and new sessions read, shared by the API and manage_yew. */
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

/** Which kinds of events notify the phone (blueprint 6.10, item 34). All on unless turned off. */
export const NOTIFY_KINDS = ["waiting", "error", "task", "budget"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type NotifySettings = Record<NotifyKind, boolean>;

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
	/** Phones reach this Mac through the relay (blueprint 6.7, M3 plan section 6). */
	remote: { enabled: false, relayUrl: DEFAULT_RELAY_URL } as RemoteSettings,
	/** The most all sessions together may spend in a day, in US dollars (M3 plan, section 10). */
	dailyBudget: null as number | null,
	/** Folders of notes sessions may read, such as ~/memory (M4 plan, section 4). */
	memoryDirs: [] as string[],
	/** The permission mode new sessions start with (blueprint 6.10, item 32). */
	defaultPermissionMode: "default" as PermissionMode,
	/** The saved workspace the interface preselects for a new session; null for none. */
	defaultWorkspaceId: null as string | null,
	notify: { waiting: true, error: true, task: true, budget: true } as NotifySettings,
	/** Skills switched off in the settings, each by its folder's real path (blueprint 6.10, item 35). */
	disabledSkills: [] as string[],
	/** The mascot at the foot of the sidebar and the opening animation (blueprint, section 12). */
	mascot: true as boolean,
	/** Whether the opening leaves by itself once started, or waits for a click (blueprint 6.10, item 45). */
	opening: "auto" as OpeningMode,
	/**
	 * Whether commands in the system sandbox may use the SSH agent and the usual credential files;
	 * off by default (founder, 11-18, on the security group's advice; blueprint, section 11).
	 */
	sandboxCredentials: false as boolean,
	/**
	 * Folders sessions may not read, besides credentials and Yew Harness's own data: file tools refuse
	 * them, searches leave them out, and the system sandbox closes them (the security group, 11-18).
	 */
	hiddenFolders: [] as string[],
	/**
	 * Which browser the built-in browser server drives: the person's own Chrome through Playwright's
	 * extension, with their sign-ins (founder, 11-18), or a separate window of its own.
	 */
	browser: "own" as BrowserMode,
	/** Whether Yew Harness asks npm for a new version once a day (blueprint, "版本与更新"). */
	updateCheck: true as boolean,
};

export const BROWSER_MODES = ["own", "separate"] as const;
export type BrowserMode = (typeof BROWSER_MODES)[number];

export const OPENING_MODES = ["auto", "click"] as const;
export type OpeningMode = (typeof OPENING_MODES)[number];

export interface RemoteSettings {
	enabled: boolean;
	relayUrl: string;
}

export type Settings = typeof SETTING_DEFAULTS;

export function readSettings(store: Store): Settings {
	const workspaces = store.getSetting("workspaces", SETTING_DEFAULTS.workspaces);
	const defaultWorkspaceId = store.getSetting(
		"defaultWorkspaceId",
		SETTING_DEFAULTS.defaultWorkspaceId,
	);
	return {
		defaultModel: store.getSetting("defaultModel", SETTING_DEFAULTS.defaultModel),
		theme: store.getSetting("theme", SETTING_DEFAULTS.theme),
		language: store.getSetting("language", SETTING_DEFAULTS.language),
		workspaces,
		mainSessionId: store.getSetting("mainSessionId", SETTING_DEFAULTS.mainSessionId),
		decisionLog: store.getSetting("decisionLog", SETTING_DEFAULTS.decisionLog),
		remote: { ...SETTING_DEFAULTS.remote, ...store.getSetting("remote", SETTING_DEFAULTS.remote) },
		dailyBudget: store.getSetting("dailyBudget", SETTING_DEFAULTS.dailyBudget),
		memoryDirs: store.getSetting("memoryDirs", SETTING_DEFAULTS.memoryDirs),
		defaultPermissionMode:
			normalizePermissionMode(store.getSetting("defaultPermissionMode", null)) ??
			SETTING_DEFAULTS.defaultPermissionMode,
		// A workspace that was removed is no longer the default.
		defaultWorkspaceId: workspaces.some((workspace) => workspace.id === defaultWorkspaceId)
			? defaultWorkspaceId
			: null,
		notify: { ...SETTING_DEFAULTS.notify, ...store.getSetting("notify", SETTING_DEFAULTS.notify) },
		disabledSkills: store.getSetting("disabledSkills", SETTING_DEFAULTS.disabledSkills),
		mascot: store.getSetting("mascot", SETTING_DEFAULTS.mascot),
		opening: store.getSetting("opening", SETTING_DEFAULTS.opening),
		sandboxCredentials: store.getSetting("sandboxCredentials", SETTING_DEFAULTS.sandboxCredentials),
		hiddenFolders: store.getSetting("hiddenFolders", SETTING_DEFAULTS.hiddenFolders),
		browser: store.getSetting("browser", SETTING_DEFAULTS.browser),
		updateCheck: store.getSetting("updateCheck", SETTING_DEFAULTS.updateCheck),
	};
}

/**
 * A folder kept from sessions, as saved: absolute, `~` expanded, links resolved where it exists. It
 * may not exist yet. The root and the home folder are refused: they would hide everything.
 */
export function resolveHiddenFolder(path: string, userHome = homedir()): string {
	const trimmed = path.trim();
	const expanded =
		trimmed === "~" || trimmed.startsWith("~/") ? join(userHome, trimmed.slice(2)) : trimmed;
	if (!isAbsolute(expanded)) {
		throw invalid("A folder kept from sessions must be an absolute path.", "hiddenFolders");
	}
	const resolved = canonical(resolve(expanded));
	if (resolved === "/" || resolved === canonical(userHome)) {
		throw invalid(`${path} would hide everything; name a folder inside it.`, "hiddenFolders");
	}
	return resolved;
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
