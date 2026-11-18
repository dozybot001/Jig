import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { run } from "../src/cli/run.ts";
import { scheduleCommand } from "../src/cli/schedule.ts";
import { Agents } from "../src/server/agent/runner.ts";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { createApp } from "../src/server/http/app.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { PostOffice } from "../src/server/mail/post.ts";
import { ModelGateway } from "../src/server/model/gateway.ts";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "../src/server/model/testing.ts";
import { dbPath } from "../src/server/paths.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import { ScheduleBook, Scheduler } from "../src/server/schedules.ts";
import { type NewSession, Store } from "../src/server/store.ts";
import { CronError, nextRun, nextRuns, parseCron } from "../src/shared/cron.ts";
import type { Entry, PermissionRequest, Session } from "../src/shared/types.ts";
import { fakeIo } from "./helpers/io.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

/** A response whose JSON body is loosely typed, which is what these assertions want. */
// biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON
type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };

/** A time in this computer's time zone, as cron reads it. */
const at = (y: number, month: number, d: number, h = 0, m = 0) =>
	new Date(y, month - 1, d, h, m).getTime();

describe("cron", () => {
	test("fields take *, lists, ranges and steps; 7 is Sunday too", () => {
		const cron = parseCron("*/15 9-17/4 1,15 * 5-7");
		assert.deepEqual(cron.minutes, [0, 15, 30, 45]);
		assert.deepEqual(cron.hours, [9, 13, 17]);
		assert.deepEqual([...cron.days], [1, 15]);
		assert.deepEqual([...cron.weekdays].sort(), [0, 5, 6]);
		assert.deepEqual(parseCron("5/20 * * * *").minutes, [5, 25, 45]);
	});

	test("the next runs, across days and months; either day field may match when both are set", () => {
		// 2026-11-09 is a Monday.
		const weekdays = parseCron("0 9 * * 1-5");
		assert.equal(nextRun(weekdays, at(2026, 11, 9, 8, 59)), at(2026, 11, 9, 9, 0));
		assert.equal(nextRun(weekdays, at(2026, 11, 9, 9, 0)), at(2026, 11, 10, 9, 0));
		assert.deepEqual(nextRuns(weekdays, at(2026, 11, 13, 10), 2), [
			at(2026, 11, 16, 9),
			at(2026, 11, 17, 9),
		]);
		// The 1st of the month, or any Sunday.
		const either = parseCron("30 7 1 * 0");
		assert.deepEqual(nextRuns(either, at(2026, 11, 26), 3), [
			at(2026, 11, 29, 7, 30),
			at(2026, 12, 1, 7, 30),
			at(2026, 12, 6, 7, 30),
		]);
		assert.equal(nextRun(parseCron("0 0 30 2 *"), at(2026, 11, 9)), null);
	});

	test("a mistake names the field and the part that is wrong", () => {
		for (const [text, field, part] of [
			["61 * * * *", 0, "61"],
			["0 9 * * mon", 4, "mon"],
			["0 9-7 * * *", 1, "9-7"],
			["0 9 * *", null, "0 9 * *"],
		] as const) {
			const error = (() => {
				try {
					parseCron(text);
				} catch (caught) {
					return caught;
				}
				return null;
			})();
			assert.ok(error instanceof CronError, text);
			assert.equal(error.field, field);
			assert.equal(error.part, part);
		}
	});
});

function book() {
	const { store, events } = newStore();
	const post = new PostOffice(store);
	const schedules = new ScheduleBook(store);
	const scheduler = new Scheduler(store, post, schedules, () => {});
	return { store, events, post, schedules, scheduler };
}

