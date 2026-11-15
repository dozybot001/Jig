import type { EntryBody, JsonObject } from "./messages.ts";

export type SessionKind = "standing" | "task";
export type SessionStatus = "idle" | "working" | "waiting" | "error" | "needs_review";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const SESSION_KINDS: readonly SessionKind[] = ["standing", "task"];
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
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
	/** Before 0.1: let write and edit change files without asking. Read as the automatic mode. */
	directEdits?: boolean;
	/**
	 * How approvals work: auto (Jig runs calls unless the model marks one with confirm), manual
	 * (edits and commands that are not read-only are asked about) or skip. Operations that must be
	 * confirmed (spec 21.2) are asked about in every mode.
	 */
	permissionMode?: PermissionMode;
	/** What happens to letters from other sessions: delivered, held for the person, or refused (blueprint 7.1). */
	receive?: ReceivePolicy;
	/** Letters the session may send per message or decision from the person; null or absent: the default. */
	letterQuota?: number | null;
	/** May put decision cards in the approval center directly, as the main conversation can. */
	canPostCards?: boolean;
	/** May rename sessions and teams and move sessions between teams, as the main conversation can. */
	canOrganize?: boolean;
	/** The most this session may spend in a day, in US dollars; null or absent: no limit of its own. */
	dailyBudget?: number | null;
	/** More room for one day, given when the person continued the session after it reached a limit. */
	budgetExtra?: { day: string; amount: number } | null;
	/** Named after its first message; after its first turn Jig gives it a short name of its own. */
	autoName?: boolean;
}

export const RECEIVE_POLICIES = ["accept", "hold", "refuse"] as const;
export type ReceivePolicy = (typeof RECEIVE_POLICIES)[number];

/** Letters a session may send between two messages or decisions from the person (blueprint 7.1). */
export const DEFAULT_LETTER_QUOTA = 10;
export const MAIN_LETTER_QUOTA = 30;

export function letterQuotaOf(options: SessionOptions, isMain: boolean): number {
	return options.letterQuota ?? (isMain ? MAIN_LETTER_QUOTA : DEFAULT_LETTER_QUOTA);
}

export const TASK_OUTCOMES = ["done", "given_up", "failed"] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

