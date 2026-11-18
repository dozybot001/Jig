import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, test } from "node:test";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { MailStore } from "../src/server/mail/store.ts";
import { dbPath } from "../src/server/paths.ts";
import { ScheduleBook } from "../src/server/schedules.ts";
import { Store } from "../src/server/store.ts";
import { signIn, signInToken } from "../src/sim/client.ts";
import type { World } from "../src/sim/types.ts";
import { loadWorld } from "../src/sim/world.ts";
import { tempDir } from "./helpers/store.ts";

const t = (hour: number, minute = 0) =>
	`2026-11-20T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;

function world(workspace: string): World {
	return {
		format: "yew-sim-world/1",
		date: t(9),
		settings: { language: "zh", mainSession: "统筹" },
		teams: [{ name: "产品" }],
		workspaces: [{ name: "shop", path: workspace }],
		sessions: [
			{
				name: "统筹",
				kind: "standing",
				role: "统筹全局。",
				model: "under-test",
				canOrganize: true,
				canPostCards: true,
				transcript: [
					{ role: "user", text: "这周把首页改版上线。", at: t(8) },
					{ role: "compaction", summary: "之前在聊首页改版。", at: t(8, 10) },
					{
						role: "assistant",
						text: "我分给网站。",
						calls: [{ id: "c1", tool: "list_sessions", args: {} }],
						at: t(8, 20),
					},
					{ role: "toolResult", callId: "c1", tool: "list_sessions", text: "网站", at: t(8, 21) },
				],
			},
			{
				name: "网站",
				kind: "task",
				team: "产品",
				workspace: "shop",
				permissionMode: "default",
				model: { provider: "demo", model: "demo-1" },
				openedBy: "统筹",
				status: { state: "error", error: "服务商限流", since: t(7) },
			},
		],
		letters: [
			{
				key: "ask",
				from: "统筹",
				to: "网站",
				kind: "request",
				summary: "改首页",
				body: "把首屏改了。",
				status: "delivered",
				at: t(8, 30),
			},
			{
				key: "reply",
				from: "网站",
				to: "统筹",
				kind: "report",
				summary: "改好了",
				status: "queued",
				replyTo: "ask",
				at: t(8, 40),
			},
		],
		cards: [
			{
				number: 3,
				by: "统筹",
				requestedBy: "网站",
				title: "上线时间",
				options: [{ label: "今天" }, { label: "周五" }],
				recommended: "周五",
				sessions: ["网站"],
				status: "decided",
				choice: "今天",
				createdAt: t(8, 50),
				decidedAt: t(8, 55),
				deliveredTo: ["网站"],
			},
			{ number: 5, by: "统筹", title: "要不要加广告", status: "pending", createdAt: t(8, 58) },
		],
		schedules: [{ name: "早报", cron: "0 9 * * *", session: "统筹", message: "写早报" }],
	};
}

describe("the evaluation world (docs/sim.md)", () => {
	test("loads sessions, letters, cards and schedules with the world's names, times and states", () => {
		const home = tempDir("yew-sim-");
		const workspace = join(tempDir("yew-sim-work-"), "shop");
		const loaded = loadWorld(world(workspace), {
			home,
			underTest: { provider: "deepseek", model: "deepseek-v4-pro" },
			providers: [
				{
					id: "demo",
					name: "Scripted",
					baseUrl: "http://127.0.0.1:9/v1",
					keyRequired: false,
					models: [{ id: "demo-1", contextWindow: 128_000, maxTokens: 8000 }],
				},
			],
		});
		// No skill: an empty instruction file, so the computer's own is not read instead.
		assert.equal(readFileSync(join(home, "AGENTS.md"), "utf8"), "");

		const db = openDatabase(dbPath(home));
		try {
			const store = new Store(db, new EventBus());
			const mail = new MailStore(store);
			const main = store.getSession(loaded.sessions.统筹 as string);
			const site = store.getSession(loaded.sessions.网站 as string);
			assert.equal(main.provider, "deepseek");
			assert.equal(main.options.canPostCards, true);
			assert.equal(site.parentId, main.id);
			assert.equal(site.cwd, workspace);
			assert.equal(site.status, "error");
			assert.equal(site.lastActivityAt, Date.parse(t(7)));
			assert.equal(store.getSetting("mainSessionId", null), main.id);
			assert.deepEqual(store.getSetting("sim", null), { date: t(9) });

			// Letters keep their keys, states, threads and times.
			const ask = mail.getLetter(loaded.letters.ask as string);
			const reply = mail.getLetter(loaded.letters.reply as string);
			assert.equal(ask.status, "delivered");
			assert.equal(ask.createdAt, Date.parse(t(8, 30)));
			assert.equal(reply.status, "queued");
			assert.equal(reply.replyTo, ask.id);
			assert.equal(reply.threadId, ask.threadId);

			// Cards keep their numbers; the decision is the person's, chosen by label.
			const decided = mail.cardByNumber(3);
			assert.equal(decided.id, loaded.cards["3"]);
			assert.equal(decided.status, "decided");
			assert.equal(decided.choice, 0);
			assert.equal(decided.recommended, 1);
			assert.equal(decided.decidedAt, Date.parse(t(8, 55)));
			assert.deepEqual(decided.sessions, [site.id]);
			assert.equal(mail.cardByNumber(5).status, "pending");

			// Each transcript has its own items, and the letters and decisions it got, in time order.
			const siteEntries = store.allEntries(site.id);
			assert.deepEqual(
				siteEntries.map((entry) => entry.createdAt),
				[Date.parse(t(8, 30)), Date.parse(t(8, 55))],
			);
			const [letterEntry, decisionEntry] = siteEntries;
			assert.equal(letterEntry?.role === "user" && letterEntry.letter?.id, ask.id);
			assert.match(
				decisionEntry?.role === "user" ? String(decisionEntry.message.content) : "",
				/^<decision number="3" from="the person" recorded-by="Yew">/,
			);
			const mainEntries = store.allEntries(main.id);
			assert.deepEqual(
				mainEntries.map((entry) => entry.role),
				["user", "compaction", "assistant", "toolResult"],
			);
			const compaction = mainEntries[1];
			assert.equal(
				compaction?.role === "compaction" && compaction.compaction.firstKeptSeq,
				mainEntries[2]?.seq,
			);

			const [schedule] = new ScheduleBook(store).list();
			assert.equal(schedule?.name, "早报");
			assert.equal(schedule?.sessionId, main.id);
		} finally {
			db.close();
		}
	});

	test("refuses what it cannot load, by name", () => {
		const home = tempDir("yew-sim-");
		const base = world(join(tempDir("yew-sim-work-"), "shop"));
		assert.throws(
			() => loadWorld(base, { home }),
			/"统筹" is the one under test; give its model in options\.underTest/,
		);
		assert.throws(
			() =>
				loadWorld(
					{ ...base, cards: [{ number: 1, title: "x", status: "decided", choice: "没有这项" }] },
					{ home: tempDir("yew-sim-"), underTest: { provider: "deepseek", model: "m" } },
				),
			/card #1\.choice: no option is labelled "没有这项"/,
		);
	});

	test("signs in with the link yew serve prints and keeps the cookie for its requests", async () => {
		const seen: { path: string; cookie?: string; origin?: string }[] = [];
		const server = createServer((req, res) => {
			seen.push({ path: req.url ?? "", cookie: req.headers.cookie, origin: req.headers.origin });
			if (req.url === "/api/auth/exchange") {
				res.writeHead(204, { "set-cookie": "yew_4799=browser-token; HttpOnly; SameSite=Strict" });
				res.end();
			} else {
				res.writeHead(200, { "content-type": "application/json" });
				res.end("{}");
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		try {
			const printed = `Yew Harness 1.5.0 is running at http://127.0.0.1:${port}/\nSign in with this link (works once, within 10 minutes):\nhttp://127.0.0.1:${port}/#t=abc_DEF-123\n`;
			assert.deepEqual(signInToken(printed), { port, token: "abc_DEF-123" });
			const client = await signIn(printed);
			await client.request("POST", "/api/sim/start");
			assert.equal(seen[0]?.path, "/api/auth/exchange");
			assert.equal(seen[1]?.cookie, "yew_4799=browser-token");
			assert.equal(seen[1]?.origin, `http://127.0.0.1:${port}`);
		} finally {
			server.close();
		}
	});
});
