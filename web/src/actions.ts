import type { AssistantMessage } from "../../src/shared/messages.ts";
import type {
	Approval,
	ApprovalDecision,
	Card,
	Device,
	Entry,
	Group,
	Letter,
	Page,
	PermissionMode,
	PermissionRule,
	QuestionAnswer,
	QueuedMessage,
	ReceivePolicy,
	Session,
	SessionEvent,
	SessionKind,
	ThinkingLevel,
	ToolCallView,
	Transcript,
} from "../../src/shared/types.ts";
import { ApiError, all, api, downloadFile } from "./api.ts";
import { getLang, setLang, systemLang } from "./i18n.ts";
import {
	type CenterState,
	type CenterTab,
	getState,
	type ModelInfo,
	type PhonesState,
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

const VIEW = "jig.view";
const CENTER_TABS: readonly string[] = ["pending", "decided", "letters"];

/**
 * Where this tab is (a session, the approval center, the start page), so reloading the page returns
 * there. It lives as long as the tab: a new tab still opens on the main conversation.
 */
function rememberView(view: string): void {
	try {
		sessionStorage.setItem(VIEW, view);
	} catch {
		// Storage can be unavailable; the page then opens as on a fresh start.
	}
}

function recallView(): string | null {
	try {
		return sessionStorage.getItem(VIEW);
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
		await loadCenter();
		// A reload stays where the tab was. Otherwise Jig opens on the main conversation; without one,
		// where you left off (blueprint section 5).
		const view = recallView();
		const tab = view?.startsWith("center:") ? view.slice("center:".length) : null;
		const viewed = view?.startsWith("session:") ? view.slice("session:".length) : null;
		const main = settings.mainSessionId;
		const last = recall(LAST_SESSION);
		if (tab && CENTER_TABS.includes(tab)) {
			connect(null, null);
			openCenter(tab as CenterTab);
		} else if (viewed && getState().sessions[viewed]) await selectSession(viewed);
		else if (view === "home") connect(null, null);
		else if (main && getState().sessions[main]) await selectSession(main);
		else if (last && getState().sessions[last]) await selectSession(last);
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
		// Sidebar and approval center events are not replayed, so a reconnect reloads them.
		if (connectedOnce) {
			void reloadSessions();
			void loadCenter();
		}
		connectedOnce = true;
	});
	stream.addEventListener("reset", () => {
		if (source !== stream) return;
		void reloadSessions();
		void loadCenter();
		if (sessionId) void loadTranscript(sessionId);
	});
	stream.addEventListener("global", (message) => {
		applyGlobalEvent(JSON.parse((message as MessageEvent<string>).data) as GlobalEvent);
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

type GlobalEvent =
	| { type: "sessionSummary"; session: Session }
	| { type: "groups"; groups: Group[] }
	| { type: "approval"; approval: Approval }
	| { type: "letter"; letter: Letter }
	| { type: "card"; card: Card }
	| { type: "sessionsDeleted"; ids: string[] }
	| { type: "devices"; devices: Device[] };

/** Drops deleted sessions from every list; a deleted session that is open closes. */
function dropSessions(ids: string[]): void {
	const gone = new Set(ids);
	setState((current) => ({
		sessions: Object.fromEntries(Object.entries(current.sessions).filter(([id]) => !gone.has(id))),
		hasArchived: Object.values(current.sessions).some(
			(session) => session.archivedAt !== null && !gone.has(session.id),
		),
	}));
	const selected = getState().selectedId;
	if (selected && gone.has(selected)) void selectSession(null);
}

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
	if (!(id in record)) return record;
	const next = { ...record };
	delete next[id];
	return next;
}

function applyGlobalEvent(event: GlobalEvent): void {
	switch (event.type) {
		case "groups":
			setState({ groups: event.groups });
			return;
		case "sessionsDeleted":
			dropSessions(event.ids);
			return;
		case "devices":
			setState((current) => ({
				phones: current.phones ? { ...current.phones, devices: event.devices } : current.phones,
			}));
			return;
		case "sessionSummary":
			setState((current) => ({
				sessions: { ...current.sessions, [event.session.id]: event.session },
			}));
			return;
		case "approval": {
			const approval = event.approval;
			setState((current) => ({
				center: {
					...current.center,
					approvals:
						approval.status === "pending"
							? { ...current.center.approvals, [approval.id]: approval }
							: without(current.center.approvals, approval.id),
				},
			}));
			return;
		}
		case "card": {
			const card = event.card;
			setState((current) => ({
				center: {
					...current.center,
					cards:
						card.status === "pending"
							? { ...current.center.cards, [card.id]: card }
							: without(current.center.cards, card.id),
				},
				decisions:
					card.status === "decided" && current.decisions.loaded
						? {
								...current.decisions,
								items: [card, ...current.decisions.items.filter((c) => c.id !== card.id)],
							}
						: current.decisions,
			}));
			return;
		}
		case "letter": {
			const letter = event.letter;
			setState((current) => {
				const items = current.letters.items;
				const index = items.findIndex((item) => item.id === letter.id);
				const next =
					index >= 0 ? items.map((item, i) => (i === index ? letter : item)) : [letter, ...items];
				return {
					center: {
						...current.center,
						held:
							letter.status === "held"
								? { ...current.center.held, [letter.id]: letter }
								: without(current.center.held, letter.id),
					},
					letters: current.letters.loaded ? { ...current.letters, items: next } : current.letters,
				};
			});
			return;
		}
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

/** Opens a settings dialog over the conversation; the conversation stays where it is. */
export function openSettings(dialog: "providers" | "defaults" | "about" | "phones"): void {
	setState({ settingsDialog: dialog });
}

export async function selectSession(sessionId: string | null): Promise<void> {
	setState({ selectedId: sessionId, transcript: null, page: null });
	remember(LAST_SESSION, sessionId);
	rememberView(sessionId ? `session:${sessionId}` : "home");
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
	/** Named after the first message; Jig gives it a short name after its first turn. */
	autoName?: boolean;
}

export async function createSession(input: NewSessionInput): Promise<Session> {
	const session = await api<Session>("POST", "/api/sessions", input, { idempotent: true });
	setState((current) => ({ sessions: { ...current.sessions, [session.id]: session } }));
	await selectSession(session.id);
	return session;
}

/** A copy of the session with its conversation, opened at once (blueprint section 8). */
export async function duplicateSession(sessionId: string): Promise<Session> {
	const copy = await api<Session>("POST", `/api/sessions/${sessionId}/duplicate`, undefined, {
		idempotent: true,
	});
	setState((current) => ({ sessions: { ...current.sessions, [copy.id]: copy } }));
	await selectSession(copy.id);
	return copy;
}

export type SessionPatch = Partial<{
	name: string;
	groupId: string | null;
	/** A folder makes it a code session; null makes it a chat. */
	cwd: string | null;
	responsibility: string;
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	rules: PermissionRule[];
	options: {
		compactAt?: number | null;
		permissionMode?: PermissionMode;
		receive?: ReceivePolicy;
		letterQuota?: number | null;
		canPostCards?: boolean;
		canOrganize?: boolean;
	};
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

/** Saves the whole session as a Markdown file, named by the server. */
export async function exportSession(session: Session): Promise<void> {
	const { blob, filename } = await downloadFile(
		`/api/sessions/${session.id}/export.md?lang=${getLang()}`,
	);
	const url = URL.createObjectURL(blob);
	try {
		const link = document.createElement("a");
		link.href = url;
		link.download = filename ?? fallbackFilename(session.name);
		document.body.append(link);
		link.click();
		link.remove();
	} finally {
		// The browser needs the URL until the download has started.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}

function fallbackFilename(name: string): string {
	const base = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "session";
	return `${base}.md`;
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

/** The archived sessions, all of them, for the data settings. */
export async function loadArchived(): Promise<Session[]> {
	return all<Session>("/api/sessions?archived=true");
}

/** Deletes every archived session for good; the person confirmed it first. */
export async function deleteArchivedSessions(): Promise<number> {
	const result = await api<{ deleted: string[] }>("DELETE", "/api/sessions/archived");
	dropSessions(result.deleted);
	setState({ showArchived: false });
	return result.deleted.length;
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

// --- the approval center and letters ---

export async function loadCenter(): Promise<void> {
	const center = await api<{ approvals: Approval[]; cards: Card[]; held: Letter[] }>(
		"GET",
		"/api/center",
	);
	const next: CenterState = {
		approvals: indexBy(center.approvals),
		cards: indexBy(center.cards),
		held: indexBy(center.held),
	};
	setState({ center: next });
}

/** Opens the approval center page in place of the session (blueprint section 8). */
export function openCenter(tab: CenterTab = getState().centerTab): void {
	setState({ page: "center", centerTab: tab, drawerOpen: false });
	rememberView(`center:${tab}`);
	if (tab === "letters" && !getState().letters.loaded) void loadLetters();
	if (tab === "decided" && !getState().decisions.loaded) void loadDecisions();
}

export async function loadDecisions(more = false): Promise<void> {
	const cursor = more ? getState().decisions.nextCursor : null;
	const page = await api<Page<Card>>(
		"GET",
		`/api/cards?status=decided&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
	);
	setState((current) => ({
		decisions: {
			items: more ? [...current.decisions.items, ...page.items] : page.items,
			nextCursor: page.nextCursor,
			loaded: true,
		},
	}));
}

export async function loadLetters(more = false): Promise<void> {
	const cursor = more ? getState().letters.nextCursor : null;
	const page = await api<Page<Letter>>(
		"GET",
		`/api/letters?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
	);
	setState((current) => ({
		letters: {
			items: more ? [...current.letters.items, ...page.items] : page.items,
			nextCursor: page.nextCursor,
			loaded: true,
		},
	}));
}

export async function decideCard(cardId: string, choice: number | null, note: string | null) {
	return api<Card>(
		"POST",
		`/api/cards/${cardId}/decide`,
		{ choice, ...(note ? { note } : {}) },
		{ idempotent: true },
	);
}

export const releaseLetter = (id: string) => api<Letter>("POST", `/api/letters/${id}/release`);
export const refuseLetter = (id: string) => api<Letter>("POST", `/api/letters/${id}/refuse`);

/** Makes a session the main conversation, or none (blueprint section 5). */
export async function setMainSession(sessionId: string | null): Promise<void> {
	await saveSettings({ mainSessionId: sessionId });
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
	answer: {
		decision?: ApprovalDecision;
		reason?: string;
		answer?: string;
		answers?: QuestionAnswer[];
	},
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

// --- phone access (M3 plan, section 6) ---

export async function loadPhones(): Promise<void> {
	setState({ phones: await api<PhonesState>("GET", "/api/devices") });
}

export async function setPhoneAccess(enabled: boolean): Promise<void> {
	const settings = await api<Settings>("PATCH", "/api/settings", { remote: { enabled } });
	setState({ settings });
	await loadPhones();
}

export async function createPairing(): Promise<{ link: string; svg: string; expiresAt: number }> {
	return api("POST", "/api/devices/pairing");
}

export async function revokeDevice(id: string): Promise<void> {
	await api("DELETE", `/api/devices/${id}`);
	await loadPhones();
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
