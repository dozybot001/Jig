import type { StatementSync } from "node:sqlite";
import type { EntryBody, JsonObject } from "../shared/messages.ts";
import { messageText } from "../shared/messages.ts";
import type {
	Approval,
	ApprovalDecision,
	Entry,
	Group,
	Page,
	PermissionRequest,
	PermissionRule,
	QuestionRequest,
	QueuedMessage,
	Session,
	SessionEvent,
	SessionKind,
	SessionOptions,
	SessionStatus,
	ThinkingLevel,
	Todo,
	ToolCallStatus,
	ToolCallView,
	UsageTotals,
} from "../shared/types.ts";
import { type Db, json, transaction } from "./db/database.ts";
import { conflict, invalid, notFound } from "./errors.ts";
import type { BusEvent, EventBus } from "./events.ts";
import { newId } from "./ids.ts";
import type { CustomProviderConfig } from "./model/gateway.ts";

export interface NewSession {
	name: string;
	kind: SessionKind;
	groupId?: string | null;
	responsibility?: string;
	cwd?: string | null;
	provider: string;
	model: string;
	thinking?: ThinkingLevel;
	rules?: PermissionRule[];
	options?: SessionOptions;
}

export interface SessionPatch {
	name?: string;
	groupId?: string | null;
	responsibility?: string;
	provider?: string;
	model?: string;
	thinking?: ThinkingLevel;
	rules?: PermissionRule[];
	options?: SessionOptions;
	pinned?: boolean;
	archived?: boolean;
	/** Clears the unread count. */
	read?: boolean;
}

export interface SearchHit {
	sessionId: string;
	entryId: string;
	seq: number;
	/** Matched text with the match wrapped in U+0002 … U+0003, so the interface can highlight it without HTML. */
	snippet: string;
}

export const MATCH_START = "\u0002";
export const MATCH_END = "\u0003";

interface SessionRow {
	id: string;
	name: string;
	kind: SessionKind;
	group_id: string | null;
	responsibility: string;
	cwd: string | null;
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	rules: string;
	options: string;
	todos: string;
	context: string | null;
	status: SessionStatus;
	status_detail: string | null;
	pinned: number;
	unread: number;
	archived_at: number | null;
	usage_input: number;
	usage_output: number;
	usage_cache_read: number;
	usage_cache_write: number;
	usage_cost: number;
	context_tokens: number;
	event_seq: number;
	message_seq: number;
	last_activity_at: number;
	created_at: number;
	updated_at: number;
}

interface GroupRow {
	id: string;
	name: string;
	position: number;
	created_at: number;
	updated_at: number;
}

interface EntryRow {
	id: string;
	session_id: string;
	seq: number;
	role: string;
	body: string;
	created_at: number;
}

interface ToolCallRow {
	id: string;
	session_id: string;
	message_id: string;
	call_id: string;
	tool: string;
	args: string;
	status: ToolCallStatus;
	detail: string | null;
	result_message_id: string | null;
	started_at: number | null;
	finished_at: number | null;
	created_at: number;
}

interface ApprovalRow {
	id: string;
	session_id: string;
	tool_call_id: string | null;
	kind: "permission" | "question";
	request: string;
	status: Approval["status"];
	response: string | null;
	created_at: number;
	resolved_at: number | null;
}

interface QueueRow {
	id: string;
	session_id: string;
	body: string;
	created_at: number;
	updated_at: number;
}

const MODEL_ROLES = "('system', 'user', 'assistant', 'toolResult')";
const NAME_MAX = 60;

