/**
 * Loads an evaluation's world into a fresh data folder before `yew serve` starts (docs/sim.md,
 * section 2): teams, workspaces, sessions with the conversation they already had, letters, decision
 * cards with the person's decisions, and scheduled tasks. Only the controller of an evaluation calls
 * it, in a step of its own; no session has a tool or a route that reaches it, since it writes
 * decisions as the person's.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../server/db/database.ts";
import { EventBus } from "../server/events.ts";
import { newId } from "../server/ids.ts";
import { decisionRef, letterRef, letterText } from "../server/mail/envelope.ts";
import { MailStore } from "../server/mail/store.ts";
import { dbPath, ensureDir } from "../server/paths.ts";
import { ScheduleBook } from "../server/schedules.ts";
import { Store } from "../server/store.ts";
import type { EntryBody } from "../shared/messages.ts";
import type { Card, Letter } from "../shared/types.ts";
import type {
	LoadedWorld,
	LoadOptions,
	World,
	WorldCard,
	WorldLetter,
	WorldSession,
	WorldTranscriptItem,
} from "./types.ts";

export const WORLD_FORMAT = "yew-sim-world/1";

/** The setting that keeps the world's start, for the clock when YEW_SIM_DATE is not set. */
export const SIM_SETTING = "sim";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function time(value: string | undefined, fallback: number, what: string): number {
	if (value === undefined) return fallback;
	const at = Date.parse(value);
	if (Number.isNaN(at)) throw new Error(`${what}: "${value}" is not an ISO 8601 time.`);
	return at;
}

/** Something to put in a session's transcript, at a time; equal times keep the order they came in. */
type Placed = { at: number; order: number; body: (nextSeq: number) => EntryBody };

