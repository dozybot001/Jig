/**
 * Transcript message shapes. They mirror the model library's message JSON field for field, so a stored
 * message replays without conversion; `src/server/model/` checks at compile time that they stay assignable.
 * Nothing outside the model layer imports the library's own types.
 */

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export interface TextBlock {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string;
	redacted?: boolean;
}

export interface ImageBlock {
	type: "image";
	/** Base64 without the `data:` prefix. */
	data: string;
	mimeType: string;
}

export interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments: JsonObject;
	thoughtSignature?: string;
	/** Set when the model's arguments were not a valid JSON object; `arguments` is then `{}`. */
	argumentsError?: string;
}

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
		totalFromProvider?: boolean;
	};
}

export type StopReason =
	| "pending"
	| "stop"
	| "length"
	| "toolUse"
	| "error"
	| "aborted"
	| "deferred";

export interface SystemMessage {
	role: "system";
	content: string;
	sections?: Record<string, string | null>;
	timestamp: number;
}

export interface UserMessage {
	role: "user";
	content: string | (TextBlock | ImageBlock)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextBlock | ThinkingBlock | ToolCallBlock)[];
	api: string;
	provider: string;
	model: string;
	usage: TokenUsage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
	durationMs?: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextBlock | ImageBlock)[];
	details?: JsonValue;
	isError: boolean;
	timestamp: number;
	durationMs?: number;
}

/** What the model sees. */
export type ModelMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

/** Marks where older history was summarized; the model sees `summary` in place of messages before `firstKeptSeq`. */
export interface CompactionRecord {
	summary: string;
	firstKeptSeq: number;
	tokensBefore: number;
	timestamp: number;
}

/** A line in the transcript for the person only; never sent to the model. */
export interface Notice {
	kind:
		| "interrupted"
		| "model_changed"
		| "restarted"
		| "error"
		| "compacted"
		| "job_finished"
		/** Another session changed this one with manage_jig; data has who and the changes. */
		| "changed";
	text?: string;
	data?: JsonObject;
	timestamp: number;
}

/** A decision the person made in the approval center, as delivered to a session. */
export interface DecisionRef {
	number: number;
	title: string;
	/** The option the person chose; null when they answered with a note only. */
	choice: string | null;
	note: string | null;
	decidedAt: number;
}

/** A letter delivered into a transcript. The interface shows it as a letter; the model reads `message`. */
export interface LetterRef {
	id: string;
	kind: "notice" | "request" | "decision" | "report";
	from: { kind: "session" | "person" | "cli" | "jig"; sessionId: string | null; name: string };
	summary: string;
	body: string;
	/** Jig sent the session's final reply on its behalf. */
	auto?: boolean;
	decision?: DecisionRef;
	/** The scheduled task whose run the letter starts or reports on. */
	schedule?: { id: string; name: string };
}

export type EntryBody =
	| { role: "system"; message: SystemMessage }
	| { role: "user"; message: UserMessage; letter?: LetterRef }
	| { role: "assistant"; message: AssistantMessage }
	| { role: "toolResult"; message: ToolResultMessage }
	| { role: "compaction"; compaction: CompactionRecord }
	| { role: "notice"; notice: Notice };

export type EntryRole = EntryBody["role"];

/**
 * The first line of a text without Markdown marks, for a one-line summary: a reply that starts with
 * "**Done**" reads "Done" in a letter's summary.
 */
export function plainLine(text: string): string {
	const first = (text.trim().split("\n")[0] ?? "").trim();
	return first
		.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.trim();
}

/** A letter's body without a first line that only repeats the summary, as Jig's reports do. */
export function bodyAfterSummary(body: string, summary: string): string {
	const [first = "", ...rest] = body.trim().split("\n");
	return plainLine(first) === plainLine(summary) ? rest.join("\n").trim() : body;
}

export function messageText(message: ModelMessage): string {
	if (typeof message.content === "string") return message.content;
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") parts.push(block.text);
		else if (block.type === "thinking") parts.push(block.thinking);
		else if (block.type === "toolCall")
			parts.push(`${block.name} ${JSON.stringify(block.arguments)}`);
	}
	return parts.join("\n");
}

/** The first question of an ask_user call, and how many it asks, for one-line summaries. */
export function askedQuestion(
	args: Record<string, unknown>,
): { question: string; count: number } | null {
	const list = Array.isArray(args.questions) ? args.questions : null;
	const first = list ? (list[0] as { question?: unknown } | undefined)?.question : args.question;
	if (typeof first !== "string") return null;
	return { question: first, count: list ? list.length : 1 };
}
