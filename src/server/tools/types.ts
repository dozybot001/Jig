import type { ImageBlock, JsonObject, TextBlock } from "../../shared/messages.ts";
import type {
	Letter,
	PermissionRequest,
	QuestionRequest,
	Session,
	SessionStatus,
	TaskOutcome,
	Todo,
} from "../../shared/types.ts";
import type { Outgoing, PostOffice } from "../mail/post.ts";
import type { Subject } from "../permissions/engine.ts";
import type { Jobs } from "./jobs.ts";
import type { ReadState } from "./read-state.ts";

export interface ToolResult {
	content: (TextBlock | ImageBlock)[];
	isError?: boolean;
	/** Data for the interface only, such as a diff; never sent to the model. */
	detail?: JsonObject;
}

export interface ToolContext {
	session: Session;
	signal: AbortSignal;
	readState: ReadState;
	jobs: Jobs;
	/** Where long outputs are written; inside Jig's data directory. */
	tmpDir: string;
	acceptsImages: boolean;
	version: string;
	/** Live output for the interface while the tool runs. */
	output(text: string): void;
	setTodos(todos: Todo[]): void;
	/** Asks the person a question in Jig and waits for the answer. */
	/** Puts questions to the person and waits; resolves with the answer as the session reads it. */
	ask(request: QuestionRequest): Promise<string>;
	mail: MailContext;
}

/** How waiting for another session ended (send_letter and open_session with `wait`). */
export type WaitResult =
	| { kind: "letter"; letter: Letter }
	| { kind: "ended"; status: SessionStatus; text: string; detail: string | null; stopped: boolean }
	| { kind: "timeout" }
	/** Waiting would close a circle of sessions waiting for each other. */
	| { kind: "cycle" }
	/** The recipient is not running (it needs the person first); the letter waits for it. */
	| { kind: "not-running"; status: SessionStatus }
	/** This session was stopped while it waited. */
	| { kind: "stopped" }
	/** The person archived the recipient before it read the letter. */
	| { kind: "archived" };

export interface OpenInput {
	name: string;
	brief: string;
	/** Absolute folder inside the opener's, or null for a chat; undefined keeps the opener's folder. */
	cwd?: string | null;
	provider?: string;
	model?: string;
}

/** Letters, decision cards and child sessions, as the calling session. */
export interface MailContext {
	post: PostOffice;
	/** The calling session may put cards in the approval center. */
	canPostCards: boolean;
	send(out: Outgoing): Letter;
	wait(letter: Letter): Promise<WaitResult>;
	open(input: OpenInput): { session: Session; letter: Letter };
	finish(outcome: TaskOutcome): Session;
	/** Applies all the changes or none; returns what changed, one line each. */
	organize(changes: OrganizeChange[]): string[];
}

/**
 * The model's way to ask for a person's approval in the automatic mode. Offered on tools that change
 * things or reach out: write, edit, shell and web_fetch.
 */
export const CONFIRM_ARGUMENT = {
	type: "boolean",
	description:
		"Ask the person before this runs. Set it when the call is risky, destructive or hard to undo.",
} as const;

export interface ToolDefinition {
	name: string;
	/** Jig's own wording (AGENTS.md: no text copied from other products). */
	description: string;
	/** JSON Schema of the arguments. */
	parameters: JsonObject;
	/** Read-only tools in one batch run in parallel; any other tool makes the batch sequential. */
	readOnly: boolean;
	/** Offered only to sessions with a working folder; chats get the rest. */
	needsFolder: boolean;
	/** Offered only when this says so, e.g. card tools to the main conversation. */
	offered?(session: Session, roles: Roles): boolean;
	/**
	 * What the call touches, for the permission check. Throws ToolInputError on bad arguments. `names`
	 * turns a session id into its name, so a request the person reads says which sessions it means.
	 */
	subject(args: JsonObject, session: Session, names?: (id: string) => string | null): Subject;
	/**
	 * What the person sees besides the call itself when Jig asks for permission: its purpose, the change
	 * it would make. Never throws; a call without a preview is asked about as it is.
	 */
	preview?(
		args: JsonObject,
		session: Session,
		names: (id: string) => string | null,
	): PermissionPreview;
	run(args: JsonObject, ctx: ToolContext): Promise<ToolResult>;
}

/** The parts of a permission request a tool fills in (see PermissionRequest). */
export type PermissionPreview = Pick<PermissionRequest, "description" | "diff" | "organize">;

/** What a session may do beyond its tools' own checks. */
export interface Roles {
	canPostCards: boolean;
	/** May rename sessions and teams and move sessions between teams. */
	canOrganize: boolean;
}

/** One change organize_sessions makes; teams are named by id or by their exact name. */
export type OrganizeChange =
	| { action: "rename_session"; session: string; name: string }
	| { action: "create_team"; name: string }
	| { action: "rename_team"; team: string; name: string }
	| { action: "move_to_team"; sessions: string[]; team: string | null };

/** Bad arguments from the model; reported back to it as an error result. */
export class ToolInputError extends Error {}

export const text = (value: string): TextBlock => ({ type: "text", text: value });

export function errorResult(message: string): ToolResult {
	return { content: [text(message)], isError: true };
}

export function str(args: JsonObject, key: string, required: true): string;
export function str(args: JsonObject, key: string, required?: false): string | undefined;
export function str(args: JsonObject, key: string, required = false): string | undefined {
	const value = args[key];
	if (value === undefined || value === null) {
		if (required) throw new ToolInputError(`Missing argument: ${key}.`);
		return undefined;
	}
	if (typeof value !== "string") throw new ToolInputError(`${key} must be a string.`);
	return value;
}

export function int(args: JsonObject, key: string, min: number, max: number): number | undefined {
	const value = args[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
		throw new ToolInputError(`${key} must be a whole number from ${min} to ${max}.`);
	}
	return value;
}

export function bool(args: JsonObject, key: string): boolean | undefined {
	const value = args[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "boolean") throw new ToolInputError(`${key} must be true or false.`);
	return value;
}
