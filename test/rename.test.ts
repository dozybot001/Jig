/**
 * Jig was renamed Yew on 2026-11-18 (blueprint, section 12). What a person had under the old name
 * keeps working: the data folder moves once and leaves a link, the database file follows, the old
 * environment variables still count, Jig's login service and launcher make way for Yew's, and notes
 * Jig wrote into conversations are still recognised as its own.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { type AppHost, installApp, uninstallApp } from "../src/cli/app.ts";
import { installService, type ServiceHost } from "../src/cli/service.ts";
import { pairingLink, parsePairingLink } from "../src/remote/protocol.ts";
import { isOwnNote } from "../src/server/agent/context.ts";
import { migrate } from "../src/server/db/database.ts";
import { migrations } from "../src/server/db/migrations.ts";
import { moveJigHome } from "../src/server/from-jig.ts";
import { dbPath, yewHome } from "../src/server/paths.ts";
import { tempDir } from "./helpers/store.ts";

function oldHome(user: string, serving?: number) {
	const old = join(user, ".jig");
	mkdirSync(old);
	writeFileSync(join(old, "jig.db"), "db");
	writeFileSync(join(old, "jig.db-wal"), "wal");
	writeFileSync(join(old, "mcp.json"), "{}");
	if (serving !== undefined) {
		writeFileSync(join(old, "serve.json"), JSON.stringify({ port: 4777, pid: serving }));
	}
	return old;
}

describe("the data folder", () => {
	test("moves from ~/.jig to ~/.yew once, leaving a link, with the database renamed", () => {
		const user = tempDir("yew-user-");
		const old = oldHome(user);
		assert.equal(yewHome({}, user), old, "before the move it is still the old folder");
		assert.deepEqual(moveJigHome({}, user), { moved: old, to: join(user, ".yew") });
		const home = join(user, ".yew");
		assert.equal(yewHome({}, user), home);
		assert.equal(readFileSync(join(home, "yew.db"), "utf8"), "db");
		assert.equal(readFileSync(join(home, "yew.db-wal"), "utf8"), "wal");
		assert.equal(existsSync(join(home, "jig.db")), false);
		assert.equal(dbPath(home), join(home, "yew.db"));
		assert.ok(lstatSync(old).isSymbolicLink());
		assert.equal(readlinkSync(old), home);
		assert.equal(readFileSync(join(old, "mcp.json"), "utf8"), "{}", "old paths still work");
		assert.equal(moveJigHome({}, user), null, "only once");
	});

	test("stays where it is while Jig still runs from it", () => {
		const user = tempDir("yew-user-");
		const old = oldHome(user, process.pid);
		assert.deepEqual(moveJigHome({}, user), { busy: process.pid, folder: old });
		assert.equal(existsSync(join(user, ".yew")), false);
		assert.equal(yewHome({}, user), old);
		assert.equal(dbPath(old), join(old, "jig.db"));
	});

	test("set by YEW_HOME or the older JIG_HOME, it only gets its database renamed", () => {
		const user = tempDir("yew-user-");
		const custom = tempDir("yew-custom-");
		writeFileSync(join(custom, "jig.db"), "db");
		assert.equal(yewHome({ JIG_HOME: custom }, user), custom);
		assert.equal(yewHome({ YEW_HOME: custom, JIG_HOME: "/elsewhere" }, user), custom);
		assert.deepEqual(moveJigHome({ JIG_HOME: custom }, user), { renamed: custom });
		assert.equal(readFileSync(join(custom, "yew.db"), "utf8"), "db");
		assert.equal(yewHome({}, user), join(user, ".yew"), "a person without Jig starts in ~/.yew");
	});
});

describe("what Jig set up on the computer", () => {
	test("Jig's login service is stopped and removed when Yew's is installed", () => {
		const homeDir = tempDir("yew-user-");
		const agents = join(homeDir, "Library", "LaunchAgents");
		mkdirSync(agents, { recursive: true });
		writeFileSync(join(agents, "cn.tenonai.apps.jig.plist"), "<plist/>");
		const calls: string[] = [];
		const host: ServiceHost = {
			platform: "darwin",
			homeDir,
			uid: 501,
			node: "/usr/bin/node",
			entry: "/yew/main.js",
			run: (command, args) => {
				calls.push([command, ...args].join(" "));
				return 0;
			},
		};
		installService(host, tempDir("yew-home-"), { PATH: "/bin" }, { start: false });
		assert.equal(existsSync(join(agents, "cn.tenonai.apps.jig.plist")), false);
		assert.ok(existsSync(join(agents, "cn.tenonai.apps.yew.plist")));
		assert.ok(calls.includes("launchctl bootout gui/501/cn.tenonai.apps.jig"));
	});

	test("Jig's launcher makes way for Yew's; an app of the same name that Jig did not make stays", () => {
		const homeDir = tempDir("yew-user-");
		const host: AppHost = {
			platform: "darwin",
			homeDir,
			node: "/usr/bin/node",
			entry: "/yew/main.js",
			icon: null,
			run: () => 0,
		};
		const jigApp = join(homeDir, "Applications", "Jig.app");
		mkdirSync(join(jigApp, "Contents", "MacOS"), { recursive: true });
		writeFileSync(join(jigApp, "Contents", "MacOS", "jig-launcher"), "#!/bin/sh\n");
		installApp(host, tempDir("yew-home-"), {});
		assert.equal(existsSync(jigApp), false);
		assert.ok(
			existsSync(join(homeDir, "Applications", "Yew.app", "Contents", "MacOS", "yew-launcher")),
		);
		const other = join(homeDir, "Applications", "Jig.app");
		mkdirSync(join(other, "Contents"), { recursive: true });
		uninstallApp(host);
		assert.ok(existsSync(other), "not Jig's launcher, so not ours to remove");
	});
});

describe("conversations from before the rename", () => {
	test("notes Jig wrote are still its own, not the person's", () => {
		assert.equal(isOwnNote("[From Jig, not from the person] The task was stopped."), true);
		assert.equal(isOwnNote("[From Yew, not from the person] The task was stopped."), true);
		assert.equal(isOwnNote("Please fix the footer."), false);
	});

	test("pairing links are yew:// only; the phone apps are new, so Jig's links are not taken", () => {
		const link = { relay: "wss://r", desktop: "d1", key: "k", secret: "s", name: "Mac" };
		assert.match(pairingLink(link), /^yew:\/\/pair\?/);
		assert.deepEqual(parsePairingLink(pairingLink(link)), link);
		assert.equal(parsePairingLink("jig://pair?r=wss%3A%2F%2Fr&d=d1&k=k&s=s&n=Mac"), null);
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
		// The database as Jig left it: every migration but the rename.
		for (const [version, sql] of migrations.slice(0, -1).entries()) {
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
});