export const PERMISSION_MODES = ["auto", "manual", "skip"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** The session's approval mode; sessions from before the modes read direct edits as automatic. */
export function permissionModeOf(options: SessionOptions): PermissionMode {
	return options.permissionMode ?? (options.directEdits ? "auto" : "manual");
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

/** What all sessions together used on one local calendar day (YYYY-MM-DD). */
export interface UsageDay extends UsageTotals {
	day: string;
}

/** What one session used on one day. */
export interface SessionUsage extends UsageTotals {
	sessionId: string;
	name: string;
	archived: boolean;
}

/** The usage page: the last days oldest first, every day present; `budget` is the daily limit for all sessions. */
export interface UsageOverview {
	today: string;
	budget: number | null;
	days: UsageDay[];
}

/** One day on the usage page: the sessions that used a model then, the one that cost most first. */
export interface UsageDetail {
	day: string;
	total: number;
	sessions: SessionUsage[];
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
	/** The session that opened this one; null when the person opened it. */
	parentId: string | null;
	/** How a task session ended, as it recorded with finish_task. */
	outcome: TaskOutcome | null;
	/** Times the person stepped in: messages, approvals and answers (evaluation data, blueprint 6.2). */
	interventions: number;
	/** Letters sent since the person's last message or decision; the quota counts these. */
	lettersSent: number;
	lastActivityAt: number;
	createdAt: number;
	updatedAt: number;
}

export const LETTER_KINDS = ["notice", "request", "decision", "report"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];
export type LetterStatus = "queued" | "held" | "delivered" | "done" | "refused" | "dropped";
/** Who sent a letter: a session, the person (decisions), the command line (`jig send`) or Jig itself. */
export type SenderKind = "session" | "person" | "cli" | "jig";

/** A letter between sessions (blueprint section 7). Stored before it is delivered, so a restart loses none. */
export interface Letter {
	id: string;
	threadId: string;
	replyTo: string | null;
	fromKind: SenderKind;
	fromSession: string | null;
	/** The sender's name when the letter was sent. */
	fromName: string;
	toSession: string;
	kind: LetterKind;
	/** The first line, understandable on its own. */
	summary: string;
	body: string;
	status: LetterStatus;
	/** Why the letter was held, refused or dropped. */
	statusReason: string | null;
	/** Sessions that sent letters along this chain, oldest first (loop checks, blueprint 7.2). */
	path: string[];
	/** Jig sent the session's final reply on its behalf. */
	auto: boolean;
	/** For a decision letter: the number of the decision it carries. */
	decision: number | null;
	/** The scheduled task whose run this letter starts or reports on. */
	scheduleId: string | null;
	createdAt: number;
	deliveredAt: number | null;
}

export interface CardOption {
	label: string;
	detail?: string;
}

export type CardStatus = "pending" | "decided" | "withdrawn";

/** A decision card in the approval center (blueprint 6.4): the six points, options and the person's answer. */
export interface Card {
	id: string;
	/** The decision number sessions quote, #1, #2… */
	number: number;
	/** The session that put the card in the approval center. */
	createdBy: string | null;
	/** The session whose request the card is; the decision goes back to it. */
	requestedBy: string | null;
	title: string;
	context: string;
	options: CardOption[];
	/** Index of the recommended option. */
	recommended: number | null;
	deadline: string | null;
	/** Sessions involved. */
	sessions: string[];
	/** Whether the decision can be undone; null on cards from before it was asked. */
	undoable: boolean | null;
	/** How it can be undone, or what cannot be; may be empty. */
	reversible: string;
	/** Who does what once it is decided, beyond what the options say; may be empty. */
	after: string;
	status: CardStatus;
	/** Index of the chosen option; null when the person answered with a note only. */
	choice: number | null;
	note: string | null;
	decidedAt: number | null;
	withdrawnReason: string | null;
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

/** Why an operation must be confirmed every time (spec 21.2); the interface words each one. */
export type ConfirmReason =
	| "delete-files"
	| "delete-untracked"
	| "delete-branch"
	| "delete-tag"
	| "delete-stash"
	| "delete-ref"
	| "delete-worktree"
	| "discard-changes"
	| "rewrite-history"
	| "push"
	| "publish-package"
	| "change-package"
	| "publish-image"
	| "github"
	| "remote-machine"
	| "remote-copy"
	| "send-data"
	| "write-disk"
	| "cluster"
	| "infrastructure"
	| "system-services"
	| "jig-cli"
	| "credentials"
	| "write-credentials"
	| "admin"
	| "write-outside"
	// manage_jig changes that widen what a session may do (blueprint 6.2, item 10)
	| "widen-permission"
	| "change-folder"
	| "open-letters"
	| "raise-quota"
	| "raise-budget"
	| "grant-rights"
	| "change-main"
	| "decision-log";

export interface PermissionRequest {
	tool: string;
	/** One line describing what will happen, e.g. the command or the file. */
	summary: string;
	/** Must-confirm operations can only be allowed once (spec 21.2). */
	mustConfirm: boolean;
	/** Rules "allow and remember" would add; absent when remembering is not offered. */
	rememberRules?: PermissionRule[];
	/** Why a must-confirm operation asks every time. */
	reasons?: ConfirmReason[];
	/** The same in English words, on requests saved before the reasons had codes. */
	reason?: string;
	/** What the call is for, in the session's words, such as a command's purpose or a task's brief. */
	description?: string;
	/** The change an edit or write would make, as a unified patch, so the person sees it first. */
	diff?: string;
	/** The changes manage_jig would make, with names in place of ids, for the interface to word. */
	changes?: ChangeStep[];
}

/**
 * One change manage_jig makes, as the person reads it on the permission card and in the changed
 * session: names in place of ids, settings as codes the interface words in its language.
 */
export type ChangeStep =
	| { action: "create_team"; name: string }
	| { action: "rename_team"; from: string; to: string }
	| {
			action: "create_session";
			name: string;
			folder: string | null;
			model: string;
			team: string | null;
			role: string;
	  }
	| { action: "rename_session"; from: string; to: string }
	| { action: "move_to_team"; sessions: string[]; team: string | null }
	| { action: "set_role"; session: string; role: string }
	| { action: "set_model"; session: string; from: string; to: string }
	| { action: "set_folder"; session: string; from: string | null; to: string | null }
	| { action: "set_permission"; session: string; from: PermissionMode; to: PermissionMode }
	| { action: "set_receive"; session: string; from: ReceivePolicy; to: ReceivePolicy }
	| { action: "set_letter_quota"; session: string; from: number; to: number }
	/** A daily spending limit, of one session or of all together (no session); null is no limit. */
	| { action: "set_daily_budget"; session: string | null; from: number | null; to: number | null }
	| { action: "set_right"; session: string; right: "cards" | "manage"; on: boolean }
	| { action: "pin"; session: string; on: boolean }
	| { action: "archive"; session: string; on: boolean }
	| { action: "set_main"; from: string | null; to: string | null }
	| { action: "set_default_model"; from: string; to: string }
	| { action: "set_decision_log"; from: string | null; to: string | null }
	| { action: "add_workspace"; folder: string }
	| { action: "remove_workspace"; folder: string }
	| { action: "set_theme"; to: "system" | "light" | "dark" }
	| { action: "set_language"; to: "system" | "zh" | "en" }
	| {
			action: "create_schedule";
			name: string;
			cron: string;
			session: string;
			message: string;
			permission: PermissionMode | null;
	  }
	/** Only the fields that change are present; `permission` null means the session's own mode. */
	| {
			action: "change_schedule";
			schedule: string;
			name?: string;
			cron?: string;
			session?: string;
			message?: string;
			permission?: PermissionMode | null;
			catchUp?: boolean;
			enabled?: boolean;
	  };

/**
 * How a scheduled task's latest run went: still running, finished, stopped with an error, stopped by the
 * person, or skipped (the reason says why).
 */
export type ScheduleStatus = "running" | "done" | "error" | "stopped" | "skipped";

/**
 * Why a run was skipped: the last run was not finished, the session is archived, or the time passed
 * while Jig was not running or the computer slept and the task skips missed runs.
 */
export type ScheduleSkip = "busy" | "archived" | "missed";

/**
 * A scheduled task (blueprint 6.5, M3 plan section 9): at the times its cron expression names, Jig sends
 * a standing session a letter. It belongs to that session's team.
 */
export interface Schedule {
	id: string;
	name: string;
	/** Five fields, in the computer's time zone. */
	cron: string;
	sessionId: string;
	/** The letter's text: the first line is its summary. */
	message: string;
	/** The permission mode for its runs; null uses the session's own. */
	permissionMode: PermissionMode | null;
	/** A run missed while Jig was not running or the computer slept runs once afterwards. */
	catchUp: boolean;
	enabled: boolean;
	/** When it runs next; null while it is turned off. */
	nextRunAt: number | null;
	lastRunAt: number | null;
	lastStatus: ScheduleStatus | null;
	/** The first line of the run's reply, the error, or a ScheduleSkip code. */
	lastDetail: string | null;
	/** The letter of the latest run. */
	lastLetterId: string | null;
	createdAt: number;
	updatedAt: number;
}

export const ARTIFACT_KINDS = ["markdown", "html", "json", "chart"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Something a session made for the person to keep: a document, a page, data or a chart (blueprint 6.6). */
export interface Artifact {
	id: string;
	sessionId: string;
	name: string;
	kind: ArtifactKind;
	/** The latest version; versions count from 1. */
	version: number;
	/** Bytes of the latest version. */
	size: number;
	createdAt: number;
	updatedAt: number;
}

/** A phone paired with this Mac through the relay (M3 plan, section 4). */
export interface Device {
	id: string;
	name: string;
	/** The phone's Noise static key, base64url. */
	publicKey: string;
	/** Whether Jig sends it notifications. */
	push: boolean;
	/** The phone has given an APNs token. */
	canPush: boolean;
	createdAt: number;
	lastSeenAt: number | null;
}

/** One question a session asks the person with ask_user; a card holds up to four. */
export interface Question {
	question: string;
	/** A tag of a few words shown before the question, such as its topic. */
	header?: string;
	options?: QuestionOption[];
	/** Index of the option the session recommends; it is chosen to start with. */
	recommended?: number;
	/** The person may pick more than one option. */
	multiple?: boolean;
}

export interface QuestionOption {
	label: string;
	/** What the choice means or leads to. */
	detail?: string;
}

export interface QuestionRequest {
	questions?: Question[];
	/**
	 * Asked at the end of a reply rather than with ask_user. Jig put it in the approval center; the answer
	 * goes to the session as the person's message.
	 */
	fromReply?: boolean;
	/** One question with plain options, as asked before a card could hold several. */
	question?: string;
	options?: string[];
}

/** The person's answer to one question: the options picked, by index, and words of their own. */
export interface QuestionAnswer {
	choices: number[];
	text?: string;
}

/** The questions of a request, whichever form it was saved in. */
export function questionsOf(request: QuestionRequest): Question[] {
	if (request.questions && request.questions.length > 0) return request.questions;
	const options = request.options?.map((label) => ({ label }));
	return [{ question: request.question ?? "", ...(options?.length ? { options } : {}) }];
}

export interface Approval {
	id: string;
	sessionId: string;
	toolCallId: string | null;
	kind: "permission" | "question";
	request: PermissionRequest | QuestionRequest;
	status: "pending" | "resolved" | "cancelled";
	/** answer is the person's words, or for structured answers the text the session read. */
	response: {
		decision?: ApprovalDecision;
		reason?: string;
		answer?: string;
		answers?: QuestionAnswer[];
	} | null;
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
