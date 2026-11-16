import { rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
	type AssistantMessage,
	type EntryBody,
	type JsonObject,
	messageText,
	type Notice,
	plainLine,
	type ToolCallBlock,
	type ToolResultMessage,
} from "../../shared/messages.ts";
import {
	type Approval,
	type ApprovalDecision,
	type Entry,
	type Letter,
	type PermissionMode,
	permissionModeOf,
	type QuestionAnswer,
	type QuestionRequest,
	type QueuedMessage,
	type Session,
	type SessionStatus,
	type ToolCallView,
} from "../../shared/types.ts";
import {
	type BudgetMark,
	crossedWarning,
	dollars,
	grantMore,
	localDay,
	reached,
} from "../budget.ts";
import { conflict, invalid, JigError } from "../errors.ts";
import { decisionRef, letterRef, letterText, type ScheduleRef } from "../mail/envelope.ts";
import { BODY_MAX, PostOffice, reasonText, SUMMARY_MAX } from "../mail/post.ts";
import { Manager } from "../manage.ts";
import type { ModelGateway, ModelInfo } from "../model/gateway.ts";
import { resolveWorkingFolder } from "../paths.ts";
import type { PermissionEngine } from "../permissions/engine.ts";
import { isInside } from "../permissions/paths.ts";
import { ScheduleBook } from "../schedules.ts";
import { skillFolders } from "../skills.ts";
import { type Store, validateSessionName } from "../store.ts";
import { Jobs } from "../tools/jobs.ts";
import { settleAnswer } from "../tools/misc.ts";
import { ReadState } from "../tools/read-state.ts";
import { ALL_TOOLS, specs, toolsFor } from "../tools/registry.ts";
import {
	type Lookup,
	type MailContext,
	type OpenInput,
	type Roles,
	type ToolContext,
	type ToolDefinition,
	ToolInputError,
	type ToolResult,
	type WaitResult,
} from "../tools/types.ts";
import { ContextKeeper, notice } from "./compaction.ts";
import { JIG_NOTE, sanitizeInterrupted, toModelMessages, usageTotals } from "./context.ts";
import { Held } from "./held.ts";
import {
	type ContextSnapshot,
	type InstructionExtras,
	NAMING_PROMPT,
	PERMISSION_MODE,
	type Placement,
	systemPrompt,
} from "./prompt.ts";

/** Words a reply uses to offer a next step instead of asking outright. */
const OFFER =
	/如需|需要的话|要不要|是否需要|告诉我|说一声|let me know|tell me if|shall i|should i|would you like|do you want/i;

/**
 * The question a reply ends with, if it ends with one: its last paragraph (outside code) when that asks
 * something or offers a next step. A session that asks the person this way goes idle, so Jig puts the
 * question in the approval center for it (blueprint principle 8: Jig carries this, not a prompt rule).
 */