/** Writes the world into `options.home` and returns the ids it got (docs/sim.md, section 1). */
export function loadWorld(world: World, options: LoadOptions): LoadedWorld {
	if (world.format !== "yew-sim-world/1") {
		throw new Error(
			`The world's format is "${world.format}"; this Yew Harness reads ${WORLD_FORMAT}.`,
		);
	}
	const start = time(world.date, Number.NaN, "date");
	if (Number.isNaN(start)) throw new Error("The world needs a date.");
	const home = ensureDir(options.home);
	// The global instruction file: the skill under test, or an empty one, so that nothing of the
	// computer's own (~/.claude/CLAUDE.md) is read in its place.
	writeFileSync(join(home, "AGENTS.md"), options.skill ?? "");
	const db = openDatabase(dbPath(home));
	try {
		const store = new Store(db, new EventBus());
		const mail = new MailStore(store);
		const run = (sql: string, ...params: (string | number | null)[]) =>
			db.prepare(sql).run(...params);

		for (const provider of options.providers ?? []) store.saveCustomProvider(provider);
		store.setSetting(SIM_SETTING, { date: world.date });
		if (world.settings?.language) store.setSetting("language", world.settings.language);
		if (world.settings?.defaultModel) store.setSetting("defaultModel", world.settings.defaultModel);

		const teams = new Map<string, string>();
		for (const team of world.teams ?? []) teams.set(team.name, store.createGroup(team.name).id);
		const workspaces = new Map<string, string>();
		store.setSetting(
			"workspaces",
			(world.workspaces ?? []).map((workspace) => {
				workspaces.set(workspace.name, workspace.path);
				return { id: newId(), name: workspace.name, path: workspace.path };
			}),
		);

		const sessions = new Map<string, string>();
		const sessionId = (name: string, what: string): string => {
			const id = sessions.get(name);
			if (!id) throw new Error(`${what}: there is no session named "${name}".`);
			return id;
		};
		for (const session of world.sessions) {
			if (sessions.has(session.name)) throw new Error(`Two sessions are named "${session.name}".`);
			sessions.set(session.name, addSession(store, session, workspaces, teams, options, start));
		}
		for (const session of world.sessions) {
			if (!session.openedBy) continue;
			const parent = sessionId(session.openedBy, `session "${session.name}".openedBy`);
			run(
				"UPDATE sessions SET parent_id = ? WHERE id = ?",
				parent,
				sessionId(session.name, "sessions"),
			);
		}
		if (world.settings?.mainSession) {
			store.setSetting(
				"mainSessionId",
				sessionId(world.settings.mainSession, "settings.mainSession"),
			);
		}

		// What goes into each transcript besides its own items: delivered letters and decisions.
		const placed = new Map<string, Placed[]>();
		let order = 0;
		const place = (session: string, item: Omit<Placed, "order">) => {
			const list = placed.get(session) ?? [];
			list.push({ ...item, order: order++ });
			placed.set(session, list);
		};

		const letters = new Map<string, Letter>();
		const byKey = new Map<string, Letter>();
		for (const [index, item] of (world.letters ?? []).entries()) {
			const letter = addLetter(mail, item, index, byKey, sessionId);
			const at = time(item.at, start, `letter ${item.key ?? index + 1}.at`);
			const delivered = item.status === "delivered" || item.status === "done";
			run(
				"UPDATE letters SET created_at = ?, updated_at = ?, delivered_at = ? WHERE id = ?",
				at,
				at,
				delivered ? at : null,
				letter.id,
			);
			if (item.key) byKey.set(item.key, letter);
			letters.set(letter.id, letter);
			if (delivered) {
				place(letter.toSession, {
					at,
					body: () => {
						const decision = letter.decision
							? decisionRef(mail.cardByNumber(letter.decision))
							: null;
						return {
							role: "user",
							message: { role: "user", content: letterText(letter, decision), timestamp: at },
							letter: letterRef(letter, decision),
						};
					},
				});
			}
		}

		const cards: Record<string, string> = {};
		for (const item of [...(world.cards ?? [])].sort((a, b) => a.number - b.number)) {
			const card = addCard(mail, item, sessionId, run, start);
			cards[String(item.number)] = card.id;
			for (const name of item.deliveredTo ?? []) {
				const to = sessionId(name, `card #${item.number}.deliveredTo`);
				const letter = decisionLetter(mail, card, to);
				const at = card.decidedAt ?? card.updatedAt;
				run(
					"UPDATE letters SET created_at = ?, updated_at = ?, delivered_at = ? WHERE id = ?",
					at,
					at,
					at,
					letter.id,
				);
				place(to, {
					at,
					body: () => ({
						role: "user",
						message: {
							role: "user",
							content: letterText(letter, decisionRef(card)),
							timestamp: at,
						},
						letter: letterRef(letter, decisionRef(card)),
					}),
				});
			}
		}

		for (const session of world.sessions) {
			const id = sessionId(session.name, "sessions");
			let last = start;
			for (const item of session.transcript ?? []) {
				last = time(item.at, last, `transcript of "${session.name}"`);
				const at = last;
				place(id, { at, body: (nextSeq) => entryBody(item, at, nextSeq) });
			}
		}
		for (const [id, items] of placed) {
			items.sort((a, b) => a.at - b.at || a.order - b.order);
			for (const item of items) {
				// The entry gets the next sequence number; a compaction keeps what comes after it.
				const seq = db.prepare("SELECT message_seq AS n FROM sessions WHERE id = ?").get(id) as {
					n: number;
				};
				const entry = store.appendEntry(id, item.body(seq.n + 2));
				run("UPDATE messages SET created_at = ? WHERE id = ?", item.at, entry.id);
			}
		}

		const book = new ScheduleBook(store);
		for (const schedule of world.schedules ?? []) {
			book.create(
				{
					name: schedule.name,
					cron: schedule.cron,
					session: sessionId(schedule.session, `schedule "${schedule.name}"`),
					message: schedule.message,
					enabled: schedule.enabled ?? true,
					...(schedule.permissionMode ? { permissionMode: schedule.permissionMode } : {}),
					...(schedule.catchUp !== undefined ? { catchUp: schedule.catchUp } : {}),
				},
				start,
			);
		}

		// The state each session is left in, last, so that loading the transcripts does not change it.
		for (const session of world.sessions) {
			const id = sessionId(session.name, "sessions");
			if (session.status?.state === "error") {
				store.setStatus(id, "error", session.status.error);
				const since = time(session.status.since, start, `session "${session.name}".status.since`);
				run(
					"UPDATE sessions SET updated_at = ?, last_activity_at = ? WHERE id = ?",
					since,
					since,
					id,
				);
			} else if (session.status?.state === "archived") {
				store.updateSession(id, { archived: true });
				run("UPDATE sessions SET archived_at = ? WHERE id = ?", start, id);
			}
		}

		return {
			sessions: Object.fromEntries(sessions),
			letters: Object.fromEntries([...byKey].map(([key, letter]) => [key, letter.id])),
			cards,
		};
	} finally {
		db.close();
	}
}

