import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createApp } from "../src/server/http/app.ts";
import { MailStore, type NewLetter } from "../src/server/mail/store.ts";
import type { AssistantMessage } from "../src/shared/messages.ts";
import type { Approval, Card, Entry } from "../src/shared/types.ts";
import {
	flowPath,
	layoutMap,
	MAX_ROWS,
	type MapGroup,
	type MapSession,
	NODE_H,
	NODE_W,
	outline,
	pickFlows,
} from "../web/src/map-layout.ts";
import { blockedSessions, tally, turnProgress, waitingOn } from "../web/src/progress.ts";
import { newStore, sessionInput } from "./helpers/store.ts";

const HOUR = 3600 * 1000;

function setup() {
	const { store } = newStore();
	const mail = new MailStore(store);
	const app = createApp({ store, log: () => {} });
	const letter = (from: string, to: string, extra: Partial<NewLetter> = {}) =>
		mail.addLetter({
			fromKind: "session",
			fromSession: from,
			fromName: "sender",
			toSession: to,
			kind: "notice",
			summary: "hello",
			body: "hello",
			status: "delivered",
			...extra,
		});
	/** Moves a letter into the past. */
	const age = (id: string, ms: number) =>
		store.db.prepare("UPDATE letters SET created_at = created_at - ? WHERE id = ?").run(ms, id);
	return { store, mail, app, letter, age };
}

describe("sessions map: letters", () => {
	test("letters are added up per sender and receiver, the busiest pair first", () => {
		const { store, mail, letter, age } = setup();
		const a = store.createSession(sessionInput("a"));
		const b = store.createSession(sessionInput("b"));
		const c = store.createSession(sessionInput("c"));
		letter(a.id, b.id);
		letter(a.id, b.id);
		letter(a.id, b.id, { status: "held" });
		letter(b.id, a.id);
		letter(c.id, a.id);
		// Letters that never arrived, an old one, and ones no session sent do not count.
		letter(a.id, c.id, { status: "refused" });
		letter(a.id, c.id, { status: "dropped" });
		age(letter(b.id, c.id).id, 25 * HOUR);
		letter("", a.id, { fromKind: "cli", fromSession: null });
		letter("", a.id, { fromKind: "person", fromSession: null, kind: "decision" });
		const flows = mail.letterFlows(Date.now() - 24 * HOUR);
		const rows = flows.map((flow) => [flow.from, flow.to, flow.count]);
		assert.deepEqual(rows[0], [a.id, b.id, 3]);
		assert.deepEqual(
			rows.slice(1).sort(),
			[
				[b.id, a.id, 1],
				[c.id, a.id, 1],
			].sort(),
		);
		assert.ok(flows.every((flow) => typeof flow.lastAt === "number" && flow.lastAt > 0));
		// A longer window brings the old letter back.
		assert.equal(
			mail.letterFlows(Date.now() - 48 * HOUR).some((f) => f.from === b.id && f.to === c.id),
			true,
		);
	});

	test("GET /api/map leaves archived sessions out and reads the same for a paired phone", async () => {
		const { store, app, letter } = setup();
		const a = store.createSession(sessionInput("a"));
		const b = store.createSession(sessionInput("b"));
		const gone = store.createSession(sessionInput("gone"));
		letter(a.id, b.id);
		letter(a.id, gone.id);
		letter(gone.id, b.id);
		const before = Date.now();
		const first = await app.request("/api/map");
		assert.equal(first.status, 200);
		const body = (await first.json()) as {
			since: number;
			letters: { from: string; to: string; count: number; lastAt: number }[];
		};
		assert.ok(Math.abs(body.since - (before - 24 * HOUR)) < 5000);
		assert.equal(body.letters.length, 3);
		assert.deepEqual(Object.keys(body.letters[0] ?? {}).sort(), ["count", "from", "lastAt", "to"]);

		store.updateSession(gone.id, { archived: true });
		const second = (await (await app.request("/api/map")).json()) as typeof body;
		assert.deepEqual(
			second.letters.map((flow) => [flow.from, flow.to, flow.count]),
			[[a.id, b.id, 1]],
		);

		// A phone reads sessions and letters, so it reads the map too.
		const phone = (path: string) =>
			app.fetch(new Request(`http://jig.internal${path}`), { device: "d1" });
		assert.equal((await phone("/api/sessions")).status, 200);
		assert.equal((await phone("/api/letters")).status, 200);
		const asPhone = await phone("/api/map");
		assert.equal(asPhone.status, 200);
		assert.deepEqual(((await asPhone.json()) as typeof body).letters, second.letters);
	});

	test("an empty Jig has an empty map", async () => {
		const { app } = setup();
		const body = (await (await app.request("/api/map")).json()) as { letters: unknown[] };
		assert.deepEqual(body.letters, []);
	});
});