export function askedInReply(text: string): string | null {
	const prose = text.replace(/```[\s\S]*?(```|$)/g, "").trim();
	const last =
		prose
			.split(/\n\s*\n/)
			.at(-1)
			?.trim() ?? "";
	if (!last) return null;
	const end = last.replace(/[\s*_`)\]）」』"'”’]+$/u, "");
	if (!/[?？]$/.test(end) && !OFFER.test(last)) return null;
	return last.length > 600 ? `…${last.slice(-600)}` : last;
}

type Answer = {
	decision?: ApprovalDecision;
	reason?: string;
	answer?: string;
	answers?: QuestionAnswer[];
};

interface Live {
	controller: AbortController;
	done: Promise<void>;
	waiters: Map<string, (answer: Answer | null) => void>;
}

/** A turn a scheduled task started (M3 plan, section 9). */
interface ScheduledRun {
	letterId: string;
	scheduleId: string;
	name: string;
	/** The permission mode for this run; null keeps the session's own. */
	mode: PermissionMode | null;
	/** Nobody is there to approve or answer, until the person writes to the session. */
	unattended: boolean;
	/** What Jig refused for want of the person, for the report. */
	refused: string[];
}

/** One turn of a session: what it sent and read, who started it, and the scheduled run it is. */
interface Turn {
	sent: Letter[];
	read: Map<string, number>;
	/** The person started it with a message or by continuing. */
	byPerson: boolean;
	/** Letters were delivered at least once. */
	started: boolean;
	run: ScheduledRun | null;
}

export interface AgentsOptions {
	store: Store;
	gateway: ModelGateway;
	permissions: PermissionEngine;
	home: string;
	version: string;
	/** The tools sessions may be offered; a function is asked every time, for tools that come and go. */
	tools?: ToolDefinition[] | (() => ToolDefinition[]);
	log?: (line: string) => void;
	/** How often streaming drafts go to the interface. */
	draftIntervalMs?: number;
	/** Letters and the approval center; one is made when not given. */
	post?: PostOffice;
	/** The longest send_letter and open_session wait for an answer; tests shorten it. */
	waitMs?: number;
	/** Scheduled tasks; one is made when not given. */
	schedules?: ScheduleBook;
	/** The person's home folder, for `~/.claude` skills and instructions; absent, they are not read. */
	userHome?: string | null;
	/** The most model requests one turn makes before Jig stops it; tests lower it. */
	maxSteps?: number;
}

const MAX_MESSAGE_CHARS = 100_000;
const MAX_STEPS = 500;
/** How many times in a row a reply cut off at the model's output limit is continued by itself. */
const MAX_CUT_REPLIES = 3;
/** After this many tool calls without a change to a task list that still has open tasks, Jig reminds the model. */
const TODO_REMINDER_AFTER = 12;
/** How long a session waits for another one's answer (blueprint 7.1: one wait, no polling). */
const WAIT_MS = 30 * 60 * 1000;
/** The result of a call that was running when Jig stopped (blueprint 7.3). */

const CUT_CALL =
	"Not run: your reply was cut off at the output limit before its tool calls were complete. Make the call again; write long content in parts.";
const CUT_TOO_OFTEN = "The reply was cut off at the model's output limit several times in a row.";

const RESTARTED =
	"Jig restarted while this call was running. It may or may not have finished; check the current state before running it again.";

const clip = (text: string, max: number) =>
	[...text].length > max ? `${[...text].slice(0, max - 1).join("")}…` : text;

const userEntry = (text: string): EntryBody => ({
	role: "user",
	message: { role: "user", content: text, timestamp: Date.now() },
});

/** Tokens the next request starts from: everything sent plus what the model just wrote. */
function contextSize(message: AssistantMessage): number {
	const usage = message.usage;
	return usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
}

function resultEntry(
	call: { callId: string; tool: string },
	result: ToolResult,
	started: number,
): EntryBody {
	const message: ToolResultMessage = {
		role: "toolResult",
		toolCallId: call.callId,
		toolName: call.tool,
		content: result.content,
		isError: result.isError ?? false,
		timestamp: Date.now(),
		durationMs: Date.now() - started,
	};
	return { role: "toolResult", message };
}

const failure = (text: string): ToolResult => ({
	content: [{ type: "text", text }],
	isError: true,
});

/**
 * Runs sessions. Each working session is one async loop in this process (M1 plan, section 4): ask the
 * model, check and run the tools it calls, feed back the results, and repeat until the model stops.
 * Every step is stored as it happens, so a restart can tell what was in flight.
 */
export class Agents {
	readonly #store: Store;
	readonly #gateway: ModelGateway;
	readonly #permissions: PermissionEngine;
	readonly #home: string;
	readonly #version: string;
	readonly #allTools: () => ToolDefinition[];
	readonly #log: (line: string) => void;
	readonly #draftInterval: number;
	readonly #live = new Map<string, Live>();
	readonly #readStates = new Map<string, ReadState>();
	readonly #jobs = new Map<string, Jobs>();
	/** Messages from Jig itself (such as "a background job ended") waiting to reach the model. */
	readonly #notes = new Map<string, string[]>();
	/** Tool calls since each session last changed its task list. */
	readonly #sinceTodo = new Map<string, number>();
	/** Letters, decision cards and the approval center. */
	readonly post: PostOffice;
	/** Scheduled tasks, whose runs end in this runner. */
	readonly schedules: ScheduleBook;
	readonly #waitMs: number;
	/** Each working session's latest written reply in this turn. */
	readonly #lastText = new Map<string, string>();
	/** Sessions blocked in send_letter or open_session: the session, letter and tool call each waits on. */
	readonly #waits = new Map<
		string,
		{ target: string; letterId: string; callId: string; resolve: (result: WaitResult) => void }
	>();
	/**
	 * Each working session's current turn: the letters it sent, and for each letter it read, how many it
	 * had sent by then, so Jig can tell what it asked after reading a request.
	 */
	readonly #turns = new Map<string, Turn>();
	readonly #userHome: string | null;
	/**
	 * Sessions the person stopped (letters wait until the person writes to them or continues them) and
	 * sessions that stopped at a daily spending limit (raising the limit that day continues them).
	 */
	readonly #held: Held;
	readonly #maxSteps: number;
	readonly #context: ContextKeeper;
	readonly #manager: Manager;
	/** A session's or team's name by id, for what the person reads on permission cards. */
	readonly #names = (id: string): string | null => {
		const session = this.post.sessionName(id);
		if (session) return session;
		try {
			return this.#store.getGroup(id).name;
		} catch {
			return null;
		}
	};
	/** Letters handed to a waiting tool call, by the call's id, until the call's result is stored. */
	readonly #handed = new Map<string, string>();

	constructor(options: AgentsOptions) {
		this.#store = options.store;
		this.#gateway = options.gateway;
		this.#permissions = options.permissions;
		this.#home = options.home;
		this.#version = options.version;
		const tools = options.tools ?? ALL_TOOLS;
		this.#allTools = typeof tools === "function" ? tools : () => tools;
		this.#log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
		this.#draftInterval = options.draftIntervalMs ?? 50;
		this.post = options.post ?? new PostOffice(options.store, this.#log);
		this.schedules = options.schedules ?? new ScheduleBook(options.store);
		this.#waitMs = options.waitMs ?? WAIT_MS;
		this.#userHome = options.userHome ?? null;
		this.#held = new Held(options.store);
		this.#maxSteps = options.maxSteps ?? MAX_STEPS;
		this.#context = new ContextKeeper({
			store: this.#store,
			gateway: this.#gateway,
			home: this.#home,
			placement: (session) => this.#placement(session),
			extras: () => this.#extras(),
		});
		// Memory folders and the person's skill folders are read without asking, like the working folder.
		this.#permissions.readRoots = () => [
			...this.#store.getSetting<string[]>("memoryDirs", []),
			...skillFolders(null, this.#home, this.#userHome),
		];
		this.post.setHooks({ queued: (letter) => this.#onQueued(letter) });
		this.#manager = new Manager({
			store: this.#store,
			schedules: this.schedules,
			mainId: () => this.post.mainSessionId(),
			modelExists: (provider, model) => Boolean(this.#gateway.model(provider, model)),
			onArchived: (id) => this.archived(id),
		});
	}

	/** What tools may look up while Jig checks a call of `session`. */
	#lookup(session: Session): Lookup {
		return { name: this.#names, plan: (args) => this.#manager.plan(session, args) };
	}

	isRunning(sessionId: string): boolean {
		return this.#live.has(sessionId);
	}

	/**
	 * Whether a command of this session may still be writing its output file: a turn is running, or a
	 * background command has not ended. The data cleanup leaves such a session's files alone.
	 */
	hasLiveCommands(sessionId: string): boolean {
		if (this.isRunning(sessionId)) return true;
		return (
			this.#jobs
				.get(sessionId)
				?.list()
				.some((job) => !job.finished) ?? false
		);
	}

	/** Resolves when the session is not running. */
	async whenIdle(sessionId: string): Promise<void> {
		await this.#live.get(sessionId)?.done;
	}

	/** The person sends a message: it starts a turn, or waits in the queue while one runs (blueprint 7.1). */
	send(sessionId: string, text: string): { entry: Entry } | { queued: QueuedMessage } {
		const trimmed = text.trim();
		if (!trimmed) throw invalid("The message is empty.", "text");
		if (text.length > MAX_MESSAGE_CHARS) throw invalid("The message is too long.", "text");
		const session = this.#store.getSession(sessionId);
		if (session.archivedAt !== null)
			throw conflict("This session is archived. Restore it first.", undefined, "session-archived");
		// The person stepped in: a full quota of letters again, and a new chain of hand-offs (blueprint 7.1).
		this.#dropReplyQuestions(sessionId);
		this.#held.resume(sessionId);
		this.#store.resetLettersSent(sessionId);
		this.#store.addIntervention(sessionId);
		this.post.resetChain(sessionId);
		if (this.isRunning(sessionId)) return { queued: this.#store.enqueue(sessionId, text) };
		this.#dropLeftovers(sessionId, "Not run: the person sent a new message instead of continuing.");
		const entry = this.#store.appendEntry(sessionId, userEntry(text));
		this.#start(sessionId, { byPerson: true });
		return { entry };
	}

	/** Picks up after a stop, an error or a restart, without a new message. */
	continue(sessionId: string): void {
		const session = this.#store.getSession(sessionId);
		if (this.isRunning(sessionId))
			throw conflict("This session is already working.", undefined, "session-busy");
		if (session.archivedAt !== null)
			throw conflict("This session is archived. Restore it first.", undefined, "session-archived");
		const entries = this.#store.contextEntries(sessionId);
		if (entries.length === 0)
			throw conflict("There is nothing to continue yet.", undefined, "nothing-to-continue");
		this.#dropReplyQuestions(sessionId);
		this.#held.resume(sessionId);
		// Continuing a session that stopped at a spending limit gives it as much room again for today.
		grantMore(this.#store, session, Date.now());
		this.#start(sessionId, { resume: true, byPerson: true });
	}

	/** The person stops a session. Letters that arrive later wait until the person writes or continues. */
	stop(sessionId: string): void {
		const live = this.#live.get(sessionId);
		if (!live) return;
		this.#held.pause(sessionId);
		this.#held.uncap(sessionId);
		live.controller.abort();
	}

	/** Records the person's answer to a permission request or a question, and lets the session go on. */
	answer(approvalId: string, answer: Answer): Approval {
		const approval = this.#store.getApproval(approvalId);
		if (approval.kind === "permission") {
			if (!answer.decision) throw invalid("Choose allow_once, allow_always or deny.", "decision");
			const request = approval.request as { mustConfirm?: boolean; rememberRules?: unknown[] };
			if (answer.decision === "allow_always" && (request.mustConfirm || !request.rememberRules)) {
				throw invalid("This operation can only be allowed once.", "decision");
			}
		} else {
			// The session reads the answer as text; the structured answer stays for the card.
			const settled = settleAnswer(approval.request as QuestionRequest, answer);
			answer = {
				answer: settled.text,
				...(settled.answers ? { answers: settled.answers } : {}),
			};
			if ((approval.request as QuestionRequest).fromReply) {
				// Nothing waits for it: the answer is the person's next message to the session.
				const resolved = this.#store.resolveApproval(approvalId, answer);
				this.send(approval.sessionId, settled.text);
				return resolved;
			}
		}
		const resolved = this.#store.resolveApproval(approvalId, answer);
		this.#store.addIntervention(approval.sessionId);
		const waiter = this.#live.get(approval.sessionId)?.waiters.get(approvalId);
		waiter?.(answer);
		return resolved;
	}

	/** Shortens the context now; the session must not be working. */
	async compactNow(sessionId: string): Promise<void> {
		if (this.isRunning(sessionId))
			throw conflict("Wait until the session stops working.", undefined, "session-busy");
		const session = this.#store.getSession(sessionId);
		const model = this.#requireModel(session);
		// Compacting does not change where the session stands: one that needs review or failed still does.
		const keep = session.status === "needs_review" || session.status === "error";
		const controller = new AbortController();
		const done = this.#context.compact(session, model, controller.signal, true).then(() => {});
		this.#live.set(sessionId, { controller, done, waiters: new Map() });
		try {
			this.#store.setStatus(sessionId, "working");
			await done;
		} finally {
			this.#live.delete(sessionId);
			if (keep) this.#store.setStatus(sessionId, session.status, session.statusDetail);
			else this.#store.setStatus(sessionId, "idle");
			this.#wake(sessionId);
		}
	}

	/**
	 * The person archived a session. Letters waiting for it are dropped, so they do not linger or arrive
	 * when it is restored, and sessions waiting on one of them stop waiting.
	 */
	archived(sessionId: string): void {
		const letters = this.post.mail.dropWaiting(sessionId, "archived");
		for (const letter of letters) this.schedules.finished(letter, "skipped", "archived");
		const dropped = new Set(letters.map((letter) => letter.id));
		for (const waiting of [...this.#waits.values()]) {
			if (waiting.target === sessionId && dropped.has(waiting.letterId)) {
				waiting.resolve({ kind: "archived" });
			}
		}
	}

	/**
	 * Deletes every archived session for good, except one that is still working. Their scratch folders go
	 * too, and the main conversation setting if it named one of them. Returns the deleted sessions' ids.
	 */
	deleteArchived(): string[] {
		const ids = this.#store.deleteArchivedSessions((id) => this.isRunning(id));
		for (const id of ids) {
			rmSync(join(this.#home, "tmp", id), { recursive: true, force: true });
			// Its artifacts' rows went with the session; their files go too.
			rmSync(join(this.#home, "artifacts", id), { recursive: true, force: true });
			this.#readStates.delete(id);
			this.#jobs.get(id)?.stopAll();
			this.#jobs.delete(id);
			this.#held.forget(id);
		}
		if (ids.includes(this.#store.getSetting<string | null>("mainSessionId", null) ?? "")) {
			this.#store.setSetting("mainSessionId", null);
		}
		// Their scheduled tasks went with them.
		if (ids.length > 0) this.schedules.refresh();
		return ids;
	}

	shutdown(): void {
		for (const live of this.#live.values()) live.controller.abort();
		for (const jobs of this.#jobs.values()) jobs.stopAll();
	}

	#start(sessionId: string, options: { resume?: boolean; byPerson?: boolean } = {}): void {
		const controller = new AbortController();
		const live: Live = { controller, done: Promise.resolve(), waiters: new Map() };
		this.#live.set(sessionId, live);
		this.#lastText.delete(sessionId);
		this.#turns.set(sessionId, {
			sent: [],
			read: new Map(),
			byPerson: options.byPerson ?? false,
			started: false,
			run: null,
		});
		live.done = this.#run(sessionId, live, options.resume ?? false)
			.catch((error: unknown) =>
				this.#log(`session ${sessionId}: ${(error as Error).stack ?? error}`),
			)
			.finally(() => {
				this.#live.delete(sessionId);
				// Letters that arrived after the last delivery start the next turn, unless the person stopped this one.
				if (!controller.signal.aborted) this.#wake(sessionId);
			});
	}

	/** The calls a session can make depend on its place: card tools for the main conversation. */
	#roles(session: Session): Roles {
		return {
			canPostCards: this.post.canPostCards(session),
			canOrganize: this.post.canOrganize(session),
		};
	}

	/**
	 * The conversation moves on: calls left over from an interrupted run will not be run later. Calls that
	 * were running when Jig stopped may have finished, so they say that rather than "not run".
	 */
	#dropLeftovers(sessionId: string, reason: string): void {
		this.#store.tx(() => {
			for (const call of this.#store.toolCallsByStatus(sessionId, ["pending", "needs_review"])) {
				const text = call.status === "needs_review" ? RESTARTED : reason;
				this.#finishCall(call, failure(text), "error", Date.now());
			}
		});
	}

	/** Memory folders from the settings, and where the person's own skills and instructions are. */
	#extras(): InstructionExtras {
		return {
			memoryDirs: this.#store.getSetting<string[]>("memoryDirs", []),
			userHome: this.#userHome,
			disabledSkills: this.#store.getSetting<string[]>("disabledSkills", []),
		};
	}

	#requireModel(session: Session): ModelInfo {
		const model = this.#gateway.model(session.provider, session.model);
		if (!model) throw invalid(`${session.provider} has no model ${session.model}.`, "model");
		return model;
	}

	async #run(sessionId: string, live: Live, resume: boolean): Promise<void> {
		const signal = live.controller.signal;
		this.#store.setStatus(sessionId, "working");
		let endStatus: SessionStatus = "idle";
		let detail: string | null = null;
		let capped: string | null = null;
		try {
			let retriedOverflow = false;
			let cutReplies = 0;
			if (resume) await this.#resumeCalls(sessionId, live);
			this.#deliver(sessionId);
			for (let step = 0; ; step++) {
				if (signal.aborted) break;
				if (step >= this.#maxSteps) {
					// Not finished: the person decides whether it goes on.
					endStatus = "error";
					detail = `Stopped after ${this.#maxSteps} steps in one turn.`;
					this.#notice(sessionId, "error", detail, {
						code: "step-limit",
						steps: this.#maxSteps,
					});
					break;
				}
				const session = this.#store.getSession(sessionId);
				const over = reached(this.#store, session, Date.now());
				if (over) {
					capped = this.#budgetNotice(sessionId, "budget-reached", over);
					break;
				}
				const model = this.#requireModel(session);
				const snapshot = this.#context.refresh(session);
				if ((await this.#context.compactIfNeeded(session, model, signal)) === "failed") {
					// Going on would ask for a summary again at every step and end in a context that does not fit.
					if (!signal.aborted) {
						endStatus = "error";
						detail = "The context could not be shortened.";
					}
					break;
				}
				if (signal.aborted) break;

				const final = await this.#ask(this.#store.getSession(sessionId), model, snapshot, signal);
				const message = sanitizeInterrupted(final);
				const entry =
					message.content.length > 0
						? this.#store.appendEntry(sessionId, { role: "assistant", message })
						: null;
				const said = message.content
					.map((block) => (block.type === "text" ? block.text : ""))
					.join("\n")
					.trim();
				if (said) this.#lastText.set(sessionId, said);
				this.#store.addUsage(sessionId, usageTotals(final), contextSize(final));
				for (const mark of crossedWarning(
					this.#store,
					session,
					usageTotals(final).cost,
					Date.now(),
				)) {
					this.#budgetNotice(sessionId, "budget-warning", mark);
				}

				if (final.stopReason === "aborted" || signal.aborted) {
					this.#notice(sessionId, "interrupted", "Stopped by the person.");
					break;
				}
				if (final.stopReason === "error") {
					if (
						!retriedOverflow &&
						this.#gateway.isContextOverflow(final, session.provider, session.model)
					) {
						retriedOverflow = true;
						const shortened = await this.#context.compact(
							this.#store.getSession(sessionId),
							model,
							signal,
							true,
						);
						if (shortened === "done") continue;
						if (signal.aborted) break;
					}
					endStatus = "error";
					detail = final.errorMessage ?? "The model request failed.";
					this.#notice(sessionId, "error", detail, { code: "model-error" });
					break;
				}
				const calls = message.content.filter(
					(block): block is ToolCallBlock => block.type === "toolCall",
				);
				if (calls.length === 0 || !entry) {
					if (final.stopReason === "length") {
						// The reply stopped at the model's output limit, not because the model was done.
						if (cutReplies >= MAX_CUT_REPLIES) {
							endStatus = "error";
							detail = CUT_TOO_OFTEN;
							this.#notice(sessionId, "error", detail, { code: "output-cut" });
							break;
						}
						cutReplies++;
						this.#note(
							sessionId,
							"Your reply was cut off at the output limit. Go on from where it stopped; write long content to a file in parts.",
						);
					}
					// The model is done; anything the person sent meanwhile starts the next round.
					if (this.#deliver(sessionId)) continue;
					break;
				}
				const rows = calls.map((call) =>
					this.#store.createToolCall({
						sessionId,
						messageId: entry.id,
						callId: call.id,
						tool: call.name,
						args: call.arguments,
					}),
				);
				if (final.stopReason === "length") {
					// The reply stopped at the output limit in the middle of its calls. Arguments that were
					// cut short can still read as complete (half a file to write, say), so none of them runs.
					this.#store.tx(() => {
						for (const row of rows) this.#finishCall(row, failure(CUT_CALL), "error", Date.now());
					});
					if (cutReplies >= MAX_CUT_REPLIES) {
						endStatus = "error";
						detail = CUT_TOO_OFTEN;
						this.#notice(sessionId, "error", detail, { code: "output-cut" });
						break;
					}
					cutReplies++;
					this.#deliver(sessionId);
					continue;
				}
				cutReplies = 0;
				await this.#runCalls(sessionId, rows, calls, live);
				this.#remindTodos(sessionId, calls);
				if (signal.aborted) {
					this.#notice(sessionId, "interrupted", "Stopped by the person.");
					break;
				}
				this.#deliver(sessionId);
			}
		} catch (error) {
			endStatus = "error";
			detail =
				error instanceof JigError
					? error.message
					: `Jig hit an internal error: ${(error as Error).message}`;
			if (!(error instanceof JigError))
				this.#log(`session ${sessionId}: ${(error as Error).stack ?? error}`);
			// The code lets the interface explain the problem in the person's language.
			const data: JsonObject =
				error instanceof JigError
					? { code: error.code, ...((error.details ?? {}) as JsonObject) }
					: { code: "internal-error" };
			this.#notice(sessionId, "error", detail, data);
		} finally {
			this.#store.live(sessionId, { type: "draftCleared" });
			if (signal.aborted) endStatus = "idle";
			this.#store.setStatus(sessionId, endStatus, detail);
			this.#store.bumpUnread(sessionId);
			if (capped && !signal.aborted) this.#held.cap(sessionId, localDay(Date.now()));
			else this.#held.uncap(sessionId);
			// To the sessions that wait for this one, a stop at a spending limit is a turn that failed.
			if (capped && !signal.aborted) this.#endTurn(sessionId, "error", capped, false);
			else this.#endTurn(sessionId, endStatus, detail, signal.aborted);
			if (endStatus === "idle" && !signal.aborted && !capped) {
				this.#nameAfterFirstTurn(sessionId).catch((error: unknown) =>
					this.#log(`session ${sessionId}: naming failed: ${(error as Error).message}`),
				);
			}
		}
	}

	/**
	 * A session started from the home page is named after the start of its first message. After its
	 * first turn its own model gives it a short name, once; a name the person or the main conversation
	 * chose is kept (blueprint section 5).
	 */
	async #nameAfterFirstTurn(sessionId: string): Promise<void> {
		const session = this.#store.getSession(sessionId);
		if (!session.options.autoName) return;
		this.#store.updateSession(sessionId, { options: { autoName: false } });
		const model = this.#gateway.model(session.provider, session.model);
		if (!model) return;
		const entries = this.#store.contextEntries(sessionId);
		const asked = entries.find((entry) => entry.role === "user");
		const replied = entries.find((entry) => entry.role === "assistant");
		const textOf = (entry: Entry | undefined) =>
			entry && (entry.role === "user" || entry.role === "assistant")
				? messageText(entry.message).trim()
				: "";
		const first = clip(textOf(asked), 2000);
		if (!first) return;
		const reply = await this.#gateway.stream({
			provider: session.provider,
			model: model.id,
			thinking: "off",
			systemPrompt: NAMING_PROMPT,
			messages: [
				{
					role: "user",
					content: `The person's first message:\n${first}\n\nThe start of the reply:\n${clip(textOf(replied), 500)}`,
					timestamp: Date.now(),
				},
			],
			tools: [],
			signal: new AbortController().signal,
		});
		const now = this.#store.getSession(sessionId);
		this.#store.addUsage(sessionId, usageTotals(reply), now.contextTokens);
		const said = reply.content
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("")
			.trim();
		const name = plainLine(said)
			.replace(/^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》]+$/g, "")
			.replace(/[。.!！?？]+$/, "")
			.trim();
		// Renamed meanwhile, or nothing usable came back: keep the name it has.
		if (reply.stopReason !== "stop" || !name || now.name !== session.name) return;
		let chosen: string;
		try {
			chosen = this.#freeName(validateSessionName(clip(name, 40)));
		} catch {
			return;
		}
		this.#store.updateSession(sessionId, { name: chosen });
		// One turn in, there is little prompt cache to keep: the prompt learns the name without an update.
		const saved = this.#store.getContextSnapshot<ContextSnapshot>(sessionId);
		if (saved) {
			this.#store.setContextSnapshot(sessionId, {
				...saved,
				name: chosen,
				...(saved.told ? { told: { ...saved.told, name: chosen } } : {}),
			});
		}
	}

	async #ask(
		session: Session,
		model: ModelInfo,
		snapshot: ContextSnapshot,
		signal: AbortSignal,
	): Promise<AssistantMessage> {
		const tools = toolsFor(session, this.#allTools(), this.#roles(session));
		let last = 0;
		let pending: ReturnType<typeof setTimeout> | null = null;
		let latest: AssistantMessage | null = null;
		const flush = () => {
			pending = null;
			last = Date.now();
			if (latest) this.#store.live(session.id, { type: "draft", draft: structuredClone(latest) });
		};
		try {
			return await this.#gateway.stream(
				{
					provider: session.provider,
					model: model.id,
					thinking: session.thinking,
					systemPrompt: systemPrompt(session, snapshot, this.#groupName(session)),
					messages: toModelMessages(this.#store.contextEntries(session.id)),
					tools: specs(tools),
					signal,
					sessionId: session.id,
					onRetry: (retry) => {
						this.#log(
							`session ${session.id}: model request failed (${retry.error}); retry ${retry.attempt} of ${retry.of}`,
						);
						this.#store.live(session.id, {
							type: "retrying",
							attempt: retry.attempt,
							of: retry.of,
							seconds: Math.round(retry.delayMs / 1000),
							text: clip(retry.error, 300),
						});
					},
				},
				(draft) => {
					latest = draft;
					if (pending) return;
					const wait = this.#draftInterval - (Date.now() - last);
					if (wait <= 0) flush();
					else pending = setTimeout(flush, wait);
				},
			);
		} finally {
			if (pending) clearTimeout(pending);
		}
	}

	/** Checks every call of a batch first (asking where needed), then runs the allowed ones (prior-art 4.1). */
	async #runCalls(
		sessionId: string,
		rows: ToolCallView[],
		calls: (ToolCallBlock | null)[],
		live: Live,
	): Promise<void> {
		const signal = live.controller.signal;
		const current = this.#store.getSession(sessionId);
		const byName = new Map(
			toolsFor(current, this.#allTools(), this.#roles(current)).map((tool) => [tool.name, tool]),
		);
		const results = new Map<
			string,
			{ result: ToolResult; status: "done" | "error" | "denied"; started: number }
		>();
		const approved: { row: ToolCallView; tool: ToolDefinition }[] = [];

		for (const [index, row] of rows.entries()) {
			const started = Date.now();
			if (signal.aborted) {
				results.set(row.id, {
					result: failure("Not run: stopped by the person."),
					status: "error",
					started,
				});
				continue;
			}
			const tool = byName.get(row.tool);
			const argumentsError = calls[index]?.argumentsError;
			if (!tool) {
				results.set(row.id, {
					result: failure(`There is no tool named ${row.tool}.`),
					status: "error",
					started,
				});
				continue;
			}
			if (argumentsError) {
				results.set(row.id, {
					result: failure(`The arguments were not valid JSON: ${argumentsError}`),
					status: "error",
					started,
				});
				continue;
			}
			const session = this.#store.getSession(sessionId);
			let decision: ReturnType<PermissionEngine["decide"]>;
			try {
				// In the automatic mode the model asks for a person's approval itself, with `confirm`.
				const flagged = (row.args as { confirm?: unknown }).confirm === true;
				const subject = tool.subject(row.args, session, this.#lookup(session));
				decision = this.#permissions.decide(subject, this.#withRunMode(session), flagged);
			} catch (error) {
				const message =
					error instanceof ToolInputError
						? error.message
						: `Could not check this call: ${(error as Error).message}`;
				results.set(row.id, { result: failure(message), status: "error", started });
				continue;
			}
			if (decision.effect === "deny") {
				results.set(row.id, {
					result: failure(`Refused by Jig: ${decision.reason}`),
					status: "denied",
					started,
				});
				continue;
			}
			const run = this.#turns.get(sessionId)?.run;
			if (decision.effect === "ask" && run?.unattended) {
				// Nobody is there to say yes: refuse now rather than wait (blueprint 6.1, item 6).
				run.refused.push(decision.request.summary);
				results.set(row.id, {
					result: {
						...failure(
							`Refused: this turn runs for the scheduled task "${run.name}" and nobody is watching, so nobody can approve it. Do what you can without it; Jig lists what was refused in the report.`,
						),
						detail: { code: "unattended" },
					},
					status: "denied",
					started,
				});
				continue;
			}
			if (decision.effect === "ask") {
				this.#store.updateToolCall(row.id, { status: "waiting" });
				const approval = this.#store.createApproval({
					sessionId,
					toolCallId: row.id,
					kind: "permission",
					// What the call is for and what it would change, so the person decides on what they see.
					request: {
						...decision.request,
						...tool.preview?.(row.args, session, this.#lookup(session)),
					},
				});
				const answer = await this.#waitFor(sessionId, approval.id, live);
				if (!answer || answer.decision === "deny" || answer.decision === undefined) {
					const reason = answer?.reason?.trim();
					const text = !answer
						? "Not run: stopped before the person decided."
						: reason
							? `The person declined this call: ${reason}`
							: "The person declined this call.";
					results.set(row.id, { result: failure(text), status: "denied", started });
					continue;
				}
				if (answer.decision === "allow_always" && decision.request.rememberRules) {
					const current = this.#store.getSession(sessionId);
					this.#store.updateSession(sessionId, {
						rules: [...current.rules, ...decision.request.rememberRules],
					});
				}
			}
			approved.push({ row, tool });
		}

		const execute = async ({ row, tool }: { row: ToolCallView; tool: ToolDefinition }) => {
			const started = Date.now();
			if (signal.aborted) {
				results.set(row.id, {
					result: failure("Not run: stopped by the person."),
					status: "error",
					started,
				});
				return;
			}
			this.#store.updateToolCall(row.id, { status: "running", startedAt: started });
			let result: ToolResult;
			try {
				result = await tool.run(row.args, this.#toolContext(sessionId, row, live));
			} catch (error) {
				result = failure(
					error instanceof ToolInputError
						? error.message
						: `The tool failed: ${(error as Error).message}`,
				);
			}
			results.set(row.id, { result, status: result.isError ? "error" : "done", started });
		};
		if (approved.every(({ tool }) => tool.readOnly)) await Promise.all(approved.map(execute));
		else for (const call of approved) await execute(call);

		// Results go into the transcript in the order the model made the calls.
		this.#store.tx(() => {
			for (const row of rows) {
				const outcome = results.get(row.id) ?? {
					result: failure("Not run."),
					status: "error" as const,
					started: Date.now(),
				};
				this.#finishCall(row, outcome.result, outcome.status, outcome.started);
			}
		});
	}

	#finishCall(
		row: Pick<ToolCallView, "id" | "callId" | "tool" | "sessionId">,
		result: ToolResult,
		status: "done" | "error" | "denied",
		started: number,
	): void {
		const entry = this.#store.appendEntry(row.sessionId, resultEntry(row, result, started));
		this.#store.updateToolCall(row.id, {
			status,
			detail: (result.detail as JsonObject | undefined) ?? null,
			resultMessageId: entry.id,
			finishedAt: Date.now(),
		});
		// A letter this call waited for is now in the transcript, inside the result.
		const handed = this.#handed.get(row.id);
		if (handed) {
			this.#handed.delete(row.id);
			this.post.mail.setLetterEntry(handed, entry.id);
		}
	}

	/** After a restart: calls that were running get an honest "unknown" result; calls that never ran are checked again. */
	async #resumeCalls(sessionId: string, live: Live): Promise<void> {
		const unknown = this.#store.toolCallsByStatus(sessionId, ["needs_review"]);
		this.#store.tx(() => {
			for (const call of unknown) this.#finishCall(call, failure(RESTARTED), "error", Date.now());
		});
		const pending = this.#store.toolCallsByStatus(sessionId, ["pending"]);
		if (pending.length > 0)
			await this.#runCalls(
				sessionId,
				pending,
				pending.map(() => null),
				live,
			);
	}

	#waitFor(sessionId: string, approvalId: string, live: Live): Promise<Answer | null> {
		const signal = live.controller.signal;
		this.#store.setStatus(sessionId, "waiting");
		return new Promise<Answer | null>((resolve) => {
			const finish = (answer: Answer | null) => {
				live.waiters.delete(approvalId);
				signal.removeEventListener("abort", onAbort);
				if (!signal.aborted) this.#store.setStatus(sessionId, "working");
				resolve(answer);
			};
			const onAbort = () => {
				this.#store.cancelApproval(approvalId);
				finish(null);
			};
			live.waiters.set(approvalId, finish);
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	#toolContext(sessionId: string, row: ToolCallView, live: Live): ToolContext {
		const session = this.#store.getSession(sessionId);
		const model = this.#gateway.model(session.provider, session.model);
		let tail = "";
		let timer: ReturnType<typeof setTimeout> | null = null;
		return {
			session,
			signal: live.controller.signal,
			readState: this.#readState(sessionId),
			jobs: this.#jobsFor(sessionId),
			tmpDir: join(this.#home, "tmp", sessionId),
			acceptsImages: model?.input.includes("image") ?? false,
			version: this.#version,
			output: (chunk) => {
				tail = (tail + chunk).slice(-4000);
				if (timer) return;
				timer = setTimeout(() => {
					timer = null;
					this.#store.live(sessionId, { type: "toolOutput", toolCallId: row.id, output: tail });
				}, 200);
			},
			setTodos: (todos) => this.#store.setTodos(sessionId, todos),
			ask: async (request) => {
				const run = this.#turns.get(sessionId)?.run;
				if (run?.unattended) {
					const first = request.questions?.[0]?.question ?? request.question ?? "";
					run.refused.push(`Question: ${clip(plainLine(first), 200)}`);
					throw new ToolInputError(
						`Nobody can answer now: this turn runs for the scheduled task "${run.name}" and nobody is watching. Decide what you can yourself and say in your reply what is still open.`,
					);
				}
				const approval = this.#store.createApproval({
					sessionId,
					toolCallId: row.id,
					kind: "question",
					request,
				});
				const answer = await this.#waitFor(sessionId, approval.id, live);
				if (!answer?.answer) throw new ToolInputError("Stopped before the person answered.");
				return answer.answer;
			},
			mail: this.#mailContext(sessionId, live, row.id),
		};
	}

	// --- letters (blueprint section 7) ---

	#mailContext(sessionId: string, live: Live, callId: string): MailContext {
		return {
			post: this.post,
			canPostCards: this.post.canPostCards(this.#store.getSession(sessionId)),
			send: (out) => {
				const session = this.#store.getSession(sessionId);
				return this.#sent(sessionId, this.post.send({ kind: "session", session }, out));
			},
			wait: (letter) => this.#awaitReply(sessionId, letter, live, callId),
			open: (input) => this.#openChild(this.#store.getSession(sessionId), input),
			finish: (outcome) => this.#store.setOutcome(sessionId, outcome),
			manage: (args) => {
				const by = this.#store.getSession(sessionId);
				if (!this.post.canOrganize(by)) {
					throw conflict(
						"Only the main conversation, or a session the person allowed, can manage Jig.",
						undefined,
						"not-allowed",
					);
				}
				return this.#manager.apply(by, args);
			},
		};
	}

	/** Notes a letter the session sent in this turn, for what Jig sends on its behalf at the end. */
	#sent(sessionId: string, letter: Letter): Letter {
		this.#turns.get(sessionId)?.sent.push(letter);
		return letter;
	}

	/** Notes that the session read a letter in this turn. */
	#read(sessionId: string, letterId: string): void {
		const turn = this.#turns.get(sessionId);
		turn?.read.set(letterId, turn.sent.length);
	}

	/**
	 * A letter is queued: a reply to the letter a session waits on goes to that waiting call; anything
	 * else wakes the recipient (or reaches it between tool calls).
	 */
	#onQueued(letter: Letter): void {
		const waiting = this.#waits.get(letter.toSession);
		if (waiting && letter.fromSession === waiting.target && letter.replyTo === waiting.letterId) {
			this.post.mail.setLetterStatus(letter.id, "delivered", {
				entryId: null,
				deliveredAt: Date.now(),
			});
			this.#handed.set(waiting.callId, letter.id);
			this.#read(letter.toSession, letter.id);
			waiting.resolve({ kind: "letter", letter: this.post.mail.getLetter(letter.id) });
			return;
		}
		this.#wake(letter.toSession);
	}

	/**
	 * Starts a session that has letters waiting, when it is free: idle, or stopped by an error. A session
	 * that needs review (blueprint 7.3) or that the person stopped waits for the person; one that is
	 * working gets its letters between tool calls.
	 */
	#wake(sessionId: string): void {
		if (this.isRunning(sessionId) || this.#held.isPaused(sessionId)) return;
		let session: Session;
		try {
			session = this.#store.getSession(sessionId);
		} catch {
			return;
		}
		if (session.archivedAt !== null) return;
		if (session.status !== "idle" && session.status !== "error") return;
		// At a spending limit letters wait: for the next day, a higher limit, or the person.
		if (reached(this.#store, session, Date.now())) return;
		if (this.post.mail.queuedFor(sessionId).length === 0) return;
		this.#dropLeftovers(sessionId, "Not run: a letter arrived and the conversation moved on.");
		this.#start(sessionId);
	}

	/** Starts every free session with letters waiting: after a restart, and for letters from `jig send`. */
	wakeQueued(): void {
		this.#continueCapped();
		for (const id of this.post.mail.sessionsWithQueued()) this.#wake(id);
	}

	/** Sessions that stopped at a spending limit today go on once the limit was raised or removed. */
	#continueCapped(): void {
		const now = Date.now();
		for (const [id, day] of this.#held.capped()) {
			let session: Session;
			try {
				session = this.#store.getSession(id);
			} catch {
				this.#held.uncap(id);
				continue;
			}
			if (day !== localDay(now) || session.archivedAt !== null || this.#held.isPaused(id)) {
				this.#held.uncap(id);
				continue;
			}
			if (this.isRunning(id) || reached(this.#store, session, now)) continue;
			this.#held.uncap(id);
			this.#start(id, { resume: true });
		}
	}

	/** A line for the person about a daily spending limit; returns the text. */
	#budgetNotice(
		sessionId: string,
		code: "budget-warning" | "budget-reached",
		mark: BudgetMark,
	): string {
		const whose = mark.scope === "session" ? "this session's" : "the shared";
		const amounts = `${dollars(mark.spent)} of ${dollars(mark.limit)}`;
		const text =
			code === "budget-reached"
				? `Stopped: today's spending reached ${whose} daily limit (${amounts}).`
				: `Today's spending passed 80% of ${whose} daily limit (${amounts}).`;
		this.#notice(sessionId, "budget", text, {
			code,
			scope: mark.scope,
			spent: mark.spent,
			limit: mark.limit,
		});
		return text;
	}

	/**
	 * Moves queued letters into the transcript; the model reads them, the interface shows letters. A
	 * scheduled task's letter starts a turn of its own: only a turn that Jig started for waiting letters
	 * takes it, as its first delivery, and one per turn. Its own permission mode and the rule that nobody
	 * is watching then hold for that turn alone.
	 */
	#deliverLetters(sessionId: string, first: boolean): number {
		const turn = this.#turns.get(sessionId);
		let letters = this.post.mail.queuedFor(sessionId);
		let adopted: Letter | null = null;
		if (first && turn && !turn.byPerson) {
			adopted = letters.find((letter) => letter.scheduleId !== null) ?? null;
		}
		letters = letters.filter((letter) => letter.scheduleId === null || letter === adopted);
		if (letters.length === 0) return 0;
		const session = this.#store.getSession(sessionId);
		if (adopted && turn) {
			const schedule = this.schedules.find(adopted.scheduleId as string);
			turn.run = {
				letterId: adopted.id,
				scheduleId: adopted.scheduleId as string,
				name: schedule?.name ?? adopted.fromName,
				mode: schedule?.permissionMode ?? null,
				unattended: true,
				refused: [],
			};
		}
		this.#store.tx(() => {
			for (const letter of letters) {
				let decision = null;
				if (letter.decision !== null) {
					try {
						decision = decisionRef(this.post.mail.cardByNumber(letter.decision));
					} catch {
						decision = null;
					}
				}
				const schedule = this.#scheduleRef(letter);
				const note = letter === adopted && turn?.run ? this.#runNote(session, turn.run) : null;
				const entry = this.#store.appendEntry(sessionId, {
					role: "user",
					message: {
						role: "user",
						content: letterText(letter, decision, schedule, note),
						timestamp: Date.now(),
					},
					letter: letterRef(letter, decision, schedule),
				});
				this.post.mail.setLetterStatus(letter.id, "delivered", {
					entryId: entry.id,
					deliveredAt: Date.now(),
				});
				this.#read(sessionId, letter.id);
			}
		});
		this.post.enterChain(sessionId, letters);
		return letters.length;
	}

	/** The scheduled task a letter belongs to, if it still exists. */
	#scheduleRef(letter: Letter): ScheduleRef | null {
		if (!letter.scheduleId) return null;
		const schedule = this.schedules.find(letter.scheduleId);
		return schedule ? { id: schedule.id, name: schedule.name } : null;
	}

	/** What Jig tells a session about the scheduled run it is starting. */
	#runNote(session: Session, run: ScheduledRun): string {
		const lines = [
			"This is a scheduled run and nobody is watching: Jig refuses calls that need the person's approval, and questions for them.",
		];
		if (run.mode && run.mode !== permissionModeOf(session.options)) {
			lines.push(`For this run: ${PERMISSION_MODE[run.mode]}`);
		}
		const main = this.post.mainSessionId();
		const mainName = main && main !== session.id ? this.post.sessionName(main) : null;
		lines.push(
			mainName
				? `When you finish, Jig sends your last reply to the main conversation (${mainName}) as the report.`
				: "Your last reply is the report.",
		);
		return lines.join(" ");
	}

	/** The session as the permission check sees it: with the scheduled run's own mode, if it has one. */
	#withRunMode(session: Session): Session {
		const mode = this.#turns.get(session.id)?.run?.mode;
		if (!mode) return session;
		return { ...session, options: { ...session.options, permissionMode: mode } };
	}

	/**
	 * The turn is over (blueprint 6.3, item 11). Sessions waiting for this one get its last reply. Every
	 * session whose request it read and has not answered hears how the turn ended: when the turn finished
	 * normally and nothing it asked others is still open, its last reply goes back as the report and the
	 * request is done; after an error, a stop, or while it waits for answers of its own, a notice says so
	 * and the request stays open, so the real result still follows. A task session's opener hears about
	 * every turn (M2 plan, section 6). What is owed is read from the database, so a restart in the middle
	 * loses nothing. Jig's letters never ask for more letters, so this cannot loop.
	 */
	#endTurn(
		sessionId: string,
		status: SessionStatus,
		detail: string | null,
		stopped: boolean,
	): void {
		this.post.resetChain(sessionId);
		const said = this.#lastText.get(sessionId) ?? "";
		this.#lastText.delete(sessionId);
		const turn: Turn = this.#turns.get(sessionId) ?? {
			sent: [],
			read: new Map<string, number>(),
			byPerson: false,
			started: true,
			run: null,
		};
		this.#turns.delete(sessionId);
		const mail = this.post.mail;
		const session = this.#store.getSession(sessionId);
		const failed = stopped || status === "error";
		const open = (letter: Letter) =>
			["queued", "held", "delivered"].includes(mail.getLetter(letter.id).status);

		const sawEnd = new Set<string>();
		for (const [waiter, waiting] of [...this.#waits]) {
			if (waiting.target !== sessionId) continue;
			if (mail.getLetter(waiting.letterId).status === "queued") {
				// A letter not read yet starts the next turn at once: wait for that turn. Not when the
				// person stopped this session or archived it.
				if (session.archivedAt !== null) {
					waiting.resolve({ kind: "archived" });
					continue;
				}
				if (!stopped) continue;
			}
			sawEnd.add(waiter);
			waiting.resolve({ kind: "ended", status, text: said, detail, stopped });
		}

		const owed = new Map<string, Letter[]>();
		for (const request of mail.openRequests(sessionId)) {
			if (!request.fromSession) continue;
			owed.set(request.fromSession, [...(owed.get(request.fromSession) ?? []), request]);
		}
		if (session.parentId && !owed.has(session.parentId)) owed.set(session.parentId, []);

		for (const [requester, requests] of owed) {
			const close = () => {
				for (const request of requests) mail.closeRequest(request.id);
			};
			let target: Session | null = null;
			try {
				target = this.#store.getSession(requester);
			} catch {
				target = null;
			}
			if (!target || target.archivedAt !== null) {
				close();
				continue;
			}
			// What it sent after reading these requests (all of this turn for requests read earlier).
			const since =
				requests.length === 0
					? 0
					: Math.min(...requests.map((request) => turn.read.get(request.id) ?? 0));
			const after = turn.sent.slice(since);
			// A question back or work handed on that is still open: its reply is not the answer yet.
			const asking = after.some((letter) => letter.kind === "request" && open(letter));
			const finished = !failed && !asking;
			// It saw the end through its wait; a normal end answered it.
			if (sawEnd.has(requester)) {
				if (finished) close();
				continue;
			}
			const wrote = after.filter(
				(letter) =>
					letter.toSession === requester &&
					letter.status !== "refused" &&
					letter.status !== "dropped",
			);
			const replyTo = requests.at(-1)?.id ?? null;
			if (finished) {
				// A task session that already reported to its opener in this turn has said it.
				if (requests.length === 0 && wrote.some((letter) => letter.kind === "report")) continue;
				this.#autoLetter(session, requester, {
					kind: "report",
					summary: plainLine(said) || `${session.name} finished without a written reply.`,
					body: said,
					replyTo,
				});
				close();
				continue;
			}
			// Waiting for answers and already in touch with the requester: nothing to add.
			if (!failed && wrote.length > 0) continue;
			const follows = `When ${session.name} goes on, its reply comes to you.`;
			this.#autoLetter(session, requester, {
				kind: "notice",
				summary: stopped
					? `The person stopped ${session.name} before it finished.`
					: status === "error"
						? `${session.name} stopped with an error.`
						: plainLine(said) || `${session.name} is waiting for answers from other sessions.`,
				body: [status === "error" && !stopped ? (detail ?? "") : said, follows]
					.filter(Boolean)
					.join("\n\n"),
				replyTo,
			});
		}
		// Runs of scheduled tasks this turn read end with it; read from the database, so a run that a
		// restart interrupted ends with the turn that continues it.
		let reported = false;
		for (const letter of mail.scheduledRead(sessionId)) {
			const run = turn.run?.letterId === letter.id ? turn.run : null;
			if (this.#finishRun(session, letter, run, { status, detail, said, stopped })) reported = true;
		}
		mail.finishRead(sessionId);
		if (!failed && owed.size === 0 && !reported) this.#askFromReply(session, said);
	}

	/**
	 * A scheduled run ended. Its result goes on the task, and to the main conversation as a report, which
	 * sums it up for the person (M3 plan, decision 3); a run the person stopped needs no report. Returns
	 * whether a report went out.
	 */
	#finishRun(
		session: Session,
		letter: Letter,
		run: ScheduledRun | null,
		end: { status: SessionStatus; detail: string | null; said: string; stopped: boolean },
	): boolean {
		const outcome = end.stopped ? "stopped" : end.status === "error" ? "error" : "done";
		const first = plainLine(end.said);
		this.schedules.finished(
			letter,
			outcome,
			outcome === "error" ? end.detail : outcome === "done" ? first || null : null,
		);
		const main = this.post.mainSessionId();
		if (outcome === "stopped" || !main || main === session.id) return false;
		const name = this.#scheduleRef(letter)?.name ?? letter.fromName;
		const refused = run?.refused ?? [];
		const body = [
			outcome === "error" ? (end.detail ?? "") : "",
			end.said,
			refused.length > 0
				? `Refused because nobody was watching:\n${refused.map((line) => `- ${line}`).join("\n")}`
				: "",
		]
			.filter(Boolean)
			.join("\n\n");
		this.#autoLetter(session, main, {
			kind: outcome === "done" ? "report" : "notice",
			summary:
				outcome === "error"
					? `The scheduled task "${name}" stopped with an error in ${session.name}.`
					: first ||
						`${session.name} finished the scheduled task "${name}" without a written reply.`,
			body,
			replyTo: null,
			schedule: letter.scheduleId,
		});
		return true;
	}

	/**
	 * A code session's last reply that nobody else reads, ending with a question or an offer, becomes a
	 * question in the approval center, and the session shows that it waits. The latest such question
	 * replaces an older one; the person's next message, or continuing, takes it away.
	 */
	#askFromReply(session: Session, said: string): void {
		if (!session.cwd || session.archivedAt !== null || session.id === this.post.mainSessionId()) {
			return;
		}
		const older = this.#replyQuestions(session.id);
		const asked = askedInReply(said);
		if (asked) {
			for (const approval of older) this.#store.cancelApproval(approval.id);
			this.#store.createApproval({
				sessionId: session.id,
				toolCallId: null,
				kind: "question",
				request: { questions: [{ question: asked }], fromReply: true },
			});
		}
		if (asked || older.length > 0) this.#store.setStatus(session.id, "waiting", null);
	}

	#replyQuestions(sessionId: string): Approval[] {
		return this.#store
			.pendingApprovals(sessionId)
			.filter((approval) => (approval.request as QuestionRequest).fromReply === true);
	}

	#dropReplyQuestions(sessionId: string): void {
		for (const approval of this.#replyQuestions(sessionId)) this.#store.cancelApproval(approval.id);
	}

	/** A letter Jig sends on a session's behalf at the end of its turn. */
	#autoLetter(
		session: Session,
		to: string,
		letter: {
			kind: "report" | "notice";
			summary: string;
			body: string;
			replyTo: string | null;
			schedule?: string | null;
		},
	): void {
		try {
			this.post.send(
				{ kind: "session", session },
				{
					to,
					kind: letter.kind,
					summary: clip(letter.summary, SUMMARY_MAX),
					body: clip(letter.body, BODY_MAX),
					replyTo: letter.replyTo,
					auto: true,
					schedule: letter.schedule ?? null,
				},
			);
		} catch (error) {
			if (!(error instanceof JigError)) throw error;
			this.#log(`session ${session.id}: no ${letter.kind} to ${to}: ${error.message}`);
		}
	}

	/**
	 * Waits until the recipient of `letter` replies to it or ends its turn, at most `waitMs`. Refuses to
	 * wait when the recipient already waits for this session, directly or through others: neither could
	 * go on.
	 */
	#awaitReply(sessionId: string, letter: Letter, live: Live, callId: string): Promise<WaitResult> {
		const target = letter.toSession;
		for (let at: string | undefined = target, hops = 0; at && hops < 100; hops++) {
			if (at === sessionId) return Promise.resolve({ kind: "cycle" });
			at = this.#waits.get(at)?.target;
		}
		const current = this.post.mail.getLetter(letter.id);
		if (current.status === "queued" && !this.isRunning(target)) {
			return Promise.resolve({
				kind: "not-running",
				status: this.#store.getSession(target).status,
			});
		}
		const signal = live.controller.signal;
		return new Promise<WaitResult>((resolve) => {
			const finish = (result: WaitResult) => {
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				if (this.#waits.get(sessionId)?.resolve === finish) this.#waits.delete(sessionId);
				resolve(result);
			};
			const onAbort = () => finish({ kind: "stopped" });
			const timer = setTimeout(() => finish({ kind: "timeout" }), this.#waitMs);
			this.#waits.set(sessionId, { target, letterId: letter.id, callId, resolve: finish });
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	/**
	 * Opens a task session for `parent` and sends it the brief as a request (blueprint 6.2, item 8). Its
	 * permissions are never above the parent's: same mode and rules, the parent's folder or one inside it.
	 */
	#openChild(parent: Session, input: OpenInput): { session: Session; letter: Letter } {
		const brief = input.brief.trim();
		if (!brief) throw invalid("The brief is empty.", "brief");
		if ([...brief].length > BODY_MAX) {
			throw invalid(`The brief can be at most ${BODY_MAX} characters.`, "brief");
		}
		// The brief must be able to go out before there is a session to send it to.
		const blocked = this.post.blockedNew(parent);
		if (blocked) {
			throw conflict(`Not opened: ${reasonText(blocked)}.`, undefined, "letter-refused");
		}
		let cwd = parent.cwd;
		if (input.cwd === null) cwd = null;
		else if (input.cwd !== undefined) {
			if (!parent.cwd) {
				throw invalid("You have no working folder, so the new session cannot have one.", "folder");
			}
			const folder = resolveWorkingFolder(
				isAbsolute(input.cwd) ? input.cwd : join(parent.cwd, input.cwd),
			);
			if (!isInside(folder, parent.cwd)) {
				throw invalid("The folder must be your working folder or inside it.", "folder");
			}
			cwd = folder;
		}
		let provider = parent.provider;
		let model = parent.model;
		if (input.provider && input.model) {
			if (!this.#gateway.model(input.provider, input.model)) {
				throw invalid(`${input.provider} has no model ${input.model}.`, "model");
			}
			provider = input.provider;
			model = input.model;
		}
		const session = this.#store.createSession({
			name: this.#freeName(validateSessionName(input.name)),
			kind: "task",
			groupId: parent.groupId,
			cwd,
			provider,
			model,
			thinking: parent.thinking,
			rules: parent.rules,
			options: { permissionMode: permissionModeOf(parent.options) },
			parentId: parent.id,
		});
		const letter = this.#sent(
			parent.id,
			this.post.send(
				{ kind: "session", session: parent },
				{
					to: session.id,
					kind: "request",
					summary: clip(plainLine(brief), SUMMARY_MAX),
					body: brief,
				},
			),
		);
		return { session: this.#store.getSession(session.id), letter };
	}

	/** Session names are unique: "修复登录", then "修复登录 2"… */
	#freeName(base: string): string {
		if (!this.#store.findSessionByName(base)) return base;
		for (let n = 2; ; n++) {
			const name = `${base.slice(0, 55)} ${n}`;
			if (!this.#store.findSessionByName(name)) return name;
		}
	}

	/** The main conversation and the session's opener, as the system prompt names them. */
	#placement(session: Session): Placement {
		const mainId = this.post.mainSessionId();
		const ref = (id: string | null) => {
			if (!id) return null;
			try {
				return { id, name: this.#store.getSession(id).name };
			} catch {
				return null;
			}
		};
		return { main: ref(mainId), parent: ref(session.parentId), team: this.#groupName(session) };
	}

	#readState(sessionId: string): ReadState {
		let state = this.#readStates.get(sessionId);
		if (!state) {
			state = new ReadState();
			this.#readStates.set(sessionId, state);
		}
		return state;
	}

	#jobsFor(sessionId: string): Jobs {
		let jobs = this.#jobs.get(sessionId);
		if (!jobs) {
			jobs = new Jobs((job) => {
				const code = job.finished?.exitCode;
				const note = `Background job ${job.id} (${job.command}) ended${code === null || code === undefined ? "" : ` with exit code ${code}`}. Use shell_job to read its output.`;
				this.#note(sessionId, note);
				this.#notice(sessionId, "job_finished", note, {
					job: job.id,
					command: job.command,
					exitCode: code ?? null,
				});
			});
			this.#jobs.set(sessionId, jobs);
		}
		return jobs;
	}

	#note(sessionId: string, note: string): void {
		const notes = this.#notes.get(sessionId) ?? [];
		notes.push(note);
		this.#notes.set(sessionId, notes);
	}

	/**
	 * Models tend to write a task list once and then forget it, so the list the person sees falls behind.
	 * After many calls without a change while tasks are still open, Jig reminds the model to update it.
	 */
	#remindTodos(sessionId: string, calls: ToolCallBlock[]): void {
		if (calls.some((call) => call.name === "todo")) {
			this.#sinceTodo.delete(sessionId);
			return;
		}
		const count = (this.#sinceTodo.get(sessionId) ?? 0) + calls.length;
		const open = this.#store.getSession(sessionId).todos.some((todo) => todo.status !== "done");
		if (count < TODO_REMINDER_AFTER || !open) {
			this.#sinceTodo.set(sessionId, count);
			return;
		}
		this.#sinceTodo.delete(sessionId);
		this.#note(
			sessionId,
			`Your task list has not changed in the last ${count} tool calls. If it no longer matches the work, update it with the todo tool.`,
		);
	}

	/** Moves Jig's notes, letters and the person's queued messages into the transcript; true if anything arrived. */
	#deliver(sessionId: string): boolean {
		const notes = this.#notes.get(sessionId) ?? [];
		this.#notes.delete(sessionId);
		for (const note of notes) {
			this.#store.appendEntry(sessionId, userEntry(`${JIG_NOTE} ${note}`));
		}
		const turn = this.#turns.get(sessionId);
		const first = turn ? !turn.started : false;
		if (turn) turn.started = true;
		const letters = this.#deliverLetters(sessionId, first);
		const fromPerson = this.#store.deliverQueue(sessionId, userEntry).length;
		if (fromPerson > 0) {
			// What the person wrote starts a new chain of hand-offs, and they are watching now.
			this.post.resetChain(sessionId);
			if (turn?.run) turn.run.unattended = false;
		}
		return letters > 0 || fromPerson > 0 || notes.length > 0;
	}

	/** The name of the session's group, for the system prompt. */
	#groupName(session: Session): string | null {
		if (!session.groupId) return null;
		return this.#store.listGroups().find((group) => group.id === session.groupId)?.name ?? null;
	}

	#notice(sessionId: string, kind: Notice["kind"], text: string, data?: JsonObject): void {
		notice(this.#store, sessionId, kind, text, data);
	}
}
