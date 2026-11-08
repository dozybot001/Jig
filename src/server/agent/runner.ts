import { join } from "node:path";
import type {
	AssistantMessage,
	EntryBody,
	JsonObject,
	Notice,
	ToolCallBlock,
	ToolResultMessage,
} from "../../shared/messages.ts";
import {
	type Approval,
	type ApprovalDecision,
	type Entry,
	permissionModeOf,
	type QueuedMessage,
	type Session,
	type SessionStatus,
	type ToolCallView,
	type UsageTotals,
} from "../../shared/types.ts";
import { conflict, invalid, JigError } from "../errors.ts";
import type { ModelGateway, ModelInfo } from "../model/gateway.ts";
import type { PermissionEngine } from "../permissions/engine.ts";
import type { Store } from "../store.ts";
import { Jobs } from "../tools/jobs.ts";
import { ReadState } from "../tools/read-state.ts";
import { ALL_TOOLS, specs, toolsFor } from "../tools/registry.ts";
import {
	type ToolContext,
	type ToolDefinition,
	ToolInputError,
	type ToolResult,
} from "../tools/types.ts";
import {
	estimateTokens,
	sanitizeInterrupted,
	toModelMessages,
	transcriptForSummary,
} from "./context.ts";
import {
	APPROVAL_MODE,
	type ContextSnapshot,
	loadInstructions,
	renderInstructions,
	SUMMARY_PROMPT,
	systemPrompt,
	takeSnapshot,
	today,
} from "./prompt.ts";

type Answer = { decision?: ApprovalDecision; reason?: string; answer?: string };

interface Live {
	controller: AbortController;
	done: Promise<void>;
	waiters: Map<string, (answer: Answer | null) => void>;
}

export interface AgentsOptions {
	store: Store;
	gateway: ModelGateway;
	permissions: PermissionEngine;
	home: string;
	version: string;
	tools?: ToolDefinition[];
	log?: (line: string) => void;
	/** How often streaming drafts go to the interface. */
	draftIntervalMs?: number;
}

const KEEP_RECENT_TOKENS = 20_000;
const MAX_COMPACT_AT = 200_000;
const MAX_MESSAGE_CHARS = 100_000;
const MAX_STEPS = 500;
/** After this many tool calls without a change to a task list that still has open tasks, Jig reminds the model. */
const TODO_REMINDER_AFTER = 12;

const userEntry = (text: string): EntryBody => ({
	role: "user",
	message: { role: "user", content: text, timestamp: Date.now() },
});

