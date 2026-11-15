import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { exportCommand } from "../src/cli/export.ts";
import { exportAll } from "../src/server/data-export.ts";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { MailStore } from "../src/server/mail/store.ts";
import { dbPath } from "../src/server/paths.ts";
import { Store } from "../src/server/store.ts";
import { fakeIo } from "./helpers/io.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

describe("jig export", () => {
	test("sessions become Markdown; letters, cards, tasks and settings become JSON; no secrets", () => {
		const { store } = newStore();
		const main = store.createSession(sessionInput("总办"));
		const product = store.createSession(sessionInput("产品/开发"));
		const twin = store.createSession(sessionInput("产品 开发"));
		store.updateSession(twin.id, { archived: true });
		store.appendEntry(product.id, {
			role: "user",
			message: { role: "user", content: "把报告整理一遍", timestamp: Date.now() },
		});
		store.addDevice("iPhone", "k".repeat(43));
		store.updateDevice(store.listDevices()[0]?.id as string, {
			pushToken: `sandbox:${"ab".repeat(32)}`,
		});
		new MailStore(store).addLetter({
			fromKind: "session",
			fromSession: product.id,
			fromName: product.name,
			toSession: main.id,
			kind: "notice",
			summary: "报告整理好了",
			body: "",
			status: "queued",
		});
		const folder = tempDir("jig-export-");
		const counts = exportAll(store, folder);
		assert.deepEqual(
			{ sessions: counts.sessions, letters: counts.letters },
			{ sessions: 3, letters: 1 },
		);
		// Names that differ only by a character a file system refuses still get a file each.
		assert.deepEqual(readdirSync(join(folder, "sessions")).sort(), [
			"产品 开发 2.md",
			"产品 开发.md",
			"总办.md",
		]);
		const index = JSON.parse(readFileSync(join(folder, "sessions.json"), "utf8"));
		const listed = index.find((s: { id: string }) => s.id === product.id);
		assert.match(readFileSync(join(folder, "sessions", listed.file), "utf8"), /把报告整理一遍/);
		assert.equal(
			JSON.parse(readFileSync(join(folder, "letters.json"), "utf8"))[0].summary,
			"报告整理好了",
		);
		const everything = readdirSync(folder, { recursive: true })
			.filter((name) => String(name).includes("."))
			.map((name) => readFileSync(join(folder, String(name)), "utf8"))
			.join("\n");
		assert.equal(everything.includes("ab".repeat(32)), false);
		assert.equal(everything.includes("k".repeat(43)), false);
		// A folder with something in it is left alone.
		writeFileSync(join(folder, "extra.txt"), "x");
		assert.throws(() => exportAll(store, folder), /not empty/);
	});

	test("the command writes into a new folder and reports what it wrote", async () => {
		const home = tempDir("jig-home-");
		const db = openDatabase(dbPath(home));
		new Store(db, new EventBus()).createSession(sessionInput("UI"));
		db.close();
		const out = join(tempDir("jig-out-"), "backup");
		const { io, stdout } = fakeIo({ env: { JIG_HOME: home } });
		assert.equal(await exportCommand().run([out, "--json"], io), 0);
		const report = JSON.parse(stdout.text());
		assert.equal(report.sessions, 1);
		assert.equal(report.folder, out);
		assert.ok(readdirSync(join(out, "sessions")).includes("UI.md"));
		await assert.rejects(exportCommand().run([], io), /needs one folder/);
	});
});

test("JIG_KEYCHAIN=off keeps keys in memory, away from the system keychain", async () => {
	const { MemoryKeyStore, systemKeys } = await import("../src/server/keys.ts");
	const keys = systemKeys("provider", { JIG_KEYCHAIN: "off" });
	assert.ok(keys instanceof MemoryKeyStore);
	assert.equal(await keys.get("deepseek"), null);
});
