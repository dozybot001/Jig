/**
 * Keeps what the model is sent in bounds while a session works: a system prompt that stays the same
 * between turns, and a transcript that is summarized when it nears the model's context window.
 */
import { type JsonObject, messageText, type Notice } from "../../shared/messages.ts";
import { type Entry, permissionModeOf, type Session } from "../../shared/types.ts";
import type { ModelGateway, ModelInfo } from "../model/gateway.ts";
import type { Store } from "../store.ts";
import { estimateTokens, JIG_NOTE, transcriptForSummary, usageTotals } from "./context.ts";
import {
	type ContextSnapshot,
	type InstructionExtras,
	loadInstructions,
	MAIN_ROLE,
	PERMISSION_MODE,
	type Placement,
	renderInstructions,
	type SessionRef,
	SUMMARY_PROMPT,
	type Told,
	takeSnapshot,
	today,
} from "./prompt.ts";

const KEEP_RECENT_TOKENS = 20_000;
const MAX_COMPACT_AT = 200_000;

/** What an attempt to shorten the context came to. "nothing": there was nothing older to summarize. */
export type Compacted = "done" | "nothing" | "failed";

const MAX_REQUEST_CHARS = 20_000;

/** The context size at which a session's history is summarized. */
function compactAt(session: Session, model: ModelInfo): number {
	return (
		session.options.compactAt ?? Math.min(Math.floor(model.contextWindow * 0.8), MAX_COMPACT_AT)
	);
}

/** A message from the person or a letter, not one of Jig's own notes to the model. */
function isRequest(entry: Entry): boolean {
	return entry.role === "user" && !messageText(entry.message).startsWith(JIG_NOTE);
}

function clipRequest(text: string): string {
	return text.length > MAX_REQUEST_CHARS
		? `${text.slice(0, MAX_REQUEST_CHARS)}\n[cut by Jig: the message was longer]`
		: text;
}

/** What a session is told when the person's main conversation changes. */
function mainUpdate(session: Session, before: SessionRef | null, now: SessionRef | null): string {
	if (now?.id === session.id) return `The person made you their main conversation.\n${MAIN_ROLE}`;
	if (before?.id === session.id) {
		return `You are no longer the person's main conversation.${now ? ` Their main conversation is now "${now.name}" (id ${now.id}).` : ""}`;
	}
	if (now) {
		return `The person's main conversation is now "${now.name}" (id ${now.id}). When something needs the person's decision, send it a request; it puts the question in the approval center.`;
	}
	return "The person has no main conversation now. When something needs the person's decision, ask them with ask_user.";
}

/** A line in the record for the person, not for the model. */
export function notice(
	store: Store,
	sessionId: string,
	kind: Notice["kind"],
	text: string,
	data?: JsonObject,
): void {
	store.appendEntry(sessionId, {
		role: "notice",
		notice: data
			? { kind, text, data, timestamp: Date.now() }
			: { kind, text, timestamp: Date.now() },
	});
}

export interface ContextKeeperOptions {
	store: Store;
	gateway: ModelGateway;
	home: string;
	/** Where the session stands among the others: main conversation, parent, team. */
	placement: (session: Session) => Placement;
	/** Memory folders and where the person's own skills and instructions are. */
	extras: () => InstructionExtras;
}

export class ContextKeeper {
	readonly #store: Store;
	readonly #gateway: ModelGateway;
	readonly #home: string;
	readonly #placement: (session: Session) => Placement;
	readonly #extras: () => InstructionExtras;

	constructor(options: ContextKeeperOptions) {
		this.#store = options.store;
		this.#gateway = options.gateway;
		this.#home = options.home;
		this.#placement = options.placement;
		this.#extras = options.extras;
	}