function totals(message: AssistantMessage): UsageTotals {
	const usage = message.usage;
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		cost: usage.cost.total,
	};
}

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
	readonly #tools: ToolDefinition[];
	readonly #log: (line: string) => void;
	readonly #draftInterval: number;
	readonly #live = new Map<string, Live>();
	readonly #readStates = new Map<string, ReadState>();
	readonly #jobs = new Map<string, Jobs>();
	/** Messages from Jig itself (such as "a background job ended") waiting to reach the model. */
	readonly #notes = new Map<string, string[]>();
	/** Tool calls since each session last changed its task list. */
	readonly #sinceTodo = new Map<string, number>();

	constructor(options: AgentsOptions) {
		this.#store = options.store;
		this.#gateway = options.gateway;
		this.#permissions = options.permissions;
		this.#home = options.home;
		this.#version = options.version;
		this.#tools = options.tools ?? ALL_TOOLS;
		this.#log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
		this.#draftInterval = options.draftIntervalMs ?? 50;
	}

	isRunning(sessionId: string): boolean {
		return this.#live.has(sessionId);
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
		if (this.isRunning(sessionId)) return { queued: this.#store.enqueue(sessionId, text) };
		// The conversation moves on: calls left over from an interrupted run will not be run later.
		this.#store.tx(() => {
			for (const call of this.#store.toolCallsByStatus(sessionId, ["pending", "needs_review"])) {
				this.#finishCall(
					call,
					failure("Not run: the person sent a new message instead of continuing."),
					"error",
					Date.now(),
				);
			}
		});
		const entry = this.#store.appendEntry(sessionId, userEntry(text));
		this.#start(sessionId);
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
		this.#start(sessionId, { resume: true });
	}

	stop(sessionId: string): void {
		this.#live.get(sessionId)?.controller.abort();
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
		} else if (typeof answer.answer !== "string" || !answer.answer.trim()) {
			throw invalid("The answer is empty.", "answer");
		}
		const resolved = this.#store.resolveApproval(approvalId, answer);
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
		const controller = new AbortController();
		const done = this.#compact(session, model, controller.signal, true).then(() => {});
		this.#live.set(sessionId, { controller, done, waiters: new Map() });
		try {
			this.#store.setStatus(sessionId, "working");
			await done;
		} finally {
			this.#live.delete(sessionId);
			this.#store.setStatus(sessionId, "idle");
		}
	}

	shutdown(): void {
		for (const live of this.#live.values()) live.controller.abort();
		for (const jobs of this.#jobs.values()) jobs.stopAll();
	}

	#start(sessionId: string, options: { resume?: boolean } = {}): void {
		const controller = new AbortController();
		const live: Live = { controller, done: Promise.resolve(), waiters: new Map() };
		this.#live.set(sessionId, live);
		live.done = this.#run(sessionId, live, options.resume ?? false)
			.catch((error: unknown) =>
				this.#log(`session ${sessionId}: ${(error as Error).stack ?? error}`),
			)
			.finally(() => this.#live.delete(sessionId));
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
		try {
			let retriedOverflow = false;
			if (resume) await this.#resumeCalls(sessionId, live);
			this.#deliver(sessionId);
			for (let step = 0; step < MAX_STEPS; step++) {
				if (signal.aborted) break;
				const session = this.#store.getSession(sessionId);
				const model = this.#requireModel(session);
				const snapshot = this.#refreshContext(session);
				await this.#compactIfNeeded(session, model, signal);
				if (signal.aborted) break;

				const final = await this.#ask(this.#store.getSession(sessionId), model, snapshot, signal);
				const message = sanitizeInterrupted(final);
				const entry =
					message.content.length > 0
						? this.#store.appendEntry(sessionId, { role: "assistant", message })
						: null;
				this.#store.addUsage(sessionId, totals(final), contextSize(final));

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
						await this.#compact(this.#store.getSession(sessionId), model, signal, true);
						continue;
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
		}
	}

	async #ask(
		session: Session,
		model: ModelInfo,
		snapshot: ContextSnapshot,
		signal: AbortSignal,
	): Promise<AssistantMessage> {
		const tools = toolsFor(session, this.#tools);
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
		const byName = new Map(
			toolsFor(this.#store.getSession(sessionId), this.#tools).map((tool) => [tool.name, tool]),
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
				decision = this.#permissions.decide(tool.subject(row.args, session), session, flagged);
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
			if (decision.effect === "ask") {
				this.#store.updateToolCall(row.id, { status: "waiting" });
				const approval = this.#store.createApproval({
					sessionId,
					toolCallId: row.id,
					kind: "permission",
					request: decision.request,
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
	}

	/** After a restart: calls that were running get an honest "unknown" result; calls that never ran are checked again. */
	async #resumeCalls(sessionId: string, live: Live): Promise<void> {
		const unknown = this.#store.toolCallsByStatus(sessionId, ["needs_review"]);
		this.#store.tx(() => {
			for (const call of unknown) {
				this.#finishCall(
					call,
					failure(
						"Jig restarted while this call was running. It may or may not have finished; check the current state before running it again.",
					),
					"error",
					Date.now(),
				);
			}
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
			ask: async (question, options) => {
				const approval = this.#store.createApproval({
					sessionId,
					toolCallId: row.id,
					kind: "question",
					request: options ? { question, options } : { question },
				});
				const answer = await this.#waitFor(sessionId, approval.id, live);
				if (!answer?.answer) throw new ToolInputError("Stopped before the person answered.");
				return answer.answer;
			},
		};
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

	/** Moves queued messages and Jig's notes into the transcript; true if anything arrived. */
	#deliver(sessionId: string): boolean {
		const notes = this.#notes.get(sessionId) ?? [];
		this.#notes.delete(sessionId);
		for (const note of notes) {
			this.#store.appendEntry(sessionId, userEntry(`[From Jig, not from the person] ${note}`));
		}
		return this.#store.deliverQueue(sessionId, userEntry).length > 0 || notes.length > 0;
	}

	/** The name of the session's group, for the system prompt. */
	#groupName(session: Session): string | null {
		if (!session.groupId) return null;
		return this.#store.listGroups().find((group) => group.id === session.groupId)?.name ?? null;
	}

	#notice(sessionId: string, kind: Notice["kind"], text: string, data?: JsonObject): void {
		this.#store.appendEntry(sessionId, {
			role: "notice",
			notice: data
				? { kind, text, data, timestamp: Date.now() }
				: { kind, text, timestamp: Date.now() },
		});
	}

	/**
	 * Keeps the system prompt stable between turns. The environment and instruction files are saved at the
	 * first turn; if the files or the date change later, an update is appended to the transcript instead of
	 * rewriting the prompt, so the provider's prompt cache stays valid (prior-art 4.5).
	 */
	#refreshContext(session: Session): ContextSnapshot {
		const saved = this.#store.getContextSnapshot<ContextSnapshot>(session.id);
		if (!saved) {
			const snapshot = takeSnapshot(session, this.#home);
			this.#store.setContextSnapshot(session.id, snapshot);
			return snapshot;
		}
		// A session switched between chat and code gets a fresh environment: folder, git status and files.
		if (saved.cwd !== session.cwd) {
			const snapshot = takeSnapshot(session, this.#home);
			this.#store.setContextSnapshot(session.id, snapshot);
			this.#store.appendEntry(session.id, {
				role: "system",
				message: {
					role: "system",
					content: session.cwd
						? `The working folder is now ${session.cwd}. File and shell tools work there.`
						: "This session no longer has a working folder. It is a chat now, without file or shell tools.",
					timestamp: Date.now(),
				},
			});
			return snapshot;
		}
		const updates: string[] = [];
		const date = today();
		if (date !== saved.date) updates.push(`Today's date is now ${date}.`);
		const current = loadInstructions(session.cwd, this.#home);
		const changed = JSON.stringify(current) !== JSON.stringify(saved.instructions);
		if (changed) {
			updates.push(
				current.length > 0
					? `The instruction files changed. These are the current versions; they replace the earlier ones.\n\n${renderInstructions(current, session.cwd)}`
					: "The instruction files were removed.",
			);
		}
		const mode = permissionModeOf(session.options);
		if (saved.permissionMode && saved.permissionMode !== mode) {
			updates.push(`The person changed the approval mode. ${APPROVAL_MODE[mode]}`);
		}
		if (updates.length === 0) {
			if (saved.permissionMode) return saved;
			// A snapshot from before the modes learns the mode quietly; the prompt already states it.
			const next = { ...saved, permissionMode: mode };
			this.#store.setContextSnapshot(session.id, next);
			return next;
		}
		this.#store.appendEntry(session.id, {
			role: "system",
			message: { role: "system", content: updates.join("\n\n"), timestamp: Date.now() },
		});
		const next = { ...saved, date, instructions: current, permissionMode: mode };
		this.#store.setContextSnapshot(session.id, next);
		// The prompt keeps the old snapshot so it stays cacheable; the update above carries the change.
		return { ...saved };
	}

	async #compactIfNeeded(session: Session, model: ModelInfo, signal: AbortSignal): Promise<void> {
		const threshold =
			session.options.compactAt ?? Math.min(Math.floor(model.contextWindow * 0.8), MAX_COMPACT_AT);
		if (session.contextTokens < threshold) return;
		await this.#compact(session, model, signal, false);
	}

	/**
	 * Summarizes older history with the session's own model and keeps roughly the last 20,000 tokens,
	 * starting at a message from the person so a tool call is never separated from its result
	 * (prior-art 4.4). The next prompt is built fresh, with a new environment snapshot.
	 */
	async #compact(
		session: Session,
		model: ModelInfo,
		signal: AbortSignal,
		force: boolean,
	): Promise<boolean> {
		const entries = this.#store.contextEntries(session.id);
		let kept = 0;
		let firstKept: Entry | null = null;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as Entry;
			kept += estimateTokens(entry);
			if (entry.role === "user") {
				if (kept > KEEP_RECENT_TOKENS && firstKept) break;
				firstKept = entry;
			}
		}
		if (!firstKept) return false;
		const older = entries.filter((entry) => entry.seq < (firstKept as Entry).seq);
		if (older.length === 0 || (!force && older.every((entry) => entry.role === "compaction")))
			return false;

		this.#store.live(session.id, { type: "draftCleared" });
		const summary = await this.#gateway.stream({
			provider: session.provider,
			model: model.id,
			thinking: "off",
			systemPrompt: SUMMARY_PROMPT,
			messages: [{ role: "user", content: transcriptForSummary(older), timestamp: Date.now() }],
			tools: [],
			signal,
		});
		this.#store.addUsage(session.id, totals(summary), session.contextTokens);
		const text = summary.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (summary.stopReason !== "stop" || !text) {
			if (!signal.aborted)
				this.#notice(session.id, "error", summary.errorMessage ?? "The summary came back empty.", {
					code: "compact-failed",
				});
			return false;
		}
		const remaining = entries.filter((entry) => entry.seq >= (firstKept as Entry).seq);
		this.#store.tx(() => {
			this.#store.appendEntry(session.id, {
				role: "compaction",
				compaction: {
					summary: text,
					firstKeptSeq: (firstKept as Entry).seq,
					tokensBefore: session.contextTokens,
					timestamp: Date.now(),
				},
			});
			this.#notice(
				session.id,
				"compacted",
				`Earlier history was summarized to save context (${session.contextTokens} tokens before).`,
			);
			this.#store.setContextSnapshot(session.id, takeSnapshot(session, this.#home));
			this.#store.setContextTokens(
				session.id,
				remaining.reduce((sum, entry) => sum + estimateTokens(entry), Math.ceil(text.length / 4)),
			);
		});
		return true;
	}
}
