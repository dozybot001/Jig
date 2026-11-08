import type { AssistantMessage } from "../../src/shared/messages.ts";
import type {
	Approval,
	ApprovalDecision,
	Entry,
	Group,
	PermissionRule,
	QueuedMessage,
	Session,
	SessionEvent,
	SessionKind,
	ThinkingLevel,
	ToolCallView,
	Transcript,
} from "../../src/shared/types.ts";
import { ApiError, all, api } from "./api.ts";
import { setLang, systemLang } from "./i18n.ts";
import {
	getState,
	type ModelInfo,
	type ProviderSummary,
	type Settings,
	setState,
	updateTranscript,
	upsertEntry,
} from "./state.ts";

const LAST_SESSION = "jig.lastSession";

function remember(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Storage can be unavailable; it only holds conveniences.
	}
}

function recall(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

// --- appearance ---

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function applyAppearance(settings: Settings | null): void {
	const theme = settings?.theme ?? "system";
	const dark = theme === "dark" || (theme === "system" && darkQuery.matches);
	document.documentElement.dataset.theme = dark ? "dark" : "light";
	const language = settings?.language ?? "system";
	setLang(language === "system" ? systemLang() : language);
}

darkQuery.addEventListener("change", () => applyAppearance(getState().settings));

// --- sign-in and start ---

/** Trades the one-time token from the URL fragment for a cookie, then removes it from the address bar. */
async function exchangeToken(): Promise<void> {
	const match = /[#&]t=([\w-]+)/.exec(window.location.hash);
	if (!match?.[1]) return;
	history.replaceState(null, "", window.location.pathname + window.location.search);
	try {
		await api("POST", "/api/auth/exchange", { token: match[1] });
	} catch (error) {
		// A used or expired link still leaves an existing cookie usable.
		if (!(error instanceof ApiError) || error.status !== 401) throw error;
	}
}

export async function boot(): Promise<void> {
	applyAppearance(null);
	try {
		await exchangeToken();
		const health = await api<{ version: string; build?: string }>("GET", "/api/health");
		const settings = await api<Settings>("GET", "/api/settings");
		applyAppearance(settings);
		const [groups, sessions, providers, archived] = await Promise.all([
			all<Group>("/api/groups"),
			all<Session>("/api/sessions"),
			all<ProviderSummary>("/api/providers"),
			api<{ items: Session[] }>("GET", "/api/sessions?archived=true&limit=1"),
		]);
		setState({
			phase: "ready",
			health: { version: health.version, build: health.build ?? null },
			settings,
			groups,
			sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
			providers,
			hasArchived: archived.items.length > 0,
		});
		const last = recall(LAST_SESSION);
		if (last && getState().sessions[last]) await selectSession(last);
		else connect(null, null);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) setState({ phase: "signin" });
		else setState({ phase: "failed", failure: (error as Error).message });
	}
}

// --- event stream ---

let source: EventSource | null = null;
let connectedOnce = false;

function connect(sessionId: string | null, after: number | null): void {
	source?.close();
	const params = new URLSearchParams();
	if (sessionId) params.set("session", sessionId);
	if (after !== null) params.set("after", String(after));
	const stream = new EventSource(`/api/events?${params}`);
	source = stream;
	connectedOnce = false;
	stream.addEventListener("open", () => setState({ connection: "open" }));
	stream.addEventListener("error", () => {
		if (source !== stream) return;
		setState({ connection: "connecting" });
		if (stream.readyState === EventSource.CLOSED) void recover();
	});
	stream.addEventListener("hello", () => {
		// Sidebar events are not replayed, so a reconnect reloads the list.
		if (connectedOnce) void reloadSessions();
		connectedOnce = true;
	});
	stream.addEventListener("reset", () => {
		if (source !== stream) return;
		void reloadSessions();
		if (sessionId) void loadTranscript(sessionId);
	});
	stream.addEventListener("global", (message) => {
		const event = JSON.parse((message as MessageEvent<string>).data) as
			| { type: "sessionSummary"; session: Session }
			| { type: "groups"; groups: Group[] };
		if (event.type === "groups") setState({ groups: event.groups });
		else
			setState((current) => ({
				sessions: { ...current.sessions, [event.session.id]: event.session },
			}));
	});
	if (!sessionId) return;
	stream.addEventListener("session", (message) => {
		applySessionEvent(
			sessionId,
			JSON.parse((message as MessageEvent<string>).data) as SessionEvent,
		);
	});
	stream.addEventListener("live", (message) => {
		const event = JSON.parse((message as MessageEvent<string>).data) as
			| { type: "draft"; draft: AssistantMessage }
			| { type: "draftCleared" }
			| { type: "toolOutput"; toolCallId: string; output: string };
		updateTranscript(sessionId, (t) => {
			if (event.type === "draft") return { draft: event.draft };
			if (event.type === "draftCleared") return { draft: null };
			return { outputs: { ...t.outputs, [event.toolCallId]: event.output } };
		});
	});
}

/** The stream closed for good: the server restarted or the cookie expired. */
async function recover(): Promise<void> {
	try {
		await api("GET", "/api/settings");
		const selected = getState().selectedId;
		if (selected) await selectSession(selected);
		else connect(null, null);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) setState({ phase: "signin" });
		else setTimeout(() => void recover(), 3000);
	}
}

