import type { EntryBody, JsonObject } from "./messages.ts";

export type SessionKind = "standing" | "task";
export type SessionStatus = "idle" | "working" | "waiting" | "error" | "needs_review";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const SESSION_KINDS: readonly SessionKind[] = ["standing", "task"];
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

export type RuleEffect = "allow" | "ask" | "deny";

/** One permission rule: an effect for a tool, optionally narrowed by a path glob, command prefix or domain. */
export interface PermissionRule {
	effect: RuleEffect;
	tool: string;
	pattern?: string;
}

export interface SessionOptions {
	/** Compact when the context reaches this many tokens; null uses the default. */
	compactAt?: number | null;
	/** Let write and edit change files inside the working folder without asking. */
	directEdits?: boolean;
}

export interface Todo {
	text: string;
	status: "pending" | "in_progress" | "done";
}

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** US dollars. */
	cost: number;
}

export interface Group {
	id: string;
	name: string;
	position: number;
	createdAt: number;
	updatedAt: number;
}

export interface Session {
	id: string;
	name: string;
	kind: SessionKind;
	groupId: string | null;
	responsibility: string;
	/** Working folder; null means a chat without file access. */
	cwd: string | null;
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	rules: PermissionRule[];
	options: SessionOptions;
	todos: Todo[];
	status: SessionStatus;
	statusDetail: string | null;
	pinned: boolean;
	unread: number;
	archivedAt: number | null;
	usage: UsageTotals;
	/** Tokens the last model request used; drives compaction and the context meter. */
	contextTokens: number;
	/** Sequence number of the last durable event; the transcript stream resumes after it. */
	eventSeq: number;
	lastActivityAt: number;
	createdAt: number;
	updatedAt: number;
}

export type Entry = EntryBody & {
	id: string;
	sessionId: string;
	seq: number;
	createdAt: number;
};

export type ToolCallStatus =
	| "pending"
	| "waiting"
	| "running"
	| "done"
	| "error"
	| "denied"
	| "needs_review";

export interface ToolCallView {
	id: string;
	sessionId: string;
	messageId: string;
	callId: string;
	tool: string;
	args: JsonObject;
	status: ToolCallStatus;
	/** Tool-specific data for the interface, such as a diff or an exit code. */
	detail: JsonObject | null;
	resultMessageId: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	createdAt: number;
}

export type ApprovalDecision = "allow_once" | "allow_always" | "deny";

export interface PermissionRequest {
	tool: string;
	/** One line describing what will happen, e.g. the command or the file. */
	summary: string;
	/** Must-confirm operations can only be allowed once (spec 21.2). */
	mustConfirm: boolean;
	/** The rule "allow and remember" would add; absent when remembering is not offered. */
	rememberRule?: PermissionRule;
	reason?: string;
}

export interface QuestionRequest {
	question: string;
	options?: string[];
}

export interface Approval {
	id: string;
	sessionId: string;
	toolCallId: string | null;
	kind: "permission" | "question";
	request: PermissionRequest | QuestionRequest;
	status: "pending" | "resolved" | "cancelled";
	response: { decision?: ApprovalDecision; reason?: string; answer?: string } | null;
	createdAt: number;
	resolvedAt: number | null;
}

export interface QueuedMessage {
	id: string;
	sessionId: string;
	text: string;
	createdAt: number;
	updatedAt: number;
}

export interface Page<T> {
	items: T[];
	nextCursor: string | null;
}

/** Durable per-session events, replayed by sequence number after a reconnect. */
export type SessionEvent =
	| { type: "session"; session: Session }
	| { type: "entry"; entry: Entry }
	| { type: "toolCall"; toolCall: ToolCallView }
	| { type: "approval"; approval: Approval }
	| { type: "queue"; queue: QueuedMessage[] };

export interface Transcript {
	session: Session;
	entries: Entry[];
	toolCalls: ToolCallView[];
	approvals: Approval[];
	queue: QueuedMessage[];
	/** Seq of the oldest entry returned when older ones exist; pass as `before` to load them. */
	olderCursor: number | null;
}