function toSession(row: SessionRow): Session {
	return {
		id: row.id,
		name: row.name,
		kind: row.kind,
		groupId: row.group_id,
		responsibility: row.responsibility,
		cwd: row.cwd,
		provider: row.provider,
		model: row.model,
		thinking: row.thinking,
		rules: json<PermissionRule[]>(row.rules, []),
		options: json<SessionOptions>(row.options, {}),
		todos: json<Todo[]>(row.todos, []),
		status: row.status,
		statusDetail: row.status_detail,
		pinned: row.pinned === 1,
		unread: row.unread,
		archivedAt: row.archived_at,
		usage: {
			input: row.usage_input,
			output: row.usage_output,
			cacheRead: row.usage_cache_read,
			cacheWrite: row.usage_cache_write,
			cost: row.usage_cost,
		},
		contextTokens: row.context_tokens,
		eventSeq: row.event_seq,
		lastActivityAt: row.last_activity_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toGroup(row: GroupRow): Group {
	return {
		id: row.id,
		name: row.name,
		position: row.position,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toEntry(row: EntryRow): Entry {
	const body = JSON.parse(row.body) as EntryBody;
	return {
		...body,
		id: row.id,
		sessionId: row.session_id,
		seq: row.seq,
		createdAt: row.created_at,
	};
}

function toToolCall(row: ToolCallRow): ToolCallView {
	return {
		id: row.id,
		sessionId: row.session_id,
		messageId: row.message_id,
		callId: row.call_id,
		tool: row.tool,
		args: JSON.parse(row.args) as JsonObject,
		status: row.status,
		detail: json<JsonObject | null>(row.detail, null),
		resultMessageId: row.result_message_id,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		createdAt: row.created_at,
	};
}

function toApproval(row: ApprovalRow): Approval {
	return {
		id: row.id,
		sessionId: row.session_id,
		toolCallId: row.tool_call_id,
		kind: row.kind,
		request: JSON.parse(row.request) as PermissionRequest | QuestionRequest,
		status: row.status,
		response: json<Approval["response"]>(row.response, null),
		createdAt: row.created_at,
		resolvedAt: row.resolved_at,
	};
}

function toQueued(row: QueueRow): QueuedMessage {
	const body = JSON.parse(row.body) as { text: string };
	return {
		id: row.id,
		sessionId: row.session_id,
		text: body.text,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** Text indexed for search: what people and the model wrote, not thinking or tool output. */
function searchableText(body: EntryBody): string {
	if (body.role === "user") return messageText(body.message);
	if (body.role === "assistant") {
		return body.message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	return "";
}

export function validateSessionName(name: unknown): string {
	if (typeof name !== "string") throw invalid("The name must be text.", "name");
	const trimmed = name.trim();
	if (trimmed.length === 0) throw invalid("The name cannot be empty.", "name");
	if ([...trimmed].length > NAME_MAX) {
		throw invalid(`The name can be at most ${NAME_MAX} characters.`, "name");
	}
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
	if (/[\u0000-\u001f\u007f@]/.test(trimmed)) {
		throw invalid("The name cannot contain @ or control characters.", "name");
	}
	return trimmed;
}

/**
 * All reads and writes of Jig's data. Every change to a session's transcript appends a durable event
 * with the session's next sequence number; events are published on the bus only after the transaction
 * that wrote them commits.
 */
export class Store {
	readonly db: Db;
	readonly #bus: EventBus;
	readonly #statements = new Map<string, StatementSync>();
	#pending: BusEvent[] | null = null;

	constructor(db: Db, bus: EventBus) {
		this.db = db;
		this.#bus = bus;
	}

	#q(sql: string): StatementSync {
		let statement = this.#statements.get(sql);
		if (!statement) {
			statement = this.db.prepare(sql);
			this.#statements.set(sql, statement);
		}
		return statement;
	}

	/** One write transaction; bus events raised inside it go out after it commits. */
	tx<T>(fn: () => T): T {
		if (this.#pending) return fn();
		this.#pending = [];
		let events: BusEvent[] = [];
		try {
			const result = transaction(this.db, fn);
			events = this.#pending;
			return result;
		} finally {
			this.#pending = null;
			for (const event of events) this.#bus.publish(event);
		}
	}

	#publish(event: BusEvent): void {
		if (this.#pending) this.#pending.push(event);
		else this.#bus.publish(event);
	}

	/** Publishes an ephemeral event right away (drafts, live tool output). */
	live(sessionId: string, event: Extract<BusEvent, { scope: "live" }>["event"]): void {
		this.#bus.publish({ scope: "live", sessionId, event });
	}

	// --- events ---

	appendEvent(sessionId: string, event: SessionEvent): number {
		return this.tx(() => {
			const row = this.#q(
				"UPDATE sessions SET event_seq = event_seq + 1 WHERE id = ? RETURNING event_seq",
			).get(sessionId) as { event_seq: number } | undefined;
			if (!row) throw notFound("Session", sessionId);
			this.#q(
				"INSERT INTO session_events (session_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)",
			).run(sessionId, row.event_seq, event.type, JSON.stringify(event), Date.now());
			this.#publish({ scope: "session", sessionId, seq: row.event_seq, event });
			return row.event_seq;
		});
	}

	/** Events after `seq`, oldest first. `complete` is false when older events were pruned. */
	eventsAfter(
		sessionId: string,
		seq: number,
		limit = 1000,
	): { events: { seq: number; event: SessionEvent }[]; complete: boolean } {
		const oldest = this.#q("SELECT MIN(seq) AS seq FROM session_events WHERE session_id = ?").get(
			sessionId,
		) as { seq: number | null };
		const rows = this.#q(
			"SELECT seq, data FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?",
		).all(sessionId, seq, limit) as { seq: number; data: string }[];
		const complete = oldest.seq === null || oldest.seq <= seq + 1;
		return {
			events: rows.map((row) => ({ seq: row.seq, event: JSON.parse(row.data) as SessionEvent })),
			complete,
		};
	}

	pruneEvents(olderThan: number): void {
		this.#q("DELETE FROM session_events WHERE created_at < ?").run(olderThan);
	}

	// --- groups ---

	listGroups(): Group[] {
		const rows = this.#q(
			"SELECT * FROM groups ORDER BY position, id",
		).all() as unknown as GroupRow[];
		return rows.map(toGroup);
	}

	getGroup(id: string): Group {
		const row = this.#q("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
		if (!row) throw notFound("Group", id);
		return toGroup(row);
	}

	createGroup(name: string): Group {
		const clean = this.#groupName(name);
		return this.tx(() => {
			const now = Date.now();
			const max = this.#q("SELECT MAX(position) AS p FROM groups").get() as { p: number | null };
			const id = newId();
			this.#q(
				"INSERT INTO groups (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			).run(id, clean, (max.p ?? 0) + 1, now, now);
			this.#publishGroups();
			return this.getGroup(id);
		});
	}

	updateGroup(id: string, patch: { name?: string; position?: number }): Group {
		return this.tx(() => {
			const group = this.getGroup(id);
			const name = patch.name === undefined ? group.name : this.#groupName(patch.name);
			const position = patch.position ?? group.position;
			if (!Number.isFinite(position)) throw invalid("The position must be a number.", "position");
			this.#q("UPDATE groups SET name = ?, position = ?, updated_at = ? WHERE id = ?").run(
				name,
				position,
				Date.now(),
				id,
			);
			this.#publishGroups();
			return this.getGroup(id);
		});
	}

	/** Deletes a group; its sessions stay and move to "no group". */
	deleteGroup(id: string): void {
		this.tx(() => {
			this.getGroup(id);
			const members = this.#q("SELECT id FROM sessions WHERE group_id = ?").all(id) as {
				id: string;
			}[];
			this.#q("UPDATE sessions SET group_id = NULL, updated_at = ? WHERE group_id = ?").run(
				Date.now(),
				id,
			);
			this.#q("DELETE FROM groups WHERE id = ?").run(id);
			for (const member of members) this.#emitSession(member.id);
			this.#publishGroups();
		});
	}

	#groupName(name: unknown): string {
		if (typeof name !== "string" || name.trim().length === 0) {
			throw invalid("The group name cannot be empty.", "name");
		}
		const trimmed = name.trim();
		if ([...trimmed].length > NAME_MAX) {
			throw invalid(`The group name can be at most ${NAME_MAX} characters.`, "name");
		}
		return trimmed;
	}

	#publishGroups(): void {
		this.#publish({ scope: "global", event: { type: "groups", groups: this.listGroups() } });
	}

	// --- sessions ---

	getSession(id: string): Session {
		const row = this.#q("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
		if (!row) throw notFound("Session", id);
		return toSession(row);
	}

	findSessionByName(name: string): Session | undefined {
		const row = this.#q("SELECT * FROM sessions WHERE name = ? COLLATE NOCASE").get(name) as
			| SessionRow
			| undefined;
		return row ? toSession(row) : undefined;
	}

	listSessions(options: {
		archived?: boolean;
		cursor?: string | null;
		limit: number;
	}): Page<Session> {
		const archived = options.archived ? "archived_at IS NOT NULL" : "archived_at IS NULL";
		const rows = this.#q(
			`SELECT * FROM sessions WHERE ${archived} AND id > ? ORDER BY id LIMIT ?`,
		).all(options.cursor ?? "", options.limit + 1) as unknown as SessionRow[];
		const more = rows.length > options.limit;
		const items = rows.slice(0, options.limit).map(toSession);
		return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
	}

	createSession(input: NewSession): Session {
		const name = validateSessionName(input.name);
		return this.tx(() => {
			if (this.findSessionByName(name)) {
				throw conflict(`A session named "${name}" already exists.`, { field: "name" });
			}
			if (input.groupId) this.getGroup(input.groupId);
			const now = Date.now();
			const id = newId();
			this.#q(
				`INSERT INTO sessions (id, name, kind, group_id, responsibility, cwd, provider, model, thinking,
					rules, options, last_activity_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				id,
				name,
				input.kind,
				input.groupId ?? null,
				input.responsibility ?? "",
				input.cwd ?? null,
				input.provider,
				input.model,
				input.thinking ?? "medium",
				JSON.stringify(input.rules ?? []),
				JSON.stringify(input.options ?? {}),
				now,
				now,
				now,
			);
			return this.#emitSession(id);
		});
	}

	updateSession(id: string, patch: SessionPatch): Session {
		return this.tx(() => {
			const current = this.getSession(id);
			const sets: string[] = [];
			const values: (string | number | null)[] = [];
			const set = (column: string, value: string | number | null) => {
				sets.push(`${column} = ?`);
				values.push(value);
			};
			if (patch.name !== undefined) {
				const name = validateSessionName(patch.name);
				const other = this.findSessionByName(name);
				if (other && other.id !== id) {
					throw conflict(`A session named "${name}" already exists.`, { field: "name" });
				}
				set("name", name);
			}
			if (patch.groupId !== undefined) {
				if (patch.groupId !== null) this.getGroup(patch.groupId);
				set("group_id", patch.groupId);
			}
			if (patch.responsibility !== undefined) set("responsibility", patch.responsibility);
			if (patch.provider !== undefined) set("provider", patch.provider);
			if (patch.model !== undefined) set("model", patch.model);
			if (patch.thinking !== undefined) set("thinking", patch.thinking);
			if (patch.rules !== undefined) set("rules", JSON.stringify(patch.rules));
			if (patch.options !== undefined) {
				set("options", JSON.stringify({ ...current.options, ...patch.options }));
			}
			if (patch.pinned !== undefined) set("pinned", patch.pinned ? 1 : 0);
			if (patch.archived !== undefined) {
				set("archived_at", patch.archived ? (current.archivedAt ?? Date.now()) : null);
			}
			if (patch.read) set("unread", 0);
			if (sets.length === 0) return current;
			set("updated_at", Date.now());
			this.#q(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
			return this.#emitSession(id);
		});
	}

	setStatus(id: string, status: SessionStatus, detail: string | null = null): Session {
		return this.tx(() => {
			this.#q("UPDATE sessions SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?").run(
				status,
				detail,
				Date.now(),
				id,
			);
			return this.#emitSession(id);
		});
	}

	setTodos(id: string, todos: Todo[]): Session {
		return this.tx(() => {
			this.#q("UPDATE sessions SET todos = ?, updated_at = ? WHERE id = ?").run(
				JSON.stringify(todos),
				Date.now(),
				id,
			);
			return this.#emitSession(id);
		});
	}

	/** Adds one model request's usage; `contextTokens` is what that request put in the context window. */
	addUsage(id: string, usage: UsageTotals, contextTokens: number): Session {
		return this.tx(() => {
			this.#q(
				`UPDATE sessions SET usage_input = usage_input + ?, usage_output = usage_output + ?,
					usage_cache_read = usage_cache_read + ?, usage_cache_write = usage_cache_write + ?,
					usage_cost = usage_cost + ?, context_tokens = ?, updated_at = ? WHERE id = ?`,
			).run(
				usage.input,
				usage.output,
				usage.cacheRead,
				usage.cacheWrite,
				usage.cost,
				contextTokens,
				Date.now(),
				id,
			);
			return this.#emitSession(id);
		});
	}

	setContextTokens(id: string, contextTokens: number): Session {
		return this.tx(() => {
			this.#q("UPDATE sessions SET context_tokens = ?, updated_at = ? WHERE id = ?").run(
				contextTokens,
				Date.now(),
				id,
			);
			return this.#emitSession(id);
		});
	}

	bumpUnread(id: string): Session {
		return this.tx(() => {
			this.#q("UPDATE sessions SET unread = unread + 1 WHERE id = ?").run(id);
			return this.#emitSession(id);
		});
	}

	/** The saved system-prompt inputs (environment and instruction files) for this session. */
	getContextSnapshot<T>(id: string): T | null {
		const row = this.#q("SELECT context FROM sessions WHERE id = ?").get(id) as
			| { context: string | null }
			| undefined;
		if (!row) throw notFound("Session", id);
		return json<T | null>(row.context, null);
	}

	setContextSnapshot(id: string, snapshot: unknown): void {
		this.#q("UPDATE sessions SET context = ? WHERE id = ?").run(JSON.stringify(snapshot), id);
	}

	#emitSession(id: string): Session {
		return this.tx(() => {
			const current = this.getSession(id);
			// The event carries the session as it is after the event, including its own sequence number.
			const session = { ...current, eventSeq: current.eventSeq + 1 };
			this.appendEvent(id, { type: "session", session });
			this.#publish({ scope: "global", event: { type: "sessionSummary", session } });
			return session;
		});
	}

	// --- transcript entries ---

	appendEntry(sessionId: string, body: EntryBody): Entry {
		return this.tx(() => {
			const now = Date.now();
			const active = body.role === "user" || body.role === "assistant";
			const row = this.#q(
				`UPDATE sessions SET message_seq = message_seq + 1,
					last_activity_at = CASE WHEN ? THEN ? ELSE last_activity_at END, updated_at = ?
				WHERE id = ? RETURNING message_seq`,
			).get(active ? 1 : 0, now, now, sessionId) as { message_seq: number } | undefined;
			if (!row) throw notFound("Session", sessionId);
			const id = newId();
			this.#q(
				"INSERT INTO messages (id, session_id, seq, role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			).run(id, sessionId, row.message_seq, body.role, JSON.stringify(body), now);
			const text = searchableText(body);
			if (text) {
				this.#q("INSERT INTO message_search (text, session_id, message_id) VALUES (?, ?, ?)").run(
					text,
					sessionId,
					id,
				);
			}
			const entry: Entry = { ...body, id, sessionId, seq: row.message_seq, createdAt: now };
			this.appendEvent(sessionId, { type: "entry", entry });
			if (active) this.#emitSession(sessionId);
			return entry;
		});
	}

	getEntry(id: string): Entry {
		const row = this.#q("SELECT * FROM messages WHERE id = ?").get(id) as EntryRow | undefined;
		if (!row) throw notFound("Message", id);
		return toEntry(row);
	}

	/** A page of the transcript, newest last; `before` is a seq to page backwards from. */
	listEntries(
		sessionId: string,
		options: { before?: number | null; limit: number },
	): { entries: Entry[]; olderCursor: number | null } {
		const rows = this.#q(
			"SELECT * FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
		).all(
			sessionId,
			options.before ?? Number.MAX_SAFE_INTEGER,
			options.limit + 1,
		) as unknown as EntryRow[];
		const more = rows.length > options.limit;
		const entries = rows.slice(0, options.limit).reverse().map(toEntry);
		return { entries, olderCursor: more ? (entries[0]?.seq ?? null) : null };
	}

	/** Entries the model sees: everything since the latest compaction, plus that compaction's summary. */
	contextEntries(sessionId: string): Entry[] {
		const latest = this.#q(
			"SELECT * FROM messages WHERE session_id = ? AND role = 'compaction' ORDER BY seq DESC LIMIT 1",
		).get(sessionId) as EntryRow | undefined;
		if (!latest) {
			const rows = this.#q(
				`SELECT * FROM messages WHERE session_id = ? AND role IN ${MODEL_ROLES} ORDER BY seq`,
			).all(sessionId) as unknown as EntryRow[];
			return rows.map(toEntry);
		}
		const compaction = toEntry(latest);
		const firstKept = compaction.role === "compaction" ? compaction.compaction.firstKeptSeq : 0;
		const rows = this.#q(
			`SELECT * FROM messages WHERE session_id = ? AND role IN ${MODEL_ROLES} AND seq >= ? ORDER BY seq`,
		).all(sessionId, firstKept) as unknown as EntryRow[];
		return [compaction, ...rows.map(toEntry)];
	}

	// --- tool calls ---

	createToolCall(input: {
		sessionId: string;
		messageId: string;
		callId: string;
		tool: string;
		args: JsonObject;
		status?: ToolCallStatus;
	}): ToolCallView {
		return this.tx(() => {
			const id = newId();
			this.#q(
				`INSERT INTO tool_calls (id, session_id, message_id, call_id, tool, args, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				id,
				input.sessionId,
				input.messageId,
				input.callId,
				input.tool,
				JSON.stringify(input.args),
				input.status ?? "pending",
				Date.now(),
			);
			return this.#emitToolCall(id);
		});
	}

	getToolCall(id: string): ToolCallView {
		const row = this.#q("SELECT * FROM tool_calls WHERE id = ?").get(id) as ToolCallRow | undefined;
		if (!row) throw notFound("Tool call", id);
		return toToolCall(row);
	}

	updateToolCall(
		id: string,
		patch: {
			status?: ToolCallStatus;
			detail?: JsonObject | null;
			resultMessageId?: string;
			startedAt?: number;
			finishedAt?: number;
		},
	): ToolCallView {
		return this.tx(() => {
			const current = this.getToolCall(id);
			this.#q(
				`UPDATE tool_calls SET status = ?, detail = ?, result_message_id = ?, started_at = ?,
					finished_at = ? WHERE id = ?`,
			).run(
				patch.status ?? current.status,
				patch.detail === undefined
					? current.detail === null
						? null
						: JSON.stringify(current.detail)
					: patch.detail === null
						? null
						: JSON.stringify(patch.detail),
				patch.resultMessageId ?? current.resultMessageId,
				patch.startedAt ?? current.startedAt,
				patch.finishedAt ?? current.finishedAt,
				id,
			);
			return this.#emitToolCall(id);
		});
	}

	toolCallsForMessages(messageIds: string[]): ToolCallView[] {
		if (messageIds.length === 0) return [];
		const placeholders = messageIds.map(() => "?").join(", ");
		const rows = this.db
			.prepare(`SELECT * FROM tool_calls WHERE message_id IN (${placeholders}) ORDER BY id`)
			.all(...messageIds) as unknown as ToolCallRow[];
		return rows.map(toToolCall);
	}

	toolCallsByStatus(sessionId: string, statuses: ToolCallStatus[]): ToolCallView[] {
		const placeholders = statuses.map(() => "?").join(", ");
		const rows = this.db
			.prepare(
				`SELECT * FROM tool_calls WHERE session_id = ? AND status IN (${placeholders}) ORDER BY id`,
			)
			.all(sessionId, ...statuses) as unknown as ToolCallRow[];
		return rows.map(toToolCall);
	}

	#emitToolCall(id: string): ToolCallView {
		const toolCall = this.getToolCall(id);
		this.appendEvent(toolCall.sessionId, { type: "toolCall", toolCall });
		return toolCall;
	}

	// --- approvals and questions ---

	createApproval(input: {
		sessionId: string;
		toolCallId: string | null;
		kind: Approval["kind"];
		request: PermissionRequest | QuestionRequest;
	}): Approval {
		return this.tx(() => {
			const id = newId();
			this.#q(
				`INSERT INTO approvals (id, session_id, tool_call_id, kind, request, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			).run(
				id,
				input.sessionId,
				input.toolCallId,
				input.kind,
				JSON.stringify(input.request),
				Date.now(),
			);
			return this.#emitApproval(id);
		});
	}

	getApproval(id: string): Approval {
		const row = this.#q("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow | undefined;
		if (!row) throw notFound("Approval", id);
		return toApproval(row);
	}

	/** Records the person's answer. Only a pending request can be answered, and only once. */
	resolveApproval(
		id: string,
		response: { decision?: ApprovalDecision; reason?: string; answer?: string },
	): Approval {
		return this.tx(() => {
			const approval = this.getApproval(id);
			if (approval.status !== "pending") {
				throw conflict(
					"This request has already been answered or withdrawn.",
					undefined,
					"already-answered",
				);
			}
			this.#q(
				"UPDATE approvals SET status = 'resolved', response = ?, resolved_at = ? WHERE id = ?",
			).run(JSON.stringify(response), Date.now(), id);
			return this.#emitApproval(id);
		});
	}

	cancelApproval(id: string): Approval {
		return this.tx(() => {
			this.#q(
				"UPDATE approvals SET status = 'cancelled', resolved_at = ? WHERE id = ? AND status = 'pending'",
			).run(Date.now(), id);
			return this.#emitApproval(id);
		});
	}

	pendingApprovals(sessionId: string): Approval[] {
		const rows = this.#q(
			"SELECT * FROM approvals WHERE session_id = ? AND status = 'pending' ORDER BY id",
		).all(sessionId) as unknown as ApprovalRow[];
		return rows.map(toApproval);
	}

	approvalsForToolCalls(toolCallIds: string[]): Approval[] {
		if (toolCallIds.length === 0) return [];
		const placeholders = toolCallIds.map(() => "?").join(", ");
		const rows = this.db
			.prepare(`SELECT * FROM approvals WHERE tool_call_id IN (${placeholders}) ORDER BY id`)
			.all(...toolCallIds) as unknown as ApprovalRow[];
		return rows.map(toApproval);
	}

	#emitApproval(id: string): Approval {
		const approval = this.getApproval(id);
		this.appendEvent(approval.sessionId, { type: "approval", approval });
		return approval;
	}

	// --- messages queued while a session works ---

	listQueue(sessionId: string): QueuedMessage[] {
		const rows = this.#q("SELECT * FROM queued_messages WHERE session_id = ? ORDER BY id").all(
			sessionId,
		) as unknown as QueueRow[];
		return rows.map(toQueued);
	}

	enqueue(sessionId: string, text: string): QueuedMessage {
		return this.tx(() => {
			this.getSession(sessionId);
			const now = Date.now();
			const id = newId();
			this.#q(
				"INSERT INTO queued_messages (id, session_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			).run(id, sessionId, JSON.stringify({ text }), now, now);
			this.#emitQueue(sessionId);
			return this.#queued(id);
		});
	}

	updateQueued(sessionId: string, id: string, text: string): QueuedMessage {
		return this.tx(() => {
			const result = this.#q(
				"UPDATE queued_messages SET body = ?, updated_at = ? WHERE id = ? AND session_id = ?",
			).run(JSON.stringify({ text }), Date.now(), id, sessionId);
			if (result.changes === 0) {
				throw conflict(
					"This message was already delivered or withdrawn.",
					undefined,
					"already-delivered",
				);
			}
			this.#emitQueue(sessionId);
			return this.#queued(id);
		});
	}

	removeQueued(sessionId: string, id: string): void {
		this.tx(() => {
			const result = this.#q("DELETE FROM queued_messages WHERE id = ? AND session_id = ?").run(
				id,
				sessionId,
			);
			if (result.changes === 0) {
				throw conflict(
					"This message was already delivered or withdrawn.",
					undefined,
					"already-delivered",
				);
			}
			this.#emitQueue(sessionId);
		});
	}

	/** Moves every queued message into the transcript in one transaction, so none is lost or doubled. */
	deliverQueue(sessionId: string, toBody: (text: string) => EntryBody): Entry[] {
		return this.tx(() => {
			const queued = this.listQueue(sessionId);
			if (queued.length === 0) return [];
			this.#q("DELETE FROM queued_messages WHERE session_id = ?").run(sessionId);
			const entries = queued.map((item) => this.appendEntry(sessionId, toBody(item.text)));
			this.#emitQueue(sessionId);
			return entries;
		});
	}

	#queued(id: string): QueuedMessage {
		const row = this.#q("SELECT * FROM queued_messages WHERE id = ?").get(id) as
			| QueueRow
			| undefined;
		if (!row) throw notFound("Queued message", id);
		return toQueued(row);
	}

	#emitQueue(sessionId: string): void {
		this.appendEvent(sessionId, { type: "queue", queue: this.listQueue(sessionId) });
	}

	// --- settings ---

	getSetting<T>(key: string, fallback: T): T {
		const row = this.#q("SELECT value FROM settings WHERE key = ?").get(key) as
			| { value: string }
			| undefined;
		return row ? (JSON.parse(row.value) as T) : fallback;
	}

	setSetting(key: string, value: unknown): void {
		this.#q(
			"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
		).run(key, JSON.stringify(value));
	}

	// --- custom model providers (their keys stay in the keychain) ---

	listCustomProviders(): CustomProviderConfig[] {
		const rows = this.#q("SELECT config FROM providers ORDER BY id").all() as { config: string }[];
		return rows.map((row) => JSON.parse(row.config) as CustomProviderConfig);
	}

	saveCustomProvider(config: CustomProviderConfig): void {
		const now = Date.now();
		this.#q(
			`INSERT INTO providers (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET name = excluded.name, config = excluded.config,
				updated_at = excluded.updated_at`,
		).run(config.id, config.name, JSON.stringify(config), now, now);
	}

	deleteCustomProvider(id: string): boolean {
		return this.#q("DELETE FROM providers WHERE id = ?").run(id).changes > 0;
	}

	// --- sign-in tokens (only hashes are stored) ---

	saveAuthToken(hash: string, kind: "login" | "browser", expiresAt: number): void {
		this.#q("INSERT INTO auth_tokens (hash, kind, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
			hash,
			kind,
			expiresAt,
			Date.now(),
		);
	}

	/** Removes a one-time login token and says whether it was valid; a token works only once. */
	consumeLoginToken(hash: string): boolean {
		const row = this.#q(
			"DELETE FROM auth_tokens WHERE hash = ? AND kind = 'login' AND expires_at > ? RETURNING hash",
		).get(hash, Date.now());
		return row !== undefined;
	}

	/** Checks a browser token and extends it; returns false when unknown or expired. */
	touchBrowserToken(hash: string, extendTo: number): boolean {
		const now = Date.now();
		const result = this.#q(
			`UPDATE auth_tokens SET last_used_at = ?, expires_at = MAX(expires_at, ?)
			WHERE hash = ? AND kind = 'browser' AND expires_at > ?`,
		).run(now, extendTo, hash, now);
		return result.changes > 0;
	}

	deleteAuthToken(hash: string): void {
		this.#q("DELETE FROM auth_tokens WHERE hash = ?").run(hash);
	}

	pruneAuthTokens(): void {
		this.#q("DELETE FROM auth_tokens WHERE expires_at <= ?").run(Date.now());
	}

	// --- search ---

	search(query: string, limit = 20): { sessions: Session[]; hits: SearchHit[] } {
		const q = query.trim();
		if (q.length === 0) return { sessions: [], hits: [] };
		const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		const sessions = (
			this.#q(
				`SELECT * FROM sessions WHERE name LIKE ? ESCAPE '\\' OR responsibility LIKE ? ESCAPE '\\'
				ORDER BY last_activity_at DESC LIMIT ?`,
			).all(like, like, limit) as unknown as SessionRow[]
		).map(toSession);

		// The trigram index needs at least three characters; shorter queries scan the index text.
		const select = `SELECT s.session_id AS sessionId, s.message_id AS entryId, m.seq AS seq,
			snippet(message_search, 0, '${MATCH_START}', '${MATCH_END}', '…', 16) AS snippet
			FROM message_search s JOIN messages m ON m.id = s.message_id`;
		const hits =
			[...q].length >= 3
				? (this.#q(`${select} WHERE message_search MATCH ? ORDER BY rank LIMIT ?`).all(
						`"${q.replace(/"/g, '""')}"`,
						limit,
					) as unknown as SearchHit[])
				: (
						this.#q(
							`SELECT s.session_id AS sessionId, s.message_id AS entryId, m.seq AS seq, s.text AS snippet
							FROM message_search s JOIN messages m ON m.id = s.message_id
							WHERE s.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT ?`,
						).all(like, limit) as unknown as SearchHit[]
					).map((hit) => ({ ...hit, snippet: highlight(hit.snippet, q) }));
		return { sessions, hits };
	}

	// --- restart recovery ---

	/**
	 * After a restart nothing is running. Work that was in flight is marked "needs review" and is not
	 * redone automatically (blueprint 7.3): a tool call that was running may or may not have finished;
	 * a call that was only waiting for approval never ran and will be asked again.
	 */
	recoverAfterRestart(): string[] {
		return this.tx(() => {
			const affected = this.#q(
				"SELECT id FROM sessions WHERE status IN ('working', 'waiting')",
			).all() as { id: string }[];
			const now = Date.now();
			const running = this.#q("SELECT id FROM tool_calls WHERE status = 'running'").all() as {
				id: string;
			}[];
			for (const call of running) this.updateToolCall(call.id, { status: "needs_review" });
			const waiting = this.#q("SELECT id FROM tool_calls WHERE status = 'waiting'").all() as {
				id: string;
			}[];
			for (const call of waiting) this.updateToolCall(call.id, { status: "pending" });
			const pending = this.#q("SELECT id FROM approvals WHERE status = 'pending'").all() as {
				id: string;
			}[];
			for (const approval of pending) this.cancelApproval(approval.id);
			for (const session of affected) {
				this.#q(
					"UPDATE sessions SET status = 'needs_review', status_detail = ?, updated_at = ? WHERE id = ?",
				).run("Jig restarted while this session was working.", now, session.id);
				this.appendEntry(session.id, {
					role: "notice",
					notice: {
						kind: "restarted",
						text: "Jig restarted while this session was working.",
						timestamp: now,
					},
				});
				this.#emitSession(session.id);
			}
			return affected.map((session) => session.id);
		});
	}
}

function highlight(text: string, query: string): string {
	const index = text.toLowerCase().indexOf(query.toLowerCase());
	if (index < 0) return text.slice(0, 120);
	const start = Math.max(0, index - 40);
	const end = Math.min(text.length, index + query.length + 60);
	return `${start > 0 ? "…" : ""}${text.slice(start, index)}${MATCH_START}${text.slice(index, index + query.length)}${MATCH_END}${text.slice(index + query.length, end)}${end < text.length ? "…" : ""}`;
}