function applySessionEvent(sessionId: string, event: SessionEvent): void {
	if (event.type === "session") {
		setState((current) => ({
			sessions: { ...current.sessions, [event.session.id]: event.session },
		}));
		return;
	}
	updateTranscript(sessionId, (t) => {
		switch (event.type) {
			case "entry":
				return {
					entries: upsertEntry(t.entries, event.entry),
					...(event.entry.role === "assistant" ? { draft: null } : {}),
				};
			case "toolCall":
				return { toolCalls: { ...t.toolCalls, [event.toolCall.id]: event.toolCall } };
			case "approval":
				return { approvals: { ...t.approvals, [event.approval.id]: event.approval } };
			case "queue":
				return { queue: event.queue };
		}
	});
}

async function reloadSessions(): Promise<void> {
	const sessions = await all<Session>("/api/sessions");
	setState((current) => {
		const archived = Object.values(current.sessions).filter((s) => s.archivedAt !== null);
		return { sessions: Object.fromEntries([...archived, ...sessions].map((s) => [s.id, s])) };
	});
}

function indexBy<T extends { id: string }>(items: T[]): Record<string, T> {
	return Object.fromEntries(items.map((item) => [item.id, item]));
}

async function loadTranscript(sessionId: string): Promise<number> {
	const data = await api<Transcript>("GET", `/api/sessions/${sessionId}/transcript?limit=150`);
	// A late answer for a session you have already left must not replace the open one.
	setState((current) => ({
		sessions: { ...current.sessions, [sessionId]: data.session },
		...(current.selectedId === sessionId
			? {
					transcript: {
						sessionId,
						entries: data.entries,
						toolCalls: indexBy(data.toolCalls),
						approvals: indexBy(data.approvals),
						queue: data.queue,
						olderCursor: data.olderCursor,
						draft: null,
						outputs: {},
					},
				}
			: {}),
	}));
	return data.session.eventSeq;
}

/** Shows the settings page in the main area (spec 10.5). */
export function openSettings(tab: "general" | "providers" | "rules" | "about" = "general"): void {
	setState({ view: "settings", settingsTab: tab });
}

export async function selectSession(sessionId: string | null): Promise<void> {
	setState({ selectedId: sessionId, transcript: null, view: "session" });
	remember(LAST_SESSION, sessionId);
	if (!sessionId) {
		connect(null, null);
		return;
	}
	const seq = await loadTranscript(sessionId);
	if (getState().selectedId !== sessionId) return;
	connect(sessionId, seq);
	const session = getState().sessions[sessionId];
	if (session && session.unread > 0)
		void api("PATCH", `/api/sessions/${sessionId}`, { read: true });
}

export async function loadEarlier(): Promise<void> {
	const transcript = getState().transcript;
	if (!transcript?.olderCursor) return;
	const data = await api<Transcript>(
		"GET",
		`/api/sessions/${transcript.sessionId}/transcript?limit=150&before=${transcript.olderCursor}`,
	);
	updateTranscript(transcript.sessionId, (t) => ({
		entries: [
			...data.entries,
			...t.entries.filter((e) => !data.entries.some((d) => d.id === e.id)),
		],
		toolCalls: { ...indexBy(data.toolCalls), ...t.toolCalls },
		approvals: { ...indexBy(data.approvals), ...t.approvals },
		olderCursor: data.olderCursor,
	}));
}

/** Marks the open session read when new output arrives while it is on screen. */
export function markRead(sessionId: string): void {
	const session = getState().sessions[sessionId];
	if (session && session.unread > 0 && document.visibilityState === "visible") {
		void api("PATCH", `/api/sessions/${sessionId}`, { read: true });
	}
}

// --- sessions and groups ---

export interface NewSessionInput {
	name: string;
	kind: SessionKind;
	groupId: string | null;
	cwd: string | null;
	responsibility: string;
	provider: string;
	model: string;
	thinking: ThinkingLevel;
}

export async function createSession(input: NewSessionInput): Promise<Session> {
	const session = await api<Session>("POST", "/api/sessions", input, { idempotent: true });
	setState((current) => ({ sessions: { ...current.sessions, [session.id]: session } }));
	await selectSession(session.id);
	return session;
}

export type SessionPatch = Partial<{
	name: string;
	groupId: string | null;
	responsibility: string;
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	rules: PermissionRule[];
	options: { compactAt?: number | null; directEdits?: boolean };
	pinned: boolean;
	archived: boolean;
}>;