const session = (
	id: string,
	extra: Partial<MapSession> = {},
	createdAt = Number(id.replace(/\D/g, "")) || 0,
): MapSession => ({ id, groupId: null, parentId: null, createdAt, ...extra });

/** Every pair of nodes stands apart, and every session stands below the one that opened it. */
function checkLayout(sessions: MapSession[], groups: MapGroup[], mainId: string | null) {
	const layout = layoutMap(sessions, groups, mainId);
	assert.equal(layout.nodes.length, sessions.length);
	assert.equal(new Set(layout.nodes.map((node) => node.id)).size, sessions.length);
	const at = new Map(layout.nodes.map((node) => [node.id, node]));
	for (const [i, a] of layout.nodes.entries()) {
		assert.ok(a.x >= 0 && a.y >= 0);
		assert.ok(a.x + NODE_W <= layout.width && a.y + NODE_H <= layout.height);
		for (const b of layout.nodes.slice(i + 1)) {
			const apart = Math.abs(a.x - b.x) >= NODE_W || Math.abs(a.y - b.y) >= NODE_H;
			assert.ok(apart, `${a.id} and ${b.id} overlap`);
		}
		if (a.parentId) {
			const parent = at.get(a.parentId);
			assert.ok(parent && parent.y + NODE_H <= a.y, `${a.id} is not below ${a.parentId}`);
			assert.ok(parent && parent.x < a.x, `${a.id} is not indented under ${a.parentId}`);
		}
	}
	// A column's heading does not lie on a session.
	for (const column of layout.columns) {
		for (const node of layout.nodes) {
			const beside = node.x >= column.x + column.width || node.x + NODE_W <= column.x;
			assert.ok(beside || node.y >= column.y + 20 || node.y + NODE_H <= column.y);
		}
	}
	return layout;
}