	/**
	 * Keeps the system prompt the same between turns. The environment and instruction files are saved at the
	 * first turn; when the files, the date, the approval mode or the main conversation change later, an
	 * update is appended to the transcript instead, and the prompt keeps its saved inputs until the next
	 * compaction, so the provider's prompt cache stays valid (prior-art 4.5).
	 */
	refresh(session: Session): ContextSnapshot {
		const placement = this.#placement(session);
		const saved = this.#store.getContextSnapshot<ContextSnapshot>(session.id);
		if (!saved) {
			const snapshot = takeSnapshot(session, this.#home, placement, this.#extras());
			this.#store.setContextSnapshot(session.id, snapshot);
			return snapshot;
		}
		// A session switched between chat and code gets a fresh environment: folder, git status and files.
		if (saved.cwd !== session.cwd) {
			const snapshot = takeSnapshot(session, this.#home, placement, this.#extras());
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
		const mode = permissionModeOf(session.options);
		// Snapshots from before a field existed learn it quietly; the prompt reads the same either way.
		const team = placement.team ?? null;
		const { told: _told, ...prompt } = {
			...saved,
			permissionMode: saved.permissionMode ?? mode,
			main: saved.main === undefined ? null : saved.main,
			parent: saved.parent === undefined ? placement.parent : saved.parent,
			name: saved.name ?? session.name,
			team: saved.team === undefined ? team : saved.team,
		};
		const told: Told = saved.told ?? {
			date: prompt.date,
			instructions: prompt.instructions,
			permissionMode: prompt.permissionMode,
			main: prompt.main,
		};
		const toldName = told.name ?? prompt.name;
		const toldTeam = told.team === undefined ? prompt.team : told.team;
		const updates: string[] = [];
		const date = today();
		if (date !== told.date) updates.push(`Today's date is now ${date}.`);
		const current = loadInstructions(session.cwd, this.#home, this.#extras());
		if (JSON.stringify(current) !== JSON.stringify(told.instructions)) {
			updates.push(
				current.length > 0
					? `The instruction files changed. These are the current versions; they replace the earlier ones.\n\n${renderInstructions(current, session.cwd)}`
					: "The instruction files were removed.",
			);
		}
		if (told.permissionMode !== mode) {
			updates.push(`The person changed the permission mode. ${PERMISSION_MODE[mode]}`);
		}
		const sameMain = (told.main?.id ?? null) === (placement.main?.id ?? null);
		if (!sameMain) updates.push(mainUpdate(session, told.main, placement.main));
		if (session.name !== toldName) updates.push(`Your name is now "${session.name}".`);
		if (team !== toldTeam) {
			updates.push(team ? `You now belong to the team "${team}".` : "You are no longer in a team.");
		}
		if (updates.length > 0) {
			this.#store.appendEntry(session.id, {
				role: "system",
				message: { role: "system", content: updates.join("\n\n"), timestamp: Date.now() },
			});
		}
		const next: ContextSnapshot = {
			...prompt,
			told: {
				date,
				instructions: current,
				permissionMode: mode,
				main: sameMain ? told.main : placement.main,
				name: session.name,
				team,
			},
		};
		if (JSON.stringify(next) !== JSON.stringify(saved)) {
			this.#store.setContextSnapshot(session.id, next);
		}
		return prompt;
	}

	async compactIfNeeded(
		session: Session,
		model: ModelInfo,
		signal: AbortSignal,
	): Promise<Compacted> {
		if (session.contextTokens < compactAt(session, model)) return "nothing";
		return this.compact(session, model, signal, false);
	}

	/**
	 * Summarizes older history with the session's own model and keeps roughly the last 20,000 tokens
	 * (less for a model with a small context window, so that what is kept fits well under the limit).
	 * The kept part starts at a message or at a step of the model, never at a tool result, so a tool
	 * call is never separated from its result (prior-art 4.4). A turn of hundreds of steps after one
	 * message is cut inside the turn; the message being worked on is then carried over word for word,
	 * because a summary only paraphrases it and loses its constraints. The next prompt is built fresh,
	 * with a new environment snapshot.
	 */
	async compact(
		session: Session,
		model: ModelInfo,
		signal: AbortSignal,
		force: boolean,
	): Promise<Compacted> {
		const entries = this.#store.contextEntries(session.id);
		const keep = Math.min(KEEP_RECENT_TOKENS, Math.floor(compactAt(session, model) / 4));
		let kept = 0;
		let firstKept: Entry | null = null;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as Entry;
			kept += estimateTokens(entry);
			if (entry.role === "user" || entry.role === "system" || entry.role === "assistant") {
				if (kept > keep && firstKept) break;
				firstKept = entry;
			}
		}
		if (!firstKept) return "nothing";
		const older = entries.filter((entry) => entry.seq < (firstKept as Entry).seq);
		if (older.length === 0 || (!force && older.every((entry) => entry.role === "compaction")))
			return "nothing";
		const remaining = entries.filter((entry) => entry.seq >= (firstKept as Entry).seq);
		let request: string | undefined;
		if (!remaining.some(isRequest)) {
			const asked = older.findLast(isRequest);
			const before = older.find((entry) => entry.role === "compaction");
			request =
				asked?.role === "user"
					? clipRequest(messageText(asked.message))
					: before?.role === "compaction"
						? before.compaction.request
						: undefined;
		}

		this.#store.live(session.id, { type: "draftCleared" });
		const summary = await this.#gateway.stream({
			provider: session.provider,
			model: model.id,
			thinking: "off",
			systemPrompt: SUMMARY_PROMPT,
			messages: [
				{
					role: "user",
					content: transcriptForSummary(older),
					timestamp: Date.now(),
				},
			],
			tools: [],
			signal,
		});
		this.#store.addUsage(session.id, usageTotals(summary), session.contextTokens);
		const text = summary.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (summary.stopReason !== "stop" || !text) {
			if (!signal.aborted)
				notice(
					this.#store,
					session.id,
					"error",
					summary.errorMessage ?? "The summary came back empty.",
					{
						code: "compact-failed",
					},
				);
			return "failed";
		}
		this.#store.tx(() => {
			this.#store.appendEntry(session.id, {
				role: "compaction",
				compaction: {
					summary: text,
					...(request ? { request } : {}),
					firstKeptSeq: (firstKept as Entry).seq,
					tokensBefore: session.contextTokens,
					timestamp: Date.now(),
				},
			});
			notice(
				this.#store,
				session.id,
				"compacted",
				`Earlier history was summarized to save context (${session.contextTokens} tokens before).`,
			);
			this.#store.setContextSnapshot(
				session.id,
				takeSnapshot(session, this.#home, this.#placement(session), this.#extras()),
			);
			this.#store.setContextTokens(
				session.id,
				remaining.reduce(
					(sum, entry) => sum + estimateTokens(entry),
					Math.ceil((text.length + (request?.length ?? 0)) / 4),
				),
			);
		});
		return "done";
	}
}
