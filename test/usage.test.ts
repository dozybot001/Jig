import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isDay, lastDays, localDay } from "../src/server/budget.ts";
import { createApp } from "../src/server/http/app.ts";
import { newStore, sessionInput } from "./helpers/store.ts";

const DAY_MS = 24 * 3600 * 1000;
const spend = (cost: number, input = 100) => ({
	input,
	output: 10,
	cacheRead: 5,
	cacheWrite: 2,
	cost,
});

function setup() {
	const { store } = newStore();
	const app = createApp({ store, log: () => {} });
	// biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON
	const get = async (path: string): Promise<{ status: number; body: any }> => {
		const response = await app.request(path);
		return { status: response.status, body: await response.json() };
	};
	return { store, app, get };
}

describe("usage", () => {
	test("days are local calendar days, oldest first, across month ends", () => {
		const noon = new Date(2026, 2, 2, 12).getTime();
		assert.deepEqual(lastDays(noon, 4), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
		assert.deepEqual(lastDays(noon, 1), ["2026-03-02"]);
		assert.equal(isDay("2026-02-28"), true);
		assert.equal(isDay("2026-02-30"), false);
		assert.equal(isDay("2026-2-3"), false);
		assert.equal(isDay("today"), false);
	});

	test("the store adds up each day and lists a day's sessions by cost", () => {
		const { store } = setup();
		const a = store.createSession(sessionInput("a"));
		const b = store.createSession(sessionInput("b"));
		const now = new Date(2026, 10, 16, 12).getTime();
		store.addUsage(a.id, spend(0.4), 0, now);
		store.addUsage(a.id, spend(0.2), 0, now);
		store.addUsage(b.id, spend(1, 300), 0, now);
		store.addUsage(a.id, spend(5), 0, now - 2 * DAY_MS);
		const days = store.usageByDay("2026-11-01", "2026-11-16");
		assert.deepEqual(
			days.map((row) => row.day),
			["2026-11-14", "2026-11-16"],
		);
		const today = days[1];
		assert.ok(today && Math.abs(today.cost - 1.6) < 1e-9);
		assert.deepEqual(
			[today.input, today.output, today.cacheRead, today.cacheWrite],
			[500, 30, 15, 6],
		);
		// A range that ends before a day leaves it out.
		assert.equal(store.usageByDay("2026-11-01", "2026-11-15").length, 1);
		const sessions = store.usageBySession("2026-11-16");
		assert.deepEqual(
			sessions.map((row) => [row.sessionId, row.name, row.archived, row.input]),
			[
				[b.id, "b", false, 300],
				[a.id, "a", false, 200],
			],
		);
		assert.ok(Math.abs((sessions[1]?.cost ?? 0) - 0.6) < 1e-9);
		assert.deepEqual(store.usageBySession("2026-11-15"), []);
		// A deleted session takes its usage with it; an archived one keeps it.
		store.updateSession(b.id, { archived: true });
		assert.equal(store.usageBySession("2026-11-16")[0]?.archived, true);
		store.deleteArchivedSessions();
		assert.deepEqual(
			store.usageBySession("2026-11-16").map((row) => row.sessionId),
			[a.id],
		);
		const left = store.usageByDay("2026-11-16", "2026-11-16")[0];
		assert.ok(left && Math.abs(left.cost - 0.6) < 1e-9);
	});

	test("GET /api/usage returns every day of the range, with zeros where nothing was used", async () => {
		const { store, get } = setup();
		const a = store.createSession(sessionInput("a"));
		const now = Date.now();
		store.addUsage(a.id, spend(0.5), 0, now);
		store.addUsage(a.id, spend(2), 0, now - 3 * DAY_MS);
		// Older than the range.
		store.addUsage(a.id, spend(9), 0, now - 40 * DAY_MS);
		const { status, body } = await get("/api/usage");
		assert.equal(status, 200);
		assert.equal(body.today, localDay(now));
		assert.equal(body.budget, null);
		assert.equal(body.days.length, 30);
		assert.deepEqual(
			body.days.map((row: { day: string }) => row.day),
			lastDays(now, 30),
		);
		assert.deepEqual(body.days[29], {
			day: localDay(now),
			cost: 0.5,
			input: 100,
			output: 10,
			cacheRead: 5,
			cacheWrite: 2,
		});
		const spent = body.days.filter((row: { cost: number }) => row.cost > 0);
		assert.deepEqual(
			spent.map((row: { cost: number }) => row.cost),
			[2, 0.5],
		);
		assert.deepEqual(body.days[0], {
			day: lastDays(now, 30)[0],
			cost: 0,
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});

		store.setSetting("dailyBudget", 5);
		const week = await get("/api/usage?days=7");
		assert.equal(week.body.budget, 5);
		assert.equal(week.body.days.length, 7);
		assert.equal((await get("/api/usage?days=90")).body.days.length, 90);
	});

	test("GET /api/usage refuses a range it does not serve", async () => {
		const { get } = setup();
		for (const days of ["0", "91", "-1", "1.5", "many"]) {
			const { status, body } = await get(`/api/usage?days=${days}`);
			assert.equal(status, 400, days);
			assert.equal(body.field, "days");
			assert.ok(body.requestId);
		}
	});

	test("GET /api/usage/:day lists that day's sessions, the one that cost most first", async () => {
		const { store, get } = setup();
		const a = store.createSession(sessionInput("a"));
		const b = store.createSession(sessionInput("b"));
		const now = Date.now();
		const day = localDay(now);
		store.addUsage(a.id, spend(0.25), 0, now);
		store.addUsage(b.id, spend(0.75, 400), 0, now);
		const { status, body } = await get(`/api/usage/${day}`);
		assert.equal(status, 200);
		assert.equal(body.day, day);
		assert.equal(body.total, 1);
		assert.deepEqual(body.sessions, [
			{
				sessionId: b.id,
				name: "b",
				archived: false,
				cost: 0.75,
				input: 400,
				output: 10,
				cacheRead: 5,
				cacheWrite: 2,
			},
			{
				sessionId: a.id,
				name: "a",
				archived: false,
				cost: 0.25,
				input: 100,
				output: 10,
				cacheRead: 5,
				cacheWrite: 2,
			},
		]);
		const empty = await get("/api/usage/2001-01-01");
		assert.deepEqual(empty.body, { day: "2001-01-01", total: 0, sessions: [] });
		for (const bad of ["2026-13-01", "2026-02-30", "20260101", "yesterday"]) {
			const refused = await get(`/api/usage/${bad}`);
			assert.equal(refused.status, 400, bad);
			assert.equal(refused.body.field, "day");
		}
		// The limits' own route still answers under the same prefix.
		const today = await get("/api/usage/today");
		assert.equal(today.body.sessions[a.id], 0.25);
	});

	test("a paired phone can read usage, like today's spending", async () => {
		const { store, app } = setup();
		const a = store.createSession(sessionInput("a"));
		store.addUsage(a.id, spend(0.5), 0);
		for (const path of ["/api/usage/today", "/api/usage", `/api/usage/${localDay(Date.now())}`]) {
			const response = await app.fetch(new Request(`http://localhost${path}`), {
				device: "device-1",
			});
			assert.equal(response.status, 200, path);
		}
	});
});