describe("scheduled tasks", () => {
	test("a task writes to a standing session; its name, times and session are checked", () => {
		const { store, events, schedules } = book();
		const target = store.createSession(sessionInput("周报"));
		const task = store.createSession({ ...sessionInput("临时任务"), kind: "task" });
		const created = schedules.create(
			{ name: "每周周报", cron: "0  9 * * 1", session: "周报", message: "写本周周报" },
			at(2026, 11, 9, 8),
		);
		assert.equal(created.cron, "0 9 * * 1");
		assert.equal(created.sessionId, target.id);
		assert.equal(created.nextRunAt, at(2026, 11, 9, 9));
		assert.equal(created.permissionMode, null);
		assert.equal(created.catchUp, true);
		assert.ok(events.some((event) => event.scope === "global" && event.event.type === "schedules"));
		for (const [fields, pattern] of [
			[{ name: "每周周报 " }, /already a scheduled task/],
			[{ name: "x", cron: "0 9 * *" }, /five fields/],
			[{ name: "x", cron: "0 0 31 2 *" }, /never run/],
			[{ name: "x", cron: "0 9 * * *", session: task.id }, /task session/],
			[{ name: "x", cron: "0 9 * * *", session: "nobody" }, /no session/],
			[{ name: "x", cron: "0 9 * * *", session: "周报", message: " " }, /Write the letter/],
		] as const) {
			assert.throws(
				() => schedules.create({ cron: "0 9 * * *", session: "周报", message: "m", ...fields }),
				pattern,
			);
		}
		// Off: no next run. On again: the next run counts from now.
		const off = schedules.update(created.id, { enabled: false }, at(2026, 11, 9, 8));
		assert.equal(off.nextRunAt, null);
		const on = schedules.update(created.id, { enabled: true }, at(2026, 11, 10, 8));
		assert.equal(on.nextRunAt, at(2026, 11, 16, 9));
		store.updateSession(target.id, { archived: true });
		assert.throws(() => schedules.update(created.id, { session: "周报" }), /archived/);
	});

	test("on time a run is a letter in the task's name; the next run counts from then", () => {
		const { store, schedules, scheduler, post } = book();
		const target = store.createSession(sessionInput("周报"));
		store.createSession(sessionInput("其他"));
		const created = schedules.create(
			{ name: "每周周报", cron: "0 9 * * 1", session: target.id, message: "写本周周报\n列出进展" },
			at(2026, 11, 9, 8),
		);
		scheduler.tick(at(2026, 11, 9, 8, 59));
		assert.equal(post.mail.listLetters({ limit: 10 }).items.length, 0);
		scheduler.tick(at(2026, 11, 9, 9, 0) + 400);
		const [letter] = post.mail.listLetters({ limit: 10 }).items;
		assert.equal(letter?.fromKind, "yew");
		assert.equal(letter?.fromName, "每周周报");
		assert.equal(letter?.kind, "request");
		assert.equal(letter?.summary, "写本周周报");
		assert.equal(letter?.body, "列出进展");
		assert.equal(letter?.scheduleId, created.id);
		assert.equal(letter?.status, "queued");
		const after = schedules.get(created.id);
		assert.equal(after.lastStatus, "running");
		assert.equal(after.lastLetterId, letter?.id);
		assert.equal(after.nextRunAt, at(2026, 11, 16, 9));
	});

	test("a missed run runs once or is skipped; a run whose last one is still going is skipped", () => {
		const { store, schedules, scheduler, post } = book();
		const target = store.createSession(sessionInput("周报"));
		const skip = schedules.create(
			{ name: "跳过", cron: "0 9 * * *", session: target.id, message: "a", catchUp: false },
			at(2026, 11, 9, 8),
		);
		const catchUp = schedules.create(
			{ name: "补跑", cron: "0 9 * * *", session: target.id, message: "b" },
			at(2026, 11, 9, 8),
		);
		// Yew was not running from 8:30 to 11:00: two days' runs are one run, or none.
		scheduler.tick(at(2026, 11, 10, 11));
		assert.equal(schedules.get(skip.id).lastStatus, "skipped");
		assert.equal(schedules.get(skip.id).lastDetail, "missed");
		assert.equal(schedules.get(skip.id).lastRunAt, at(2026, 11, 9, 9));
		assert.equal(schedules.get(catchUp.id).lastStatus, "running");
		assert.equal(post.mail.listLetters({ limit: 10 }).items.length, 1);
		assert.equal(schedules.get(catchUp.id).nextRunAt, at(2026, 11, 11, 9));
		// Nobody read the letter yet: the next run is skipped, and the open run stays the latest.
		const open = schedules.get(catchUp.id).lastLetterId;
		scheduler.tick(at(2026, 11, 11, 9));
		assert.equal(schedules.get(catchUp.id).lastStatus, "skipped");
		assert.equal(schedules.get(catchUp.id).lastDetail, "busy");
		assert.equal(schedules.get(catchUp.id).lastLetterId, open);
		assert.deepEqual(scheduler.run(catchUp.id), { skipped: "busy" });
		store.updateSession(target.id, { archived: true });
		post.mail.dropWaiting(target.id, "archived");
		assert.deepEqual(scheduler.run(catchUp.id), { skipped: "archived" });
	});
});

