import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { run } from "../src/cli/run.ts";
import { sendCommand } from "../src/cli/send.ts";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { MailStore } from "../src/server/mail/store.ts";
import { dbPath } from "../src/server/paths.ts";
import { Store } from "../src/server/store.ts";
import { fakeIo } from "./helpers/io.ts";
import { sessionInput, tempDir } from "./helpers/store.ts";

/** A data directory of its own, never the real ~/.jig. */
function home(sessions: Parameters<Store["createSession"]>[0][]) {
	const dir = tempDir("yew-send-");
	const db = openDatabase(dbPath(dir));
	const store = new Store(db, new EventBus());
	const created = sessions.map((input) => store.createSession(input));
	db.close();
	const letters = () => {
		const db = openDatabase(dbPath(dir));
		try {
			return new MailStore(new Store(db, new EventBus())).listLetters({ limit: 50 }).items;
		} finally {
			db.close();
		}
	};
	return { dir, created, letters };
}

const send = (argv: string[], env: Record<string, string>, stdin?: string[]) => {
	const captured = fakeIo({ env, ...(stdin ? { stdin } : {}) });
	return run(["send", ...argv], captured.io, [sendCommand()]).then((code) => ({
		code,
		...captured,
	}));
};

describe("yew send", () => {
	test("inside a session's shell the letter comes from that session, with its limits", async () => {
		const { dir, created, letters } = home([sessionInput("平台组"), sessionInput("产品会话")]);
		const from = created[1] as { id: string };
		const env = { YEW_HOME: dir, YEW_SESSION: from.id };
		const result = await send(["平台组", "构建好了"], env);
		assert.equal(result.code, 0);
		const [letter] = letters();
		assert.equal(letter?.fromKind, "session");
		assert.equal(letter?.fromSession, from.id);
		const again = await send(["平台组", "构建好了"], env);
		assert.equal(again.code, 1);
		assert.match(again.stderr.text(), /already sent/);
		const unknown = await send(["平台组", "构建好了"], { YEW_HOME: dir, YEW_SESSION: "nope" });
		assert.equal(unknown.code, 1);
		assert.match(unknown.stderr.text(), /YEW_SESSION names no session/);
	});

	test("sends a letter by name; the first line is the summary; it is marked as from the command line", async () => {
		const { dir, letters } = home([sessionInput("平台组")]);
		const result = await send(["平台组", "main 上的构建失败了\n失败的测试：api"], {
			JIG_HOME: dir,
		});
		assert.equal(result.code, 0);
		assert.match(result.stdout.text(), /^Sent letter [\w-]+ to 平台组\.\n$/);
		assert.match(
			result.stderr.text(),
			/Yew is not running; the letter is delivered when it starts/,
		);
		const [letter] = letters();
		assert.equal(letter?.fromKind, "cli");
		assert.equal(letter?.kind, "notice");
		assert.equal(letter?.summary, "main 上的构建失败了");
		assert.equal(letter?.body, "失败的测试：api");
		assert.equal(letter?.status, "queued");
	});

	test("reads the message from standard input, by id, with --kind and --json", async () => {
		const { dir, created, letters } = home([sessionInput("平台组")]);
		const id = created[0]?.id as string;
		const result = await send(["--kind", "request", "--json", id, "-"], { JIG_HOME: dir }, [
			"请看一下发布清单\n",
		]);
		assert.equal(result.code, 0);
		const out = JSON.parse(result.stdout.text());
		assert.deepEqual([out.to.name, out.kind, out.status], ["平台组", "request", "queued"]);
		assert.equal(letters()[0]?.summary, "请看一下发布清单");
	});

	test("unknown sessions, refused letters and bad kinds fail", async () => {
		const { dir } = home([
			sessionInput("平台组"),
			{ ...sessionInput("安全组"), options: { receive: "refuse" } },
		]);
		const unknown = await send(["没有这个", "hi"], { JIG_HOME: dir });
		assert.equal(unknown.code, 1);
		assert.match(unknown.stderr.text(), /no session with the name or id 没有这个/);
		const refused = await send(["安全组", "hi"], { JIG_HOME: dir });
		assert.equal(refused.code, 1);
		assert.match(refused.stderr.text(), /does not accept letters/);
		const bad = await send(["--kind", "decision", "平台组", "hi"], { JIG_HOME: dir });
		assert.equal(bad.code, 2);
		const missing = await send(["平台组"], { JIG_HOME: dir });
		assert.equal(missing.code, 2);
	});

	test("a held letter says so", async () => {
		const { dir } = home([{ ...sessionInput("法务组"), options: { receive: "hold" } }]);
		const result = await send(["法务组", "合同到了"], { JIG_HOME: dir });
		assert.equal(result.code, 0);
		assert.match(result.stderr.text(), /held until you release it/);
	});
});
