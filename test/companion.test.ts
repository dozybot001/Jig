import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import type { Session, ToolCallView } from "../src/shared/types.ts";
import {
	activeToolPose,
	companionMood,
	GREETING_MS,
	greetingFor,
	isNight,
	POSES,
	poseForTool,
} from "../web/src/companion.ts";
import { MASCOT_POSES } from "../web/src/poses.ts";

function session(
	id: string,
	status: Session["status"],
	updatedAt = 1,
	archivedAt: number | null = null,
) {
	return { id, name: id, status, updatedAt, archivedAt } as Session;
}

// Long after Yew opened, at two in the afternoon.
const base = { now: 10 * GREETING_MS, hour: 14, openedAt: 0 };

describe("the mascot at the foot of the sidebar", () => {
	test("things waiting for the person come first and take her to the approval center", () => {
		const mood = companionMood({ ...base, sessions: [session("a", "error")], waiting: 2 });
		assert.deepEqual(mood.line, { kind: "waiting", count: 2 });
		assert.deepEqual(mood.target, { kind: "center" });
		assert.ok(POSES.waiting.includes(mood.pose));
	});

	test("then a failed session, then one to review, then sessions at work", () => {
		const sessions = [session("w", "working"), session("r", "needs_review"), session("e", "error")];
		assert.equal(companionMood({ ...base, sessions, waiting: 0 }).line.kind, "error");
		assert.equal(
			companionMood({ ...base, sessions: sessions.slice(0, 2), waiting: 0 }).line.kind,
			"review",
		);
		const working = companionMood({ ...base, sessions: sessions.slice(0, 1), waiting: 0 });
		assert.deepEqual(working.line, { kind: "working", count: 1, name: "w" });
		assert.deepEqual(working.target, { kind: "session", id: "w" });
	});

	test("one session is named and opened; several are counted and go nowhere", () => {
		const mood = companionMood({
			...base,
			sessions: [session("a", "error"), session("b", "error")],
			waiting: 0,
		});
		assert.deepEqual(mood.line, { kind: "error", count: 2, name: null });
		assert.equal(mood.target, null);
		assert.ok(POSES.error.includes(mood.pose));
	});

	test("archived sessions do not count", () => {
		const mood = companionMood({ ...base, sessions: [session("a", "error", 1, 5)], waiting: 0 });
		assert.deepEqual(mood.line, { kind: "clear", night: false });
		assert.ok(POSES.clear.includes(mood.pose));
	});

	test("she greets during the first minute, by the time of day", () => {
		const fresh = companionMood({ sessions: [], waiting: 0, now: 1_000, hour: 9, openedAt: 0 });
		assert.equal(fresh.greeting, "morning");
		assert.equal(fresh.pose, "greeting");
		const later = companionMood({
			sessions: [],
			waiting: 0,
			now: GREETING_MS,
			hour: 9,
			openedAt: 0,
		});
		assert.equal(later.greeting, null);
		assert.equal(greetingFor(13), "afternoon");
		assert.equal(greetingFor(20), "evening");
		assert.equal(greetingFor(2), null);
	});

	test("at night with nothing to do she dozes", () => {
		const mood = companionMood({ ...base, hour: 1, sessions: [], waiting: 0 });
		assert.deepEqual(mood.line, { kind: "clear", night: true });
		assert.ok(POSES.night.includes(mood.pose));
		assert.equal(isNight(23), true);
		assert.equal(isNight(5), false);
	});

	test("she holds a card while a permission waits, and keeps watch while scheduled tasks are on", () => {
		const asking = companionMood({ ...base, sessions: [], waiting: 1, permission: true });
		assert.equal(asking.pose, "permission");
		assert.deepEqual(asking.line, { kind: "waiting", count: 1 });
		assert.notEqual(companionMood({ ...base, sessions: [], waiting: 1 }).pose, "permission");
		const watching = companionMood({ ...base, sessions: [], waiting: 0, onDuty: true });
		assert.equal(watching.pose, "on-duty");
		assert.deepEqual(watching.line, { kind: "clear", night: false });
		// A session at work comes first.
		const busy = companionMood({
			...base,
			sessions: [session("w", "working")],
			waiting: 0,
			onDuty: true,
		});
		assert.ok(POSES.working.includes(busy.pose));
	});

	test("her pose changes at most every ten minutes", () => {
		const at = (now: number) =>
			companionMood({ ...base, now, sessions: [session("w", "working")], waiting: 0 }).pose;
		const slot = 10 * 60_000;
		assert.equal(at(3 * slot), at(3 * slot + slot - 1));
		assert.notEqual(at(3 * slot), at(4 * slot));
	});

	test("every pose has its picture", () => {
		for (const pose of MASCOT_POSES) {
			const file = new URL(`../web/public/mascot/${pose}.webp`, import.meta.url);
			assert.ok(existsSync(file), `${pose}.webp is missing`);
		}
	});

	test("running tools map to matching work poses", () => {
		assert.equal(poseForTool("grep"), "magnifier");
		assert.equal(poseForTool("read"), "reading");
		assert.equal(poseForTool("edit"), "writing");
		assert.equal(poseForTool("shell"), "typing");
		assert.equal(poseForTool("delegate"), "books");
		const calls: Record<string, ToolCallView> = {
			a: { tool: "read", status: "done", startedAt: 100, createdAt: 100 } as ToolCallView,
			b: { tool: "grep", status: "running", startedAt: 200, createdAt: 200 } as ToolCallView,
			c: { tool: "shell", status: "running", startedAt: 300, createdAt: 300 } as ToolCallView,
		};
		assert.equal(activeToolPose(calls), "typing");
		assert.equal(activeToolPose({ a: calls.a as ToolCallView }), null);
	});
});
