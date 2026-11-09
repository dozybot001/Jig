import { useSyncExternalStore } from "react";
import type { AssistantMessage } from "../../src/shared/messages.ts";
import type {
	Approval,
	Card,
	Device,
	Entry,
	Group,
	Letter,
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
	outputs: Record<string, string>;
}

export interface AppState {
	phase: "loading" | "signin" | "ready" | "failed";
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
	settingsDialog: "providers" | "defaults" | "about" | "phones" | null;
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
	page: "center" | "schedules" | null;
	centerTab: CenterTab;
	/** Scheduled tasks, read when their page first opens; null until then. */
	schedules: Schedule[] | null;
	/** The sessions list shows one team's sessions; null shows all (blueprint section 8). */
	teamFilter: string | null;
}

/** How many things wait for the person: approvals, questions, cards and held letters. */
export function centerCount(center: CenterState): number {
	return (
		Object.keys(center.approvals).length +
		Object.keys(center.cards).length +
		Object.keys(center.held).length
	);
}

const SIDEBAR_KEY = "jig.sidebar";

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
	teamFilter: null,
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