function addSession(
	store: Store,
	session: WorldSession,
	workspaces: Map<string, string>,
	teams: Map<string, string>,
	options: LoadOptions,
	start: number,
): string {
	const model = session.model === "under-test" ? options.underTest : session.model;
	if (!model) {
		throw new Error(
			`Session "${session.name}" is the one under test; give its model in options.underTest.`,
		);
	}
	const cwd = session.workspace ? workspaces.get(session.workspace) : null;
	if (session.workspace && !cwd) {
		throw new Error(
			`Session "${session.name}": there is no workspace named "${session.workspace}".`,
		);
	}
	if (cwd) mkdirSync(cwd, { recursive: true });
	const groupId = session.team ? teams.get(session.team) : null;
	if (session.team && !groupId) {
		throw new Error(`Session "${session.name}": there is no team named "${session.team}".`);
	}
	const created = store.createSession({
		name: session.name,
		kind: session.kind,
		groupId: groupId ?? null,
		responsibility: session.role ?? "",
		cwd: cwd ?? null,
		provider: model.provider,
		model: model.model,
		...(model.thinking ? { thinking: model.thinking } : {}),
		options: {
			...(session.permissionMode ? { permissionMode: session.permissionMode } : {}),
			...(session.receive ? { receive: session.receive } : {}),
			...(session.canOrganize ? { canOrganize: true } : {}),
			...(session.canPostCards ? { canPostCards: true } : {}),
		},
	});
	store.db
		.prepare(
			"UPDATE sessions SET created_at = ?, updated_at = ?, last_activity_at = ? WHERE id = ?",
		)
		.run(start, start, start, created.id);
	return created.id;
}

function addLetter(
	mail: MailStore,
	item: WorldLetter,
	index: number,
	byKey: Map<string, Letter>,
	sessionId: (name: string, what: string) => string,
): Letter {
	const what = `letter ${item.key ?? index + 1}`;
	const from =
		item.from === "@person"
			? { fromKind: "person" as const, fromSession: null, fromName: "the person" }
			: item.from === "@cli"
				? { fromKind: "cli" as const, fromSession: null, fromName: "yew send" }
				: {
						fromKind: "session" as const,
						fromSession: sessionId(item.from, what),
						fromName: item.from,
					};
	const replyTo = item.replyTo ? byKey.get(item.replyTo) : null;
	if (item.replyTo && !replyTo) {
		throw new Error(`${what}: replies to "${item.replyTo}", which comes later or has no such key.`);
	}
	return mail.addLetter({
		...from,
		toSession: sessionId(item.to, what),
		kind: item.kind,
		summary: item.summary,
		body: item.body ?? "",
		status: item.status,
		...(replyTo ? { threadId: replyTo.threadId, replyTo: replyTo.id } : {}),
		...(item.decision !== undefined ? { decision: item.decision } : {}),
	});
}