type Reply = ReturnType<typeof fauxAssistantMessage>;
type Context = { messages: { role: string; content: unknown }[] };
type Step = Reply | ((context: Context) => Reply | Promise<Reply>);
const textOf = (value: unknown) => JSON.stringify(value);
const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) =>
	fauxAssistantMessage(calls, { stopReason: "toolUse" });

/** Sessions on one scripted model, each answered from its own script (as in letters.test.ts). */
function harness() {
	const faux = fauxProvider();
	const { store } = newStore();
	const gateway = new ModelGateway({
		keys: new MemoryKeyStore({ [faux.provider.id]: "test-key" }),
		version: "0.0.0",
		providers: [faux.provider],
	});
	const home = realpathSync(tempDir("yew-home-"));
	const folder = realpathSync(tempDir("yew-cwd-"));
	const agents = new Agents({
		store,
		gateway,
		permissions: new PermissionEngine(home),
		home,
		version: "0.0.0",
		draftIntervalMs: 0,
		log: () => {},
	});
	const scheduler = new Scheduler(store, agents.post, agents.schedules, () => {});
	const scripts = new Map<string, Step[]>();
	const seen = new Map<string, Context[]>();
	const router = (context: unknown): Reply | Promise<Reply> => {
		const copy = structuredClone(context) as Context;
		const system = String(copy.messages.find((m) => m.role === "system")?.content ?? "");
		const name = /^You are "([^"]+)"/.exec(system)?.[1] ?? "";
		seen.set(name, [...(seen.get(name) ?? []), copy]);
		const step = scripts.get(name)?.shift();
		if (!step) return fauxAssistantMessage(`(${name} has no more replies)`);
		return typeof step === "function" ? step(copy) : step;
	};
	faux.setResponses(Array.from({ length: 100 }, () => router) as never);
	const make = (name: string, extra: Partial<NewSession> = {}): Session =>
		store.createSession({
			name,
			kind: "standing",
			provider: faux.provider.id,
			model: faux.getModel().id,
			cwd: folder,
			thinking: "off",
			options: { permissionMode: "auto" },
			...extra,
		});
	const script = (session: Session, steps: Step[]) => scripts.set(session.name, steps);
	const entries = (session: Session): Entry[] =>
		store.listEntries(session.id, { limit: 200 }).entries;
	const said = (session: Session) =>
		entries(session)
			.filter((entry) => entry.role === "assistant")
			.map((entry) => textOf(entry));
	return { store, agents, scheduler, make, script, seen, entries, said, folder };
}

