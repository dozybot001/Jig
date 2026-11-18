import { useSyncExternalStore } from "react";
import type { AssistantMessage } from "../../src/shared/messages.ts";
import type {
	Approval,
	Artifact,
	Card,
	Device,
	Entry,
	Group,
	Letter,
	PermissionMode,
	QueuedMessage,
	Schedule,
	Session,
	ThinkingLevel,
	ToolCallView,
} from "../../src/shared/types.ts";

export interface Settings {
	defaultModel: { provider: string; model: string; thinking: ThinkingLevel };
	theme: "system" | "light" | "dark";
	language: "system" | "zh" | "en";
	workspaces: Workspace[];
	mainSessionId: string | null;
	decisionLog: string | null;
	/** Phones reach this Mac through the relay (M3 plan, section 6). */
	remote: { enabled: boolean; relayUrl: string };
	/** The most all sessions together may spend in a day, in US dollars. */
	dailyBudget: number | null;
	/** Folders of notes sessions may read, such as ~/memory. */
	memoryDirs: string[];
	/** The permission mode new sessions start with. */
	defaultPermissionMode: PermissionMode;
	/** The saved workspace preselected for a new session; null for none. */
	defaultWorkspaceId: string | null;
	/** Which kinds of events notify the phone. */
	notify: Record<NotifyKind, boolean>;
	/** The mascot at the foot of the sidebar and the opening (blueprint, section 12). */
	mascot: boolean;
	/** The opening leaves by itself once started, or waits for a click (blueprint 6.10, item 45). */
	opening: "auto" | "click";
}

/** This browser remembers "off" here, so the opening knows before the settings arrive. */
export const MASCOT_KEY = "yew.mascot";