export async function updateSession(sessionId: string, patch: SessionPatch): Promise<Session> {
	const session = await api<Session>("PATCH", `/api/sessions/${sessionId}`, patch);
	setState((current) => ({ sessions: { ...current.sessions, [session.id]: session } }));
	if (patch.archived !== undefined) {
		const archived = await api<{ items: Session[] }>("GET", "/api/sessions?archived=true&limit=1");
		setState({ hasArchived: archived.items.length > 0 });
	}
	return session;
}

/** A name not used by any loaded session: "聊天", then "聊天 2", "聊天 3"… */
export function freeName(base: string): string {
	const taken = new Set(Object.values(getState().sessions).map((s) => s.name.toLowerCase()));
	if (!taken.has(base.toLowerCase())) return base;
	for (let n = 2; ; n++) {
		const name = `${base} ${n}`;
		if (!taken.has(name.toLowerCase())) return name;
	}
}

/** Starts a chat (a session without a working folder) with the default model, in one click. */
/**
 * Starts a session from the home composer: creates it, sends the first message, then opens it, so a
 * failure leaves you on the home page with your text still there.
 */
export async function startSession(input: NewSessionInput, text: string): Promise<Session> {
	const session = await api<Session>("POST", "/api/sessions", input, { idempotent: true });
	setState((current) => ({ sessions: { ...current.sessions, [session.id]: session } }));
	await sendMessage(session.id, text);
	await selectSession(session.id);
	return session;
}

export async function toggleArchived(show: boolean): Promise<void> {
	setState({ showArchived: show });
	if (!show) return;
	const archived = await all<Session>("/api/sessions?archived=true");
	setState((current) => ({ sessions: { ...current.sessions, ...indexBy(archived) } }));
}

export async function createGroup(name: string): Promise<Group> {
	return api<Group>("POST", "/api/groups", { name }, { idempotent: true });
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
	await api("PATCH", `/api/groups/${groupId}`, { name });
}

export async function deleteGroup(groupId: string): Promise<void> {
	await api("DELETE", `/api/groups/${groupId}`);
}

// --- talking to a session ---

export async function sendMessage(sessionId: string, text: string): Promise<void> {
	const result = await api<{ entry?: Entry; queued?: QueuedMessage }>(
		"POST",
		`/api/sessions/${sessionId}/messages`,
		{ text },
		{ idempotent: true },
	);
	if (result.entry) {
		const entry = result.entry;
		updateTranscript(sessionId, (t) => ({ entries: upsertEntry(t.entries, entry) }));
	}
}

export const stopSession = (sessionId: string) => api("POST", `/api/sessions/${sessionId}/stop`);
export const continueSession = (sessionId: string) =>
	api("POST", `/api/sessions/${sessionId}/continue`);
export const compactSession = (sessionId: string) =>
	api("POST", `/api/sessions/${sessionId}/compact`);

export async function editQueued(sessionId: string, id: string, text: string): Promise<void> {
	await api("PATCH", `/api/sessions/${sessionId}/queue/${id}`, { text });
}

export async function withdrawQueued(sessionId: string, id: string): Promise<void> {
	await api("DELETE", `/api/sessions/${sessionId}/queue/${id}`);
}

export async function answerApproval(
	approvalId: string,
	answer: { decision?: ApprovalDecision; reason?: string; answer?: string },
): Promise<Approval> {
	return api<Approval>("POST", `/api/approvals/${approvalId}`, answer);
}

// --- providers, models, settings ---

export async function loadModels(provider: string): Promise<ModelInfo[]> {
	const cached = getState().models[provider];
	if (cached) return cached;
	const models = await all<ModelInfo>(`/api/providers/${encodeURIComponent(provider)}/models`);
	setState((current) => ({ models: { ...current.models, [provider]: models } }));
	return models;
}

export async function reloadProviders(): Promise<void> {
	const providers = await all<ProviderSummary>("/api/providers");
	setState({ providers, models: {} });
}

export async function saveKey(provider: string, key: string): Promise<void> {
	await api("PUT", `/api/providers/${encodeURIComponent(provider)}/key`, { key });
	await reloadProviders();
}

export async function deleteKey(provider: string): Promise<void> {
	await api("DELETE", `/api/providers/${encodeURIComponent(provider)}/key`);
	await reloadProviders();
}

export async function saveCustomProvider(id: string, body: unknown): Promise<void> {
	await api("PUT", `/api/providers/${encodeURIComponent(id)}`, body);
	await reloadProviders();
}

export async function deleteCustomProvider(id: string): Promise<void> {
	await api("DELETE", `/api/providers/${encodeURIComponent(id)}`);
	await reloadProviders();
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
	const settings = await api<Settings>("PATCH", "/api/settings", patch);
	setState({ settings });
	applyAppearance(settings);
}

export function toolCallFor(
	calls: Record<string, ToolCallView>,
	messageId: string,
	callId: string,
): ToolCallView | undefined {
	return Object.values(calls).find(
		(call) => call.messageId === messageId && call.callId === callId,
	);
}