function addCard(
	mail: MailStore,
	item: WorldCard,
	sessionId: (name: string, what: string) => string,
	run: (sql: string, ...params: (string | number | null)[]) => unknown,
	start: number,
): Card {
	const what = `card #${item.number}`;
	const options = item.options ?? [];
	const index = (label: string | null | undefined, field: string): number | null => {
		if (label === undefined || label === null) return null;
		const found = options.findIndex((option) => option.label === label);
		if (found < 0) throw new Error(`${what}.${field}: no option is labelled "${label}".`);
		return found;
	};
	const card = mail.addCard(
		item.by ? sessionId(item.by, what) : null,
		item.requestedBy ? sessionId(item.requestedBy, what) : null,
		{
			title: item.title,
			context: item.context ?? "",
			options,
			recommended: index(item.recommended, "recommended"),
			deadline: item.deadline ?? null,
			sessions: (item.sessions ?? []).map((name) => sessionId(name, `${what}.sessions`)),
			undoable: item.undoable ?? false,
			reversible: item.reversible ?? "",
			after: item.after ?? "",
		},
	);
	if (item.status === "decided")
		mail.decideCard(card.id, index(item.choice, "choice"), item.note ?? null);
	else if (item.status === "withdrawn") mail.withdrawCard(card.id, item.withdrawnReason ?? "");
	const created = time(item.createdAt, start, `${what}.createdAt`);
	const decided =
		item.status === "decided" ? time(item.decidedAt, created, `${what}.decidedAt`) : null;
	run(
		"UPDATE cards SET number = ?, created_at = ?, updated_at = ?, decided_at = ? WHERE id = ?",
		item.number,
		created,
		decided ?? created,
		decided,
		card.id,
	);
	return mail.getCard(card.id);
}

/** The letter Yew sends a session with the person's decision, as when the person decides (post.ts). */
function decisionLetter(mail: MailStore, card: Card, to: string): Letter {
	const chosen = card.choice === null ? null : (card.options[card.choice]?.label ?? null);
	return mail.addLetter({
		fromKind: "person",
		fromSession: null,
		fromName: "the person",
		toSession: to,
		kind: "decision",
		summary: `#${card.number} ${card.title}`,
		body: [
			`The person decided #${card.number}: ${card.title}`,
			chosen ? `Chosen: ${chosen}` : "No option chosen; see the note.",
			card.note ? `Note: ${card.note}` : null,
		]
			.filter(Boolean)
			.join("\n"),
		status: "delivered",
		decision: card.number,
	});
}

function entryBody(item: WorldTranscriptItem, timestamp: number, nextSeq: number): EntryBody {
	switch (item.role) {
		case "user":
			return { role: "user", message: { role: "user", content: item.text, timestamp } };
		case "assistant":
			return {
				role: "assistant",
				message: {
					role: "assistant",
					content: [
						...(item.text ? [{ type: "text" as const, text: item.text }] : []),
						...(item.calls ?? []).map((call) => ({
							type: "toolCall" as const,
							id: call.id,
							name: call.tool,
							arguments: call.args as Record<string, never>,
						})),
					],
					api: "sim",
					provider: "sim",
					model: "world",
					usage: ZERO_USAGE,
					stopReason: item.calls?.length ? "toolUse" : "stop",
					timestamp,
				},
			};
		case "toolResult":
			return {
				role: "toolResult",
				message: {
					role: "toolResult",
					toolCallId: item.callId,
					toolName: item.tool,
					content: [{ type: "text", text: item.text }],
					isError: item.isError ?? false,
					timestamp,
				},
			};
		case "compaction":
			// Everything before it is summarized: the model sees the summary, then what follows.
			return {
				role: "compaction",
				compaction: { summary: item.summary, firstKeptSeq: nextSeq, tokensBefore: 0, timestamp },
			};
	}
}
