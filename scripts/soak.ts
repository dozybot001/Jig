/**
 * A long task against a real model, in a throwaway data folder: one message, then dozens of tool
 * calls, with a low compaction threshold so the context is shortened inside the turn several times.
 * It shows what the scripted tests cannot: how a real provider takes thinking blocks, prompt caching
 * and a shortened context over a long turn.
 *
 * This calls a real model and costs money; it is not part of `npm test`. The key is read from a file
 * (never from a command argument) and kept in memory only:
 *
 *   JIG_SOAK_KEY_FILE=/path/to/key node scripts/soak.ts anthropic claude-haiku-5-5 [files] [thinking] [compactAt]
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../src/server/agent/runner.ts";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { ModelGateway } from "../src/server/model/gateway.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import { Store } from "../src/server/store.ts";
import type { ThinkingLevel } from "../src/shared/types.ts";

const [
	provider = "anthropic",
	model = "claude-haiku-5-5",
	count = "40",
	thinking = "low",
	compactAt = "20000",
] = process.argv.slice(2);
const keyFile = process.env.JIG_SOAK_KEY_FILE;
if (!keyFile) {
	process.stderr.write("Set JIG_SOAK_KEY_FILE to a file that holds the provider's API key.\n");
	process.exit(2);
}
const files = Number(count);
const home = realpathSync(mkdtempSync(join(tmpdir(), "jig-soak-home-")));
const cwd = realpathSync(mkdtempSync(join(tmpdir(), "jig-soak-cwd-")));
const name = (i: number) => `note-${String(i).padStart(3, "0")}.txt`;
let expected = 0;
for (let i = 1; i <= files; i++) {
	const value = (i * 7919) % 1000;
	expected += value;
	const filler = Array.from(
		{ length: 60 },
		(_, n) => `line ${n} of note ${i}: nothing to see here.`,
	);
	filler.splice(30, 0, `VALUE=${value}`);
	writeFileSync(join(cwd, name(i)), `${filler.join("\n")}\n`);
}

const bus = new EventBus();
const store = new Store(openDatabase(":memory:"), bus);
const gateway = new ModelGateway({
	keys: new MemoryKeyStore({ [provider]: readFileSync(keyFile, "utf8").trim() }),
	version: "soak",
});
const log = (line: string) => process.stderr.write(`${line}\n`);
const agents = new Agents({
	store,
	gateway,
	permissions: new PermissionEngine(home),
	home,
	version: "soak",
	log,
});
const session = store.createSession({
	name: "soak",
	kind: "task",
	provider,
	model,
	cwd,
	thinking: thinking as ThinkingLevel,
	options: { permissionMode: "skip", compactAt: Number(compactAt) },
});
bus.subscribe((event) => {
	if (event.scope === "live" && event.event.type === "retrying") {
		log(`  retrying: ${JSON.stringify(event.event)}`);
	}
});

const started = Date.now();
agents.send(
	session.id,
	`This folder has ${files} files named ${name(1)} to ${name(files)}. Each has one line "VALUE=<number>". Read them one at a time with the read tool, one file per step, in order; do not use the shell or search tools. After every 10 files, write the running total to total.txt. When all are read, reply with exactly "TOTAL=<sum>".`,
);
const tick = setInterval(() => {
	const now = store.getSession(session.id);
	log(
		`  ${Math.round((Date.now() - started) / 1000)}s status=${now.status} context=${now.contextTokens} cost=$${now.usage.cost.toFixed(4)}`,
	);
}, 15_000);
await agents.whenIdle(session.id);
clearInterval(tick);

const end = store.getSession(session.id);
const all = store.listEntries(session.id, { limit: 250 }).entries;
const last = [...store.contextEntries(session.id)]
	.reverse()
	.find((entry) => entry.role === "assistant");
const lastReply =
	last?.role === "assistant"
		? last.message.content
				.flatMap((block) => (block.type === "text" ? [block.text] : []))
				.join("\n")
		: "";
let total: string | null = null;
try {
	total = readFileSync(join(cwd, "total.txt"), "utf8").trim();
} catch {}
process.stdout.write(
	`${JSON.stringify(
		{
			provider,
			model,
			thinking,
			seconds: Math.round((Date.now() - started) / 1000),
			status: end.status,
			statusDetail: end.statusDetail,
			expected: `TOTAL=${expected}`,
			lastReply,
			totalFile: total,
			toolCalls: store.toolCallsByStatus(session.id, ["done", "error", "denied"]).length,
			toolErrors: store.toolCallsByStatus(session.id, ["error", "denied"]).length,
			notices: all.flatMap((entry) =>
				entry.role === "notice" ? [`${entry.notice.kind}: ${entry.notice.text ?? ""}`] : [],
			),
			usage: end.usage,
			contextTokens: end.contextTokens,
		},
		null,
		2,
	)}\n`,
);
agents.shutdown();
process.exit(end.status === "idle" && lastReply.includes(`TOTAL=${expected}`) ? 0 : 1);