export const NOTIFY_KINDS = ["waiting", "error", "task", "budget"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** What PATCH /api/settings takes: `notify` may name some kinds, the relay may be null for the default. */
export type SettingsPatch = Partial<Omit<Settings, "notify" | "remote">> & {
	notify?: Partial<Record<NotifyKind, boolean>>;
	remote?: { enabled?: boolean; relayUrl?: string | null };
};

/** An MCP server from mcp.json with its connection; values of variables and headers never arrive. */
export interface McpServerView {
	name: string;
	kind: "stdio" | "http";
	/** Set up by Yew itself: it can be turned off, not removed. */
	builtin: boolean;
	disabled: boolean;
	command: string | null;
	args: string[];
	envNames: string[];
	url: string | null;
	headerNames: string[];
	state: "connecting" | "ready" | "error" | "disabled" | "sign-in";
	error: string | null;
	tools: string[];
	/** Yew holds a sign-in for it (blueprint 6.11, item 40). */
	signedIn: boolean;
	/** The site the browser goes to to sign in, once Yew has found it. */
	signInAt?: string;
	/** Its entry names a client of the person's to sign in with. */
	oauthClient: boolean;
	/** One of the presets Yew installs: the npm package and version it runs. */
	package?: string;
}

/** Where a skill comes from: the global folders, or a saved workspace's. */
export type SkillSource = { kind: "global" } | { kind: "workspace"; name: string; path: string };

/** A skill folder Yew found; `problem` says why one could not be read, and such a row has no switch. */
export interface SkillView {
	/** The folder's real path. */
	id: string;
	name: string;
	description: string;
	dir: string;
	source: SkillSource;
	disabled: boolean;
	problem: "no-file" | "unreadable" | "bad-name" | null;
}

export interface SkillList {
	items: SkillView[];
	/** The folders read, in the order the list is grouped. */
	folders: { source: SkillSource; paths: string[] }[];
	/** Which file manager can show a folder on this computer; null when Yew knows none. */
	reveal: "finder" | "files" | null;
}

/** A web search service and whether its key is in the keychain. */
export interface SearchServiceView {
	id: string;
	name: string;
	region: "cn" | "global";
	hasKey: boolean;
	/** The one web search uses now. */
	active: boolean;
}

/** Starting at login and the launcher icon on this computer. */
export interface SystemStatus {
	startAtLogin: { supported: boolean; on: boolean; file: string | null };
	launcher: { supported: boolean; on: boolean; path: string | null };
}

/** Paired phones and the relay connection, for the phone access dialog. */
export interface PhonesState {
	devices: Device[];
	remote: {
		enabled: boolean;
		connected: boolean;
		relayUrl: string;
		desktopId: string | null;
	} | null;
}

/** Everything waiting for the person, across sessions (M2 plan, section 5). */
export interface CenterState {
	approvals: Record<string, Approval>;
	cards: Record<string, Card>;
	held: Record<string, Letter>;
}

/** A list read a page at a time, newest first: all letters, or the decisions made. */
export interface PagedList<T> {
	items: T[];
	nextCursor: string | null;
	loaded: boolean;
}

export type CenterTab = "pending" | "decided" | "letters";

/** A saved working folder. */
export interface Workspace {
	id: string;
	name: string;
	path: string;
}

export interface ProviderSummary {
	id: string;
	name: string;
	region: "cn" | "global" | "custom";
	baseUrl: string;
	keyRequired: boolean;
	custom: boolean;
	hasKey: boolean;
	modelCount: number;
}

/** What one short request to a provider came to. */
export interface PingResult {
	ok: boolean;
	model: string;
	firstMs: number | null;
	totalMs: number;
	error?: string;
}

export interface ModelInfo {
	provider: string;
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	thinkingLevels: ThinkingLevel[];
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface TranscriptState {
	sessionId: string;
	entries: Entry[];
	toolCalls: Record<string, ToolCallView>;
	approvals: Record<string, Approval>;
	queue: QueuedMessage[];
	olderCursor: number | null;
	draft: AssistantMessage | null;
	/** A model request that failed and is being tried again; gone when the answer starts. */
	retry: { attempt: number; of: number; seconds: number; text: string } | null;
	outputs: Record<string, string>;
}

/** What Yew's data folder takes, by kind; `reveal` names the file manager, null where there is none. */
export type DataPartId = "database" | "artifacts" | "logs" | "temp" | "other";
export interface DataOverview {
	folder: string;
	totalBytes: number;
	parts: { id: DataPartId; bytes: number }[];
	/** Over-long command output: all of it, and what a cleanup would delete now. */
	temp: { files: number; bytes: number; removableFiles: number; removableBytes: number };
	reveal: "finder" | "files" | null;
	readAt: number;
}

/** What an export wrote, as `yew export --json` prints it. */
export interface DataExport {
	folder: string;
	sessions: number;
	letters: number;
	cards: number;
	schedules: number;
	artifacts: number;
	files: number;
}

export interface DataCleanup {
	deletedFiles: number;
	freedBytes: number;
	skippedFiles: number;
}

/** The settings window's sections (blueprint 6.10, item 45). */
export type SettingsDialogName =
	| "personal"
	| "providers"
	| "mcp"
	| "skills"
	| "data"
	| "defaults"
	| "phones"
	| "system"
	| "about";

export interface AppState {
	phase: "loading" | "signin" | "ready" | "failed";
	/** Set once the start has also read the approval center; the opening's last step. */
	booted: boolean;
	failure: string | null;
	connection: "open" | "connecting";
	health: { version: string; build: string | null } | null;
	settings: Settings | null;
	groups: Group[];
	sessions: Record<string, Session>;
	providers: ProviderSummary[];
	models: Record<string, ModelInfo[]>;
	selectedId: string | null;
	transcript: TranscriptState | null;
	showArchived: boolean;
	/** True once any session is archived; the sidebar only offers "show archived" then. */
	hasArchived: boolean;
	/** The main area shows a session, or the settings page. */
	/** A settings dialog opened from the settings menu, over the conversation. */
	settingsDialog: SettingsDialogName | null;
	phones: PhonesState | null;
	/** A folder the home page should preselect, set when you open a workspace from the sidebar. */
	homeFolder: string | null;
	/** Wide screens: the sidebar folded to a narrow rail (remembered in this browser). */
	sidebarCollapsed: boolean;
	/** Narrow screens: the sidebar drawer is open. */
	drawerOpen: boolean;
	center: CenterState;
	letters: PagedList<Letter>;
	decisions: PagedList<Card>;
	/**
	 * The approval center is a page of its own: you go there to clear what waits across sessions, and
	 * into a session to work on one thing (founder, 2026-11-09). Null shows the session or home.
	 */
	page: "center" | "schedules" | "artifacts" | "usage" | "map" | null;
	centerTab: CenterTab;
	/** Scheduled tasks, read when their page first opens; null until then. */
	schedules: Schedule[] | null;
	/** Artifacts, read when their page first opens; null until then. The open one's id. */
	artifacts: Artifact[] | null;
	artifactId: string | null;
	/** The sessions list shows one team's sessions; null shows all (blueprint section 8). */
	teamFilter: string | null;
	/**
	 * Goes up with every letter that is sent or changes state, and when the event stream reconnects:
	 * the sessions map reads its letter lines again when it does.
	 */
	letterTick: number;
	/** Text to put in a session's message box when it opens: a message taken back or forked from. */
	prefill: Record<string, string>;
}

/** How many things wait for the person: approvals, questions, cards and held letters. */
export function centerCount(center: CenterState): number {
	return (
		Object.keys(center.approvals).length +
		Object.keys(center.cards).length +
		Object.keys(center.held).length
	);
}

const SIDEBAR_KEY = "yew.sidebar";

function rememberedCollapse(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
	} catch {
		return false;
	}
}

/** Folds or unfolds the sidebar on wide screens, and remembers it in this browser only. */
export function setSidebarCollapsed(collapsed: boolean): void {
	setState({ sidebarCollapsed: collapsed });
	try {
		if (collapsed) localStorage.setItem(SIDEBAR_KEY, "collapsed");
		else localStorage.removeItem(SIDEBAR_KEY);
	} catch {
		// Storage can be unavailable (private windows); the choice then lasts for this page only.
	}
}

let state: AppState = {
	phase: "loading",
	booted: false,
	failure: null,
	// Only a stream that was open and then dropped shows the reconnecting banner.
	connection: "open",
	health: null,
	settings: null,
	groups: [],
	sessions: {},
	providers: [],
	models: {},
	selectedId: null,
	transcript: null,
	showArchived: false,
	hasArchived: false,
	settingsDialog: null,
	phones: null,
	homeFolder: null,
	sidebarCollapsed: rememberedCollapse(),
	drawerOpen: false,
	center: { approvals: {}, cards: {}, held: {} },
	letters: { items: [], nextCursor: null, loaded: false },
	decisions: { items: [], nextCursor: null, loaded: false },
	page: null,
	centerTab: "pending",
	schedules: null,
	artifacts: null,
	artifactId: null,
	teamFilter: null,
	prefill: {},
	letterTick: 0,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
	return state;
}

export function setState(
	update: Partial<AppState> | ((current: AppState) => Partial<AppState>),
): void {
	const patch = typeof update === "function" ? update(state) : update;
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
}

/** Updates the open transcript, if it is the given session's. */
export function updateTranscript(
	sessionId: string,
	fn: (current: TranscriptState) => Partial<TranscriptState>,
): void {
	setState((current) => {
		const transcript = current.transcript;
		if (!transcript || transcript.sessionId !== sessionId) return {};
		return { transcript: { ...transcript, ...fn(transcript) } };
	});
}

/** Selectors must return values taken from the state (not new objects), so React can compare them. */
export function useAppState<T>(selector: (current: AppState) => T): T {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => selector(state),
	);
}

export function upsertEntry(entries: Entry[], entry: Entry): Entry[] {
	const index = entries.findIndex((existing) => existing.id === entry.id);
	if (index >= 0) {
		const next = entries.slice();
		next[index] = entry;
		return next;
	}
	const last = entries.at(-1);
	if (!last || last.seq < entry.seq) return [...entries, entry];
	return [...entries, entry].sort((a, b) => a.seq - b.seq);
}