describe("sessions map: layout", () => {
	const teams: MapGroup[] = [
		{ id: "g2", position: 1 },
		{ id: "g1", position: 0 },
	];

	test("one session", () => {
		const layout = checkLayout([session("s1")], [], null);
		assert.deepEqual(
			layout.columns.map((c) => c.kind),
			["none"],
		);
		const alone = checkLayout([session("s1")], [], "s1");
		assert.deepEqual(alone.columns, []);
		assert.equal(alone.nodes[0]?.depth, 0);
	});

	test("no sessions", () => {
		const layout = layoutMap([], teams, null);
		assert.deepEqual([layout.nodes, layout.columns], [[], []]);
		assert.ok(layout.width > 0 && layout.height > 0);
	});

	test("the main conversation on top, teams in their order, tasks under their opener", () => {
		const sessions = [
			session("s1"),
			session("s2", { groupId: "g1" }),
			session("s3", { groupId: "g2" }),
			session("s4", { groupId: "g1" }),
			session("s5", { parentId: "s2", groupId: "g1" }),
			session("s6", { parentId: "s5" }),
			session("s7", { parentId: "s1" }),
			session("s8"),
			// Its opener is not on the map (archived): it stands on its own.
			session("s9", { parentId: "archived" }),
			// A team that no longer exists counts as no team.
			session("s10", { groupId: "deleted" }),
		];
		const layout = checkLayout(sessions, teams, "s1");
		const at = new Map(layout.nodes.map((node) => [node.id, node]));
		const main = at.get("s1");
		assert.ok(main);
		for (const node of layout.nodes) if (node.id !== "s1") assert.ok(node.y > main.y);
		assert.deepEqual(
			layout.columns.map((column) => [column.kind, column.groupId]),
			[
				["main", null],
				["team", "g1"],
				["team", "g2"],
				["none", null],
			],
		);
		for (let i = 1; i < layout.columns.length; i++) {
			const [left, right] = [layout.columns[i - 1], layout.columns[i]];
			assert.ok(left && right && left.x + left.width <= right.x);
		}
		assert.equal(at.get("s7")?.parentId, "s1");
		assert.equal(at.get("s5")?.parentId, "s2");
		assert.equal(at.get("s6")?.depth, 2);
		assert.equal(at.get("s9")?.parentId, null);
		// s2's tree comes before s4 in the team's column.
		assert.ok((at.get("s6")?.y ?? 0) < (at.get("s4")?.y ?? 0));
		assert.deepEqual(
			outline(sessions, "s1").map((item) => item.id),
			["s1", "s2", "s3", "s4", "s8", "s9", "s10"],
		);
		assert.deepEqual(outline(sessions, "s1")[1]?.children[0]?.children, [
			{ id: "s6", children: [] },
		]);
	});

	test("the same sessions in any order give the same picture", () => {
		const sessions = Array.from({ length: 12 }, (_, i) =>
			session(`s${i + 1}`, {
				groupId: i % 3 === 0 ? "g1" : i % 3 === 1 ? "g2" : null,
				parentId: i >= 6 ? `s${i - 5}` : null,
			}),
		);
		const first = layoutMap(sessions, teams, "s1");
		assert.deepEqual(layoutMap([...sessions].reverse(), [...teams].reverse(), "s1"), first);
		assert.deepEqual(layoutMap(sessions, teams, "s1"), first);
		// Sessions made in the same millisecond are ordered by id.
		const twins = [session("b", {}, 5), session("a", {}, 5)];
		assert.deepEqual(layoutMap(twins, [], null), layoutMap([...twins].reverse(), [], null));
		assert.equal(layoutMap(twins, [], null).nodes[0]?.id, "a");
	});

	test("forty sessions stay apart, and a long column continues beside itself", () => {
		const sessions: MapSession[] = [session("s1")];
		for (let i = 2; i <= 40; i++) {
			sessions.push(
				session(`s${i}`, {
					groupId: i <= 20 ? "g1" : i <= 26 ? "g2" : null,
					parentId: i > 30 ? `s${i - 29}` : i > 26 ? "s1" : null,
				}),
			);
		}
		const layout = checkLayout(sessions, teams, "s1");
		const rows = Math.round((layout.height - 32) / (NODE_H + 10));
		assert.ok(rows <= MAX_ROWS + 6, `the map is ${rows} rows tall`);
		checkLayout(
			Array.from({ length: 8 }, (_, i) => session(`s${i + 1}`, { parentId: i ? "s1" : null })),
			[],
			null,
		);
	});

	test("sessions that opened each other in a loop are still placed once", () => {
		const loop = [session("s1", { parentId: "s2" }), session("s2", { parentId: "s1" })];
		const layout = checkLayout(loop, [], null);
		assert.equal(layout.nodes.length, 2);
	});

	test("letter lines: only between sessions on the map, the busiest first, capped", () => {
		const flows = [
			{ from: "s1", to: "s2", count: 5 },
			{ from: "s2", to: "gone", count: 4 },
			{ from: "s2", to: "s1", count: 2 },
			{ from: "s3", to: "s1", count: 1 },
		];
		const picked = pickFlows(flows, new Set(["s1", "s2", "s3"]), 2);
		assert.deepEqual(picked.drawn, [flows[0], flows[2]]);
		assert.equal(picked.hidden, 1);
		assert.equal(pickFlows(flows, new Set(["s1", "s2", "s3"]), 24).hidden, 0);

		const layout = layoutMap(
			[session("s1"), session("s2"), session("s3", { groupId: "g1" })],
			teams,
			null,
		);
		const at = (id: string) => layout.nodes.find((node) => node.id === id) as never;
		const there = flowPath(at("s1"), at("s2"), layout.nodes);
		const back = flowPath(at("s2"), at("s1"), layout.nodes);
		// The two directions of a pair do not lie on each other.
		assert.notEqual(there.labelY, back.labelY);
		assert.match(flowPath(at("s3"), at("s1"), layout.nodes).d, /^M[\d.]+ [\d.]+ C/);
		for (const path of [there, back]) assert.ok(path.labelX <= layout.width);
	});
});

