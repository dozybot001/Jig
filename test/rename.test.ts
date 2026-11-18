/**
 * Jig was renamed Yew on 2026-11-18 (blueprint, section 12), and Yew reads nothing by Jig's names.
 * What was stored under the old names is rewritten once by the database migrations, so old
 * conversations, letters and rules keep meaning what they meant.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { pairingLink, parsePairingLink } from "../src/remote/protocol.ts";
import { isOwnNote } from "../src/server/agent/context.ts";
import { migrate } from "../src/server/db/database.ts";
import { migrations } from "../src/server/db/migrations.ts";

/** The migration that renamed the stored values; the ones before it are the database Jig left. */
const renameAt = migrations.findIndex((sql) => String(sql).includes("CREATE TABLE letters_yew"));

describe("the rename", () => {
	test("pairing links are yew://", () => {
		const link = { relay: "wss://r", desktop: "d1", key: "k", secret: "s", name: "Mac" };
		assert.match(pairingLink(link), /^yew:\/\/pair\?/);
		assert.deepEqual(parsePairingLink(pairingLink(link)), link);
	});

	test("the command is yew only", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			name: string;
			bin: Record<string, string>;
		};
		assert.equal(pkg.name, "@tenonai/yew");
		assert.deepEqual(pkg.bin, { yew: "bin/yew.js" });
	});

	test("values stored under Jig's names take Yew's: scheduled letters, the settings tool, its rules", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		// The database from before the rename: every migration up to it.
		for (const [version, sql] of migrations.slice(0, renameAt).entries()) {
			db.exec(sql as string);
			db.exec(`PRAGMA user_version = ${version + 1}`);
		}
		const now = Date.now();
		db.prepare(
			"INSERT INTO sessions (id, name, kind, provider, model, last_activity_at, created_at, updated_at, rules) VALUES ('s1', 'Main', 'standing', 'p', 'm', ?, ?, ?, ?)",
		).run(
			now,
			now,
			now,
			JSON.stringify([{ effect: "allow", tool: "manage_jig", pattern: "organize" }]),
		);
		db.prepare(
			"INSERT INTO letters (id, thread_id, from_kind, from_name, to_session, kind, summary, body, status, created_at, updated_at) VALUES ('l1', 'l1', 'jig', 'Daily', 's1', 'notice', 'Daily', 'Go', 'delivered', ?, ?)",
		).run(now, now);
		db.prepare(
			"INSERT INTO messages (id, session_id, seq, role, body, created_at) VALUES ('m1', 's1', 1, 'assistant', ?, ?)",
		).run(
			JSON.stringify({
				role: "assistant",
				content: [{ type: "toolCall", id: "c", name: "manage_jig", arguments: {} }],
			}),
			now,
		);
		db.prepare(
			"INSERT INTO tool_calls (id, session_id, message_id, call_id, tool, args, status, created_at) VALUES ('t1', 's1', 'm1', 'c', 'manage_jig', '{}', 'done', ?)",
		).run(now);
		migrate(db);
		const value = (sql: string) => Object.values(db.prepare(sql).get() as object)[0];
		assert.equal(value("SELECT from_kind FROM letters WHERE id = 'l1'"), "yew");
		assert.equal(value("SELECT tool FROM tool_calls WHERE id = 't1'"), "manage_yew");
		assert.match(String(value("SELECT body FROM messages WHERE id = 'm1'")), /"name":"manage_yew"/);
		assert.match(
			String(value("SELECT rules FROM sessions WHERE id = 's1'")),
			/"tool":"manage_yew"/,
		);
		assert.throws(() =>
			db
				.prepare(
					"INSERT INTO letters (id, thread_id, from_kind, from_name, to_session, kind, summary, body, status, created_at, updated_at) VALUES ('l2', 'l2', 'jig', 'x', 's1', 'notice', 'x', 'x', 'queued', 1, 1)",
				)
				.run(),
		);
	});

	test("notes written under the old name are rewritten as Yew's own", () => {
		assert.ok(renameAt > 0);
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		for (const [version, sql] of migrations.slice(0, -1).entries()) {
			db.exec(sql as string);
			db.exec(`PRAGMA user_version = ${version + 1}`);
		}
		const now = Date.now();
		db.prepare(
			"INSERT INTO sessions (id, name, kind, provider, model, last_activity_at, created_at, updated_at) VALUES ('s1', 'Main', 'standing', 'p', 'm', ?, ?, ?)",
		).run(now, now, now);
		const old = "[From Jig, not from the person] The task was stopped.";
		db.prepare(
			"INSERT INTO messages (id, session_id, seq, role, body, created_at) VALUES ('m1', 's1', 1, 'user', ?, ?)",
		).run(JSON.stringify({ role: "user", content: old, timestamp: now }), now);
		migrate(db);
		const body = JSON.parse(
			String(
				Object.values(db.prepare("SELECT body FROM messages WHERE id = 'm1'").get() as object)[0],
			),
		) as { content: string };
		assert.equal(body.content, "[From Yew, not from the person] The task was stopped.");
		assert.equal(isOwnNote(body.content), true);
		assert.equal(isOwnNote("Please fix the footer."), false);
	});
});