async function until(check: () => boolean, ms = 4000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe("scheduled runs", () => {
	test("a run is a turn where nobody is watching; its report goes to the main conversation", async () => {
		const { store, agents, scheduler, make, script, entries, said } = harness();
		const main = make("总办");
		const weekly = make("周报");
		store.setSetting("mainSessionId", main.id);
		const task = agents.schedules.create({
			name: "每周周报",
			cron: "0 9 * * 1",
			session: "周报",
			message: "写本周周报",
		});
		script(weekly, [
			toolUse(fauxToolCall("shell", { command: "git push" }, { id: "p1" })),
			fauxAssistantMessage("周报写好了：三件事完成\n\n推送没做成。"),
		]);
		script(main, [fauxAssistantMessage("周报会话写好了本周周报")]);
		scheduler.run(task.id);
		await until(() => said(main).some((text) => text.includes("周报会话写好了本周周报")));

		const [letter] = entries(weekly).filter((entry) => entry.role === "user" && entry.letter);
		assert.ok(letter?.role === "user" && letter.letter);
		assert.equal(letter.letter.from.kind, "yew");
		assert.equal(letter.letter.from.name, "每周周报");
		assert.match(
			textOf(letter),
			/from=\\"the scheduled task '每周周报' \(set up by the person\)\\"/,
		);
		assert.match(textOf(letter), /\[Yew\] This is a scheduled run and nobody is watching/);
		assert.match(textOf(letter), /to the main conversation \(总办\) as the report/);
		// The push needs the person: refused at once, nothing left waiting.
		const [call] = store.toolCallsByStatus(weekly.id, ["denied"]);
		assert.equal(call?.detail?.code, "unattended");
		assert.equal(store.pendingApprovals(weekly.id).length, 0);
		assert.match(textOf(entries(weekly)), /nobody is watching, so nobody can approve it/);

		const after = agents.schedules.get(task.id);
		assert.equal(after.lastStatus, "done");
		assert.equal(after.lastDetail, "周报写好了：三件事完成");
		assert.equal(agents.post.mail.getLetter(after.lastLetterId as string).status, "done");
		const report = entries(main).find(
			(entry) => entry.role === "user" && entry.letter?.kind === "report",
		);
		assert.ok(report?.role === "user" && report.letter);
		assert.equal(report.letter.auto, true);
		assert.deepEqual(report.letter.schedule, { id: task.id, name: "每周周报" });
		assert.equal(report.letter.summary, "周报写好了：三件事完成");
		assert.match(report.letter.body, /Refused because nobody was watching:\n- git push/);
		assert.match(textOf(report), /schedule=\\"每周周报\\"/);
	});

	test("a run waits for the person's turn to end; its permission mode holds for that run alone", async () => {
		const { store, agents, scheduler, make, script, seen, said, folder } = harness();
		const design = make("设计", { options: { permissionMode: "manual" } });
		const task = agents.schedules.create({
			name: "整理",
			cron: "0 18 * * *",
			session: "设计",
			message: "写一份笔记",
			permissionMode: "skip",
		});
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		script(design, [
			async () => {
				await held;
				return fauxAssistantMessage("你的事做完了");
			},
			toolUse(fauxToolCall("write", { path: "notes.md", content: "笔记" }, { id: "w1" })),
			fauxAssistantMessage("笔记写好了"),
		]);
		agents.send(design.id, "先帮我看看");
		await until(() => agents.isRunning(design.id));
		scheduler.run(task.id);
		release();
		await until(() => said(design).some((text) => text.includes("笔记写好了")));
		await until(() => !agents.isRunning(design.id));

		const contexts = seen.get("设计") ?? [];
		assert.doesNotMatch(textOf(contexts[0]), /写一份笔记/, "the person's turn did not get it");
		assert.match(textOf(contexts[1]), /写一份笔记/);
		assert.match(textOf(contexts[1]), /For this run: Permission mode: full access/);
		// Full access for this run: the write ran without asking, though the session asks each time.
		assert.equal(store.pendingApprovals(design.id).length, 0);
		const { readFileSync } = await import("node:fs");
		assert.equal(readFileSync(join(folder, "notes.md"), "utf8"), "笔记");
		assert.equal(agents.schedules.get(task.id).lastStatus, "done");

		// Back to the session's own mode: the next write asks.
		script(design, [
			toolUse(fauxToolCall("write", { path: "more.md", content: "再写" }, { id: "w2" })),
			fauxAssistantMessage("好"),
		]);
		agents.send(design.id, "再写一份");
		await until(() => store.pendingApprovals(design.id).length === 1);
		agents.stop(design.id);
		await until(() => !agents.isRunning(design.id));
	});

	test("the main conversation sets up tasks with manage_yew; a run mode wider than the session's is confirmed", async () => {
		const { store, agents, make, script, said } = harness();
		const main = make("总办", { options: { permissionMode: "skip" } });
		make("设计", { options: { permissionMode: "manual" } });
		store.setSetting("mainSessionId", main.id);
		script(main, [
			toolUse(
				fauxToolCall(
					"manage_yew",
					{
						schedules: [
							{ name: "日报", cron: "0 18 * * 1-5", session: "设计", message: "写今天的日报" },
						],
					},
					{ id: "s1" },
				),
			),
			toolUse(
				fauxToolCall(
					"manage_yew",
					{ schedules: [{ schedule: "日报", permission: "skip", enabled: false }] },
					{ id: "s2" },
				),
			),
			fauxAssistantMessage("日报任务建好了"),
		]);
		agents.send(main.id, "每个工作日 18 点让设计写日报");
		await until(() => store.pendingApprovals(main.id).length === 1);
		const [create] = store.pendingApprovals(main.id);
		const request = create?.request as PermissionRequest;
		assert.equal(request.mustConfirm, false);
		assert.deepEqual(request.changes, [
			{
				action: "create_schedule",
				name: "日报",
				cron: "0 18 * * 1-5",
				session: "设计",
				message: "写今天的日报",
				permission: null,
			},
		]);
		agents.answer(create?.id as string, { decision: "allow_once" });
		await until(() =>
			store.pendingApprovals(main.id).some((approval) => approval.id !== create?.id),
		);
		const [widen] = store.pendingApprovals(main.id);
		const second = widen?.request as PermissionRequest;
		assert.equal(second.mustConfirm, true);
		assert.deepEqual(second.reasons, ["widen-permission"]);
		assert.deepEqual(second.changes, [
			{ action: "change_schedule", schedule: "日报", permission: "skip", enabled: false },
		]);
		agents.answer(widen?.id as string, { decision: "deny" });
		await until(() => said(main).some((text) => text.includes("日报任务建好了")));
		const [task] = agents.schedules.list();
		assert.equal(task?.name, "日报");
		assert.equal(task?.permissionMode, null);
		assert.equal(task?.enabled, true);
	});
});

describe("scheduled tasks over the API and the command line", () => {
	test("list, add, change, run now and remove", async () => {
		const { store } = newStore();
		const post = new PostOffice(store);
		const scheduler = new Scheduler(store, post, new ScheduleBook(store), () => {});
		const app = createApp({ store, log: () => {}, scheduler });
		const call = async (method: string, path: string, body?: unknown): Promise<TestResponse> =>
			app.request(path, {
				method,
				headers: body === undefined ? {} : { "Content-Type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		store.createSession(sessionInput("周报"));
		const bad = await call("POST", "/api/schedules", {
			name: "周报",
			cron: "0 25 * * *",
			session: "周报",
			message: "写周报",
		});
		assert.equal(bad.status, 400);
		assert.equal((await bad.json()).field, "cron");
		const created = await call("POST", "/api/schedules", {
			name: "周报",
			cron: "0 9 * * 1",
			session: "周报",
			message: "写周报",
			permissionMode: "manual",
		});
		assert.equal(created.status, 201);
		const task = await created.json();
		assert.equal(task.permissionMode, "manual");
		const list = await (await call("GET", "/api/schedules")).json();
		assert.deepEqual(
			list.items.map((item: { name: string }) => item.name),
			["周报"],
		);
		const changed = await (
			await call("PATCH", `/api/schedules/${task.id}`, { enabled: false, permissionMode: null })
		).json();
		assert.equal(changed.nextRunAt, null);
		assert.equal(changed.permissionMode, null);
		const ran = await call("POST", `/api/schedules/${task.id}/run`);
		assert.equal(ran.status, 200);
		assert.equal((await ran.json()).letter.fromKind, "yew");
		const again = await call("POST", `/api/schedules/${task.id}/run`);
		assert.equal(again.status, 409);
		assert.equal((await again.json()).type.endsWith("/schedule-busy"), true);
		assert.equal((await call("DELETE", `/api/schedules/${task.id}`)).status, 204);
		assert.equal((await (await call("GET", "/api/schedules")).json()).items.length, 0);
		// The letter stays, without its task.
		assert.equal(post.mail.listLetters({ limit: 5 }).items[0]?.scheduleId, null);
	});

	test("yew schedule list and run", async () => {
		const dir = tempDir("yew-schedule-");
		const db = openDatabase(dbPath(dir));
		const store = new Store(db, new EventBus());
		store.createSession(sessionInput("周报"));
		new ScheduleBook(store).create({
			name: "每周周报",
			cron: "0 9 * * 1",
			session: "周报",
			message: "写周报",
		});
		db.close();
		const cli = async (argv: string[]) => {
			const captured = fakeIo({ env: { YEW_HOME: dir } });
			const code = await run(["schedule", ...argv], captured.io, [scheduleCommand()]);
			return { code, out: captured.stdout.text(), err: captured.stderr.text() };
		};
		const listed = await cli(["list"]);
		assert.equal(listed.code, 0);
		assert.match(
			listed.out,
			/每周周报 {2}0 9 \* \* 1 {2}to 周报\n {2}next: \d{4}-\d\d-\d\d 09:00 {2}last: never run/,
		);
		const json = JSON.parse((await cli(["list", "--json"])).out);
		assert.equal(json[0].session.name, "周报");
		const ran = await cli(["run", "每周周报"]);
		assert.equal(ran.code, 0);
		assert.match(ran.out, /^Sent 每周周报 to 周报 \(letter /);
		assert.match(ran.err, /Yew is not running/);
		const busy = await cli(["run", "每周周报"]);
		assert.equal(busy.code, 1);
		assert.match(busy.err, /not finished yet/);
		assert.equal((await cli(["run", "没有"])).code, 1);
		assert.equal((await cli(["run"])).code, 2);
	});
});