const assistant = (...tools: string[]): AssistantMessage =>
	({
		role: "assistant",
		content: tools.map((name, i) => ({ type: "toolCall", id: `c${i}`, name, arguments: {} })),
		timestamp: 0,
	}) as unknown as AssistantMessage;

let seq = 0;
const entry = (body: object, createdAt: number): Entry =>
	({ id: `e${++seq}`, sessionId: "s", seq, createdAt, ...body }) as Entry;
const said = (text: string, at: number) =>
	entry({ role: "user", message: { role: "user", content: text, timestamp: at } }, at);
const did = (at: number, ...tools: string[]) =>
	entry({ role: "assistant", message: assistant(...tools) }, at);

describe("session progress", () => {
	test("counts the turn since the person's last message, the reply being written included", () => {
		const entries = [
			said("first", 100),
			did(110, "read", "read", "shell"),
			said("second", 200),
			did(210, "read", "edit"),
			entry({ role: "toolResult", message: {} }, 215),
			// Jig's own notes to the model do not start a turn.
			said("[From Jig, not from the person] a job ended", 220),
			did(230, "grep", "shell", "todo_write"),
		];
		const turn = turnProgress(entries, assistant("shell"));
		assert.equal(turn.startedAt, 200);
		assert.deepEqual(turn.tools, ["read", "edit", "grep", "shell", "todo_write", "shell"]);
		assert.deepEqual(tally(turn.tools), {
			counts: { read: 1, edit: 1, search: 1, shell: 2 },
			others: 1,
		});
		assert.deepEqual(turnProgress(entries.slice(0, 3), null), { startedAt: 200, tools: [] });
	});

	test("a letter starts a turn; after a stop the next work counts from its first step", () => {
		const letter = entry(
			{
				role: "user",
				message: { role: "user", content: "[From Jig, not from the person] letter", timestamp: 1 },
				letter: { id: "l", kind: "request", summary: "", body: "" },
			},
			300,
		);
		assert.equal(turnProgress([said("a", 100), did(110, "read"), letter], null).startedAt, 300);
		const stopped = entry({ role: "notice", notice: { kind: "interrupted", timestamp: 0 } }, 400);
		const resumed = turnProgress(
			[said("a", 100), did(110, "read"), stopped, did(500, "write")],
			null,
		);
		assert.deepEqual(resumed, { startedAt: 500, tools: ["write"] });
		assert.deepEqual(turnProgress([said("a", 100), stopped], null), { startedAt: null, tools: [] });
		// Nothing that starts a turn is loaded: the counts stand, the time is not known.
		assert.deepEqual(turnProgress([did(10, "read")], null), { startedAt: null, tools: ["read"] });
	});

	test("what a session waits for: the oldest of its requests, questions and cards", () => {
		const approval = (id: string, sessionId: string, kind: Approval["kind"], createdAt: number) =>
			({ id, sessionId, kind, status: "pending", createdAt }) as Approval;
		const card = (requestedBy: string | null, createdBy: string | null, createdAt: number) =>
			({ status: "pending", requestedBy, createdBy, createdAt }) as Card;
		const approvals = [
			approval("a1", "s1", "permission", 50),
			approval("a2", "s1", "question", 40),
			{ ...approval("a3", "s1", "question", 1), status: "resolved" } as Approval,
			approval("a4", "s2", "permission", 5),
		];
		const cards = [
			card("s3", "main", 20),
			card(null, "main", 30),
			{ ...card("s1", "main", 2), status: "decided" } as Card,
		];
		assert.deepEqual(waitingOn("s1", approvals, cards), { kind: "question", since: 40, count: 2 });
		assert.deepEqual(waitingOn("s3", approvals, cards), { kind: "decision", since: 20, count: 1 });
		// A card nobody else asked for keeps the session that put it up waiting.
		assert.deepEqual(waitingOn("main", approvals, cards), {
			kind: "decision",
			since: 30,
			count: 1,
		});
		assert.equal(waitingOn("s9", approvals, cards), null);
		assert.deepEqual([...blockedSessions(approvals, cards)].sort(), ["main", "s1", "s2", "s3"]);
	});
});
