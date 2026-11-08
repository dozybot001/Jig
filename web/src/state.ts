import { useSyncExternalStore } from "react";
import type { AssistantMessage } from "../../src/shared/messages.ts";
import type {
	Approval,
	Entry,
	Group,
	PermissionRule,
	QueuedMessage,
	Session,
	ThinkingLevel,
	ToolCallView,
} from "../../src/shared/types.ts";

export interface Settings {
	defaultModel: { provider: string; model: string; thinking: ThinkingLevel };
	defaultRules: PermissionRule[];
	theme: "system" | "light" | "dark";
	language: "system" | "zh" | "en";
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
}

let state: AppState = {
	phase: "loading",
	failure: null,
	connection: "connecting",
	health: null,
	settings: null,
	groups: [],
	sessions: {},
	providers: [],
	models: {},
	selectedId: null,
	transcript: null,
	showArchived: false,
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
