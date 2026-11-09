import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { migrate } from "../src/server/db/database.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { JigError } from "../src/server/errors.ts";
import { type Outgoing, PostOffice } from "../src/server/mail/post.ts";
import type { Letter, Session } from "../src/shared/types.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

function code(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (error) {
		return error instanceof JigError ? error.code : String(error);
	}
	return undefined;
}

function setup() {
	const { store, events } = newStore();
	const post = new PostOffice(store);
	const queued: Letter[] = [];
	post.setHooks({ queued: (letter) => queued.push(letter) });
	const folder = tempDir("jig-mail-");
	const make = (name: string, extra: Partial<Parameters<typeof store.createSession>[0]> = {}) =>
		store.createSession({
			...sessionInput(name),
			cwd: folder,
			options: { permissionMode: "auto" },
			...extra,
		});
	return { store, events, post, queued, make, folder };
}

const letter = (to: Session, extra: Partial<Outgoing> = {}): Outgoing => ({
	to: to.id,
	kind: "request",
	summary: "请看一下发布清单",
	body: "细节在 docs/release.md",
	...extra,
});

describe("schema", () => {
	test("migration 2 adds letters, cards and the session columns to an existing database", () => {
		const db = new DatabaseSync(join(tempDir(), "jig.db"));
		db.exec(migrations[0] as string);
		db.exec("PRAGMA user_version = 1");
		db.prepare(
			`INSERT INTO sessions (id, name, kind, provider, model, last_activity_at, created_at, updated_at)
			VALUES ('s1', '旧会话', 'standing', 'deepseek', 'deepseek-v4-pro', 1, 1, 1)`,
		).run();
		migrate(db);
		const row = db
			.prepare("SELECT parent_id, outcome, interventions, letters_sent FROM sessions")
			.get() as Record<string, unknown>;
		assert.deepEqual(
			{ ...row },
			{ parent_id: null, outcome: null, interventions: 0, letters_sent: 0 },
		);
		assert.equal(
			(db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
			migrations.length,
		);
		db.prepare("SELECT * FROM letters").all();
		db.prepare("SELECT * FROM cards").all();
		db.close();
	});
});

describe("sending letters", () => {
	test("a letter is stored, counted against the sender's quota and handed on for delivery", () => {
		const { store, events, post, queued, make } = setup();
		const a = make("产品会话");
		const b = make("平台组");
		const sent = post.send({ kind: "session", session: a }, letter(b));
		assert.equal(sent.status, "queued");
		assert.equal(sent.fromName, "产品会话");
		assert.deepEqual(sent.path, [a.id]);
		assert.equal(sent.threadId, sent.id);
		assert.equal(queued.length, 1);
		assert.equal(store.getSession(a.id).lettersSent, 1);
		assert.ok(
			events.some(
				(e) => e.scope === "global" && e.event.type === "letter" && e.event.letter.id === sent.id,
			),
		);
	});

	test("letters go by id only, never to the sender itself or to an archived session", () => {
		const { store, post, make } = setup();
		const a = make("产品会话");
		const b = make("平台组");
		assert.equal(
			code(() => post.send({ kind: "session", session: a }, letter(a))),
			"invalid-request",
		);
		assert.equal(
			code(() => post.send({ kind: "session", session: a }, { ...letter(b), to: "平台组" })),
			"invalid-request",
		);
		store.updateSession(b.id, { archived: true });
		assert.equal(
			code(() => post.send({ kind: "session", session: a }, letter(b))),
			"session-archived",
		);
		assert.equal(
			code(() => post.send({ kind: "session", session: a }, { ...letter(b), summary: "  " })),
			"invalid-request",
		);
	});

	test("the summary is one line; a reply joins the thread of the letter it answers", () => {
		const { post, make } = setup();
		const a = make("产品会话");
		const b = make("平台组");
		const first = post.send(
			{ kind: "session", session: a },
			{ ...letter(b), summary: "第一行\n第二行" },
		);
		assert.equal(first.summary, "第一行 第二行");
		const reply = post.send(
			{ kind: "session", session: b },
			{ to: a.id, kind: "report", summary: "看过了", replyTo: first.id },
		);
		assert.equal(reply.threadId, first.threadId);
		const c = make("法务组");
		assert.equal(
			code(() =>
				post.send(
					{ kind: "session", session: c },
					{ to: a.id, kind: "notice", summary: "x", replyTo: first.id },
				),
			),
			"invalid-request",
		);
	});

	test("the quota stops a session until the person writes again", () => {
		const { store, post, make } = setup();
		const a = make("产品会话", { options: { permissionMode: "auto", letterQuota: 2 } });
		const b = make("平台组");
		post.send({ kind: "session", session: a }, letter(b, { summary: "一" }));
		post.send({ kind: "session", session: a }, letter(b, { summary: "二" }));
		const third = post.send({ kind: "session", session: a }, letter(b, { summary: "三" }));
		assert.equal(third.status, "refused");
		assert.equal(third.statusReason, "quota");
		store.resetLettersSent(a.id);
		assert.equal(
			post.send({ kind: "session", session: a }, letter(b, { summary: "四" })).status,
			"queued",
		);
	});

	test("one session gets at most three letters a minute from another; many sessions can each get one", () => {
		const { post, make } = setup();
		const a = make("总办", { options: { permissionMode: "auto", letterQuota: 50 } });
		const b = make("平台组");
		const send = (to: Session, summary: string) =>
			post.send({ kind: "session", session: a }, letter(to, { summary }));
		for (const summary of ["一", "二", "三"]) assert.equal(send(b, summary).status, "queued");
		const fourth = send(b, "四");
		assert.equal(fourth.status, "refused");
		assert.equal(fourth.statusReason, "rate");
		// The main conversation writing to each session once is fine, up to twenty letters a minute.
		const others = Array.from({ length: 18 }, (_, i) => make(`会话 ${i}`));
		for (const other of others.slice(0, 17))
			assert.equal(send(other, "请报一下进度").status, "queued");
		const burst = send(others[17] as Session, "请报一下进度");
		assert.equal(burst.status, "refused");
		assert.equal(burst.statusReason, "burst");
	});

	test("the same letter twice is dropped; the same words answering another letter are not", () => {
		const { post, make } = setup();
		const a = make("产品会话");
		const b = make("平台组");
		assert.equal(
			post.send({ kind: "session", session: a }, letter(b, { summary: "一" })).status,
			"queued",
		);
		assert.equal(
			post.send({ kind: "session", session: a }, letter(b, { summary: "一" })).statusReason,
			"duplicate",
		);
		const first = post.send({ kind: "session", session: b }, letter(a, { summary: "问题一" }));
		const second = post.send({ kind: "session", session: b }, letter(a, { summary: "问题二" }));
		const reply = (to: Letter) =>
			post.send(
				{ kind: "session", session: a },
				{ to: b.id, kind: "report", summary: "收到，已处理", replyTo: to.id },
			);
		assert.equal(reply(first).status, "queued");
		assert.equal(reply(second).status, "queued");
		assert.equal(reply(second).statusReason, "duplicate");
	});

	test("a chain that keeps coming back to the same session is stopped", () => {
		const { post, make } = setup();
		const a = make("产品会话");
		const b = make("平台组");
		let last = post.send({ kind: "session", session: a }, letter(b, { summary: "0" }));
		const sessions = [b, a];
		let stopped: Letter | null = null;
		for (let hop = 1; hop < 10 && !stopped; hop++) {
			const from = sessions[(hop - 1) % 2] as Session;
			const to = sessions[hop % 2] as Session;
			post.enterChain(from.id, [last]);
			const next = post.send(
				{ kind: "session", session: from },
				letter(to, { summary: String(hop) }),
			);
			post.resetChain(from.id);
			if (next.status === "refused") stopped = next;
			last = next;
		}
		assert.equal(stopped?.statusReason, "loop");
		assert.ok((stopped?.path.length ?? 0) >= 5, "a few rounds of back and forth are allowed");
	});

	test("chains longer than eight letters are refused", () => {
		const { post, make } = setup();
		const sessions = Array.from({ length: 10 }, (_, i) =>
			make(`会话 ${i}`, { options: { permissionMode: "auto", letterQuota: 50 } }),
		);
		let last: Letter | null = null;
		let refused: Letter | null = null;
		for (let i = 0; i < 9 && !refused; i++) {
			const from = sessions[i] as Session;
			if (last) post.enterChain(from.id, [last]);
			last = post.send(
				{ kind: "session", session: from },
				letter(sessions[i + 1] as Session, { summary: `第 ${i} 跳` }),
			);
			if (last.status === "refused") refused = last;
		}
		assert.equal(refused?.statusReason, "hops");
	});

	test("receive policies: refuse, hold, and letters from sessions with fewer permissions are held", () => {
		const { store, post, queued, make } = setup();
		const a = make("产品会话");
		const strict = make("安全组", { options: { permissionMode: "auto", receive: "refuse" } });
		const careful = make("法务组", { options: { permissionMode: "auto", receive: "hold" } });
		const chat = make("聊天", { cwd: null });
		const skip = make("运维", { options: { permissionMode: "skip" } });
		assert.equal(
			post.send({ kind: "session", session: a }, letter(strict)).statusReason,
			"refuse-policy",
		);
		const held = post.send({ kind: "session", session: a }, letter(careful));
		assert.equal(held.status, "held");
		assert.equal(held.statusReason, "hold-policy");
		const low = post.send({ kind: "session", session: chat }, letter(a));
		assert.equal(low.statusReason, "lower-rank");
		assert.equal(
			post.send({ kind: "session", session: a }, letter(skip)).statusReason,
			"lower-rank",
		);
		assert.equal(post.send({ kind: "session", session: skip }, letter(a)).status, "queued");
		// The person decides about held letters in the approval center.
		const before = queued.length;
		assert.equal(post.release(held.id).status, "queued");
		assert.equal(queued.length, before + 1);
		assert.equal(post.refuse(low.id).statusReason, "person-refused");
		assert.equal(
			code(() => post.release(low.id)),
			"already-answered",
		);
		// The main conversation, and parents and children, are never held.
		store.setSetting("mainSessionId", chat.id);
		assert.equal(
			post.send({ kind: "session", session: store.getSession(chat.id) }, letter(skip)).status,
			"queued",
		);
		const child = make("子任务", { cwd: null, parentId: skip.id });
		assert.equal(post.send({ kind: "session", session: child }, letter(skip)).status, "queued");
	});

	test("one answer to the recipient's own request is not held; more letters on that thread are", () => {
		const { post, make } = setup();
		const chat = make("聊天", { cwd: null });
		const code1 = make("产品会话");
		const question = post.send({ kind: "session", session: code1 }, letter(chat));
		const answer = post.send(
			{ kind: "session", session: chat },
			{ to: code1.id, kind: "report", summary: "答复", replyTo: question.id },
		);
		assert.equal(answer.status, "queued");
		const again = post.send(
			{ kind: "session", session: chat },
			{ to: code1.id, kind: "report", summary: "再补充一点", replyTo: question.id },
		);
		assert.equal(again.statusReason, "lower-rank");
		// Replying to a notice is not a way around the hold either.
		const notice = post.send(
			{ kind: "session", session: code1 },
			{ to: chat.id, kind: "notice", summary: "通知一下" },
		);
		const reply = post.send(
			{ kind: "session", session: chat },
			{ to: code1.id, kind: "report", summary: "知道了，顺便……", replyTo: notice.id },
		);
		assert.equal(reply.statusReason, "lower-rank");
	});

	test("a session cannot pass off a decision the person did not make", () => {
		const { post, make } = setup();
		const a = make("产品会话");
		const b = make("平台组");
		assert.equal(
			code(() => post.send({ kind: "session", session: a }, { ...letter(b), kind: "decision" })),
			"invalid-request",
		);
		assert.equal(
			code(() =>
				post.send({ kind: "session", session: a }, { ...letter(b), kind: "decision", decision: 7 }),
			),
			"invalid-request",
		);
	});
});

describe("decision cards", () => {
	const fields = {
		title: "Jig 的许可证用 MIT 还是 Apache-2.0？",
		options: [{ label: "MIT", detail: "最常见" }, { label: "Apache-2.0" }],
		recommended: 0,
		reversible: "开源后不能撤回",
		after: "Jig · 开发改 LICENSE 和 README",
	};

	test("only the main conversation, or a session the person allowed, puts up cards", () => {
		const { store, post, make } = setup();
		const main = make("总办");
		const other = make("产品会话");
		assert.equal(
			code(() => post.postCard(other, fields)),
			"not-allowed",
		);
		store.setSetting("mainSessionId", main.id);
		const card = post.postCard(main, { ...fields, requestedBy: other.id });
		assert.equal(card.number, 1);
		assert.equal(card.requestedBy, other.id);
		assert.equal(card.createdBy, main.id);
		const allowed = store.updateSession(other.id, { options: { canPostCards: true } });
		assert.equal(post.postCard(allowed, fields).number, 2);
		assert.equal(post.postCard(allowed, fields).requestedBy, other.id);
	});

	test("the six points are checked; a new card can replace older ones", () => {
		const { store, post, make } = setup();
		const main = make("总办");
		store.setSetting("mainSessionId", main.id);
		assert.equal(
			code(() => post.postCard(main, { ...fields, reversible: "" })),
			"invalid-request",
		);
		assert.equal(
			code(() => post.postCard(main, { ...fields, recommended: 5 })),
			"invalid-request",
		);
		assert.equal(
			code(() => post.postCard(main, { ...fields, sessions: ["no-such-session"] })),
			"invalid-request",
		);
		const old = post.postCard(main, fields);
		const merged = post.postCard(main, {
			...fields,
			title: "合并后的问题",
			replaces: [old.number],
		});
		assert.equal(post.mail.cardByNumber(old.number).status, "withdrawn");
		assert.match(post.mail.cardByNumber(old.number).withdrawnReason ?? "", /#2/);
		const updated = post.updateCard(main, merged.number, { deadline: "2026-11-12" });
		assert.equal(updated.deadline, "2026-11-12");
		assert.equal(updated.title, "合并后的问题");
		post.withdrawCard(main, merged.number, "不用定了");
		assert.equal(
			code(() => post.updateCard(main, merged.number, { deadline: null })),
			"already-answered",
		);
		assert.deepEqual(post.center().cards, []);
	});

	test("the person's decision goes to the requester and the main conversation, and into the log file", () => {
		const { store, post, queued, make } = setup();
		const main = make("总办");
		const product = make("产品会话");
		store.setSetting("mainSessionId", main.id);
		const log = join(tempDir(), "decisions.md");
		store.setSetting("decisionLog", log);
		store.setSetting("language", "zh");
		store.countLetterSent(product.id);
		const card = post.postCard(main, { ...fields, requestedBy: product.id });
		assert.equal(
			code(() => post.decide(card.id, 9, null)),
			"invalid-request",
		);
		assert.equal(
			code(() => post.decide(card.id, null, " ")),
			"invalid-request",
		);
		const decided = post.decide(card.id, 0, "先用 MIT");
		assert.equal(decided.status, "decided");
		assert.equal(decided.choice, 0);
		const letters = queued.filter((l) => l.kind === "decision");
		assert.deepEqual(letters.map((l) => l.toSession).sort(), [main.id, product.id].sort());
		for (const l of letters) {
			assert.equal(l.fromKind, "person");
			assert.equal(l.decision, card.number);
			assert.match(l.body, /Chosen: MIT/);
			assert.match(l.body, /Note: 先用 MIT/);
		}
		assert.equal(store.getSession(product.id).lettersSent, 0);
		const text = readFileSync(log, "utf8");
		assert.match(text, /^# 决定记录/);
		assert.match(
			text,
			/#1 · Jig 的许可证用 MIT 还是 Apache-2\.0？ · 选择：MIT · 备注：先用 MIT · 提出：产品会话 · 本人在 Jig 里决定/,
		);
		assert.equal(
			code(() => post.decide(card.id, 1, null)),
			"already-answered",
		);
		// A session can now relay the decision, with its number.
		const relay = post.send(
			{ kind: "session", session: main },
			{ to: product.id, kind: "decision", summary: "转达 #1", decision: 1 },
		);
		assert.equal(relay.status, "queued");
	});

	test("the approval center lists pending approvals, cards and held letters", () => {
		const { store, post, make } = setup();
		const main = make("总办");
		const careful = make("法务组", { options: { permissionMode: "auto", receive: "hold" } });
		store.setSetting("mainSessionId", main.id);
		post.postCard(main, fields);
		post.send({ kind: "session", session: main }, letter(careful));
		store.createApproval({
			sessionId: careful.id,
			toolCallId: null,
			kind: "question",
			request: { question: "继续吗？" },
		});
		const center = post.center();
		assert.equal(center.cards.length, 1);
		assert.equal(center.held.length, 1);
		assert.equal(center.approvals.length, 1);
	});
});
