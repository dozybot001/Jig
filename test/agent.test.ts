import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SUMMARY_HEADING } from "../src/server/agent/context.ts";
import { Agents } from "../src/server/agent/runner.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { ModelGateway } from "../src/server/model/gateway.ts";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "../src/server/model/testing.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import type { Entry } from "../src/shared/types.ts";
import { newStore, tempDir } from "./helpers/store.ts";

type Context = { messages: { role: string; content: unknown; toolsAdded?: { name: string }[] }[] };

function setup(options: { cwd?: boolean; key?: boolean } = {}) {
	const faux = fauxProvider();
	const { store } = newStore();
	const keys = new MemoryKeyStore(options.key === false ? {} : { [faux.provider.id]: "test-key" });
	const gateway = new ModelGateway({ keys, version: "0.0.0", providers: [faux.provider] });
	const home = realpathSync(tempDir("jig-home-"));
	const cwd = options.cwd === false ? null : realpathSync(tempDir("jig-cwd-"));
	const agents = new Agents({
		store,
		gateway,
		permissions: new PermissionEngine(home),
		home,
		version: "0.0.0",
		draftIntervalMs: 0,
		log: () => {},
	});
	const session = store.createSession({
		name: "test",
		kind: "task",
		provider: faux.provider.id,
		model: faux.getModel().id,
		cwd,
		thinking: "off",
	});
	const contexts: Context[] = [];
	const capture = (reply: ReturnType<typeof fauxAssistantMessage>) => (context: unknown) => {
		contexts.push(structuredClone(context) as Context);
		return reply;
	};
	return { faux, store, agents, session, cwd: cwd as string, home, contexts, capture };
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

const roles = (entries: Entry[]) => entries.map((entry) => entry.role);
const textOf = (value: unknown) => JSON.stringify(value);
const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) =>
	fauxAssistantMessage(calls, { stopReason: "toolUse" });

describe("agent loop", () => {
	test("a message gets a streamed reply; the session ends idle and unread", async () => {
		const { faux, store, agents, session } = setup();
		faux.setResponses([fauxAssistantMessage("你好，我在。")]);
		const sent = agents.send(session.id, "你好");
		assert.ok("entry" in sent);
		await agents.whenIdle(session.id);
		const { entries } = store.listEntries(session.id, { limit: 50 });
		assert.deepEqual(roles(entries), ["user", "assistant"]);
		const after = store.getSession(session.id);
		assert.equal(after.status, "idle");
		assert.equal(after.unread, 1);
	});

	test("tool calls run, their results go back to the model, then it answers", async () => {
		const { faux, store, agents, session, cwd, contexts, capture } = setup();
		writeFileSync(join(cwd, "a.txt"), "alpha\n");
		faux.setResponses([
			toolUse(
				fauxToolCall("read", { path: "a.txt" }, { id: "c1" }),
				fauxToolCall("glob", { pattern: "*.txt" }, { id: "c2" }),
			),
			capture(fauxAssistantMessage("It says alpha.")),
		]);
		agents.send(session.id, "What is in a.txt?");
		await agents.whenIdle(session.id);
		const { entries } = store.listEntries(session.id, { limit: 50 });
		assert.deepEqual(roles(entries), [
			"user",
			"assistant",
			"toolResult",
			"toolResult",
			"assistant",
		]);
		const last = contexts[0]?.messages ?? [];
		assert.match(textOf(last.at(-2)), /alpha/);
		const calls = store.toolCallsForMessages([entries[1]?.id as string]);
		assert.deepEqual(
			calls.map((call) => call.status),
			["done", "done"],
		);
	});

	test("an operation that needs approval waits; a refusal with a reason reaches the model", async () => {
		const { faux, store, agents, session, cwd, contexts, capture } = setup();
		faux.setResponses([
			toolUse(fauxToolCall("shell", { command: "touch made.txt" }, { id: "c1" })),
			capture(fauxAssistantMessage("OK, I will not.")),
		]);
		agents.send(session.id, "make a file");
		await until(() => store.pendingApprovals(session.id).length === 1);
		assert.equal(store.getSession(session.id).status, "waiting");
		const [approval] = store.pendingApprovals(session.id);
		agents.answer(approval?.id as string, { decision: "deny", reason: "不要建文件" });
		await agents.whenIdle(session.id);
		assert.equal(existsSync(join(cwd, "made.txt")), false);
		assert.match(textOf(contexts[0]?.messages.at(-1)), /不要建文件/);
		assert.equal(store.getSession(session.id).status, "idle");
	});

	test("allow and remember adds a rule; must-confirm operations can only be allowed once", async () => {
		const { faux, store, agents, session, cwd } = setup();
		writeFileSync(join(cwd, "old.txt"), "x");
		faux.setResponses([
			toolUse(fauxToolCall("shell", { command: "touch made.txt" }, { id: "c1" })),
			toolUse(fauxToolCall("shell", { command: "rm old.txt" }, { id: "c2" })),
			fauxAssistantMessage("Done."),
		]);
		agents.send(session.id, "go");
		await until(() => store.pendingApprovals(session.id).length === 1);
		agents.answer(store.pendingApprovals(session.id)[0]?.id as string, {
			decision: "allow_always",
		});
		await until(
			() => store.pendingApprovals(session.id).length === 1 && existsSync(join(cwd, "made.txt")),
		);
		assert.deepEqual(store.getSession(session.id).rules, [
			{ effect: "allow", tool: "shell", pattern: "touch" },
		]);
		const confirm = store.pendingApprovals(session.id)[0];
		assert.ok(confirm);
		assert.equal((confirm.request as { mustConfirm: boolean }).mustConfirm, true);
		assert.throws(
			() => agents.answer(confirm?.id as string, { decision: "allow_always" }),
			/only be allowed once/,
		);
		agents.answer(confirm?.id as string, { decision: "allow_once" });
		await agents.whenIdle(session.id);
		assert.equal(existsSync(join(cwd, "old.txt")), false);
	});

	test("stopping while waiting cancels the approval and leaves a valid transcript", async () => {
		const { faux, store, agents, session, contexts, capture } = setup();
		faux.setResponses([
			toolUse(fauxToolCall("shell", { command: "touch x" }, { id: "c1" })),
			capture(fauxAssistantMessage("Hello again.")),
		]);
		agents.send(session.id, "go");
		await until(() => store.pendingApprovals(session.id).length === 1);
		const approvalId = store.pendingApprovals(session.id)[0]?.id as string;
		agents.stop(session.id);
		await agents.whenIdle(session.id);
		assert.equal(store.getApproval(approvalId).status, "cancelled");
		assert.equal(store.getSession(session.id).status, "idle");
		agents.send(session.id, "hello?");
		await agents.whenIdle(session.id);
		const messages = contexts[0]?.messages.filter((m) => m.role !== "system") ?? [];
		assert.deepEqual(
			messages.map((m) => m.role),
			["user", "assistant", "toolResult", "user"],
		);
		assert.match(textOf(messages[2]), /stopped before the person decided/);
	});

	test("a message sent while the session works waits and arrives after the tool results", async () => {
		const { faux, store, agents, session, contexts, capture } = setup();
		faux.setResponses([
			toolUse(fauxToolCall("shell", { command: "touch y" }, { id: "c1" })),
			capture(fauxAssistantMessage("Got both.")),
		]);
		agents.send(session.id, "first");
		await until(() => store.pendingApprovals(session.id).length === 1);
		const queued = agents.send(session.id, "补充一句");
		assert.ok("queued" in queued);
		agents.answer(store.pendingApprovals(session.id)[0]?.id as string, { decision: "allow_once" });
		await agents.whenIdle(session.id);
		const messages = contexts[0]?.messages.filter((m) => m.role !== "system") ?? [];
		assert.deepEqual(
			messages.map((m) => m.role),
			["user", "assistant", "toolResult", "user"],
		);
		assert.match(textOf(messages[3]), /补充一句/);
		assert.deepEqual(store.listQueue(session.id), []);
	});

	test("near the context limit, older history is summarized and the model sees the summary", async () => {
		const { faux, store, agents, session, contexts, capture } = setup();
		store.updateSession(session.id, { options: { compactAt: 10_000 } });
		const big = "历史记录 ".repeat(25_000);
		for (let i = 0; i < 2; i++) {
			store.appendEntry(session.id, {
				role: "user",
				message: { role: "user", content: big, timestamp: 1 },
			});
			store.appendEntry(session.id, {
				role: "assistant",
				message: { ...fauxAssistantMessage("old reply"), timestamp: 1 },
			});
		}
		store.setContextTokens(session.id, 60_000);
		faux.setResponses([
			fauxAssistantMessage("The person asked about history."),
			capture(fauxAssistantMessage("Continuing.")),
		]);
		agents.send(session.id, "继续");
		await agents.whenIdle(session.id);
		const compaction = store
			.listEntries(session.id, { limit: 50 })
			.entries.find((entry) => entry.role === "compaction");
		assert.ok(compaction?.role === "compaction");
		const messages = contexts[0]?.messages.filter((m) => m.role !== "system") ?? [];
		assert.match(textOf(messages[0]), new RegExp(SUMMARY_HEADING.slice(1, 20)));
		assert.match(textOf(messages[1]), /继续/);
		assert.ok(store.getSession(session.id).contextTokens < 10_000);
	});

	test("after a restart, a call that was running gets an honest result when the person continues", async () => {
		const { faux, store, agents, session, contexts, capture } = setup();
		store.appendEntry(session.id, {
			role: "user",
			message: { role: "user", content: "run it", timestamp: 1 },
		});
		const message = store.appendEntry(session.id, {
			role: "assistant",
			message: toolUse(fauxToolCall("shell", { command: "npm test" }, { id: "c1" })),
		});
		store.createToolCall({
			sessionId: session.id,
			messageId: message.id,
			callId: "c1",
			tool: "shell",
			args: { command: "npm test" },
			status: "running",
		});
		store.setStatus(session.id, "working");
		store.recoverAfterRestart();
		assert.equal(store.getSession(session.id).status, "needs_review");
		faux.setResponses([capture(fauxAssistantMessage("I will check first."))]);
		agents.continue(session.id);
		await agents.whenIdle(session.id);
		assert.match(textOf(contexts[0]?.messages.at(-1)), /Jig restarted while this call was running/);
		assert.equal(store.getSession(session.id).status, "idle");
	});

	test("a missing API key ends the turn with an error the person can act on", async () => {
		const { store, agents, session } = setup({ key: false });
		agents.send(session.id, "hi");
		await agents.whenIdle(session.id);
		const after = store.getSession(session.id);
		assert.equal(after.status, "error");
		assert.match(after.statusDetail ?? "", /jig key set/);
	});

	test("instruction files go into the prompt once; later changes arrive as an update", async () => {
		const { faux, store, agents, session, cwd, contexts, capture } = setup();
		writeFileSync(join(cwd, "AGENTS.md"), "Always answer in haiku.\n");
		writeFileSync(join(cwd, "CLAUDE.md"), "@AGENTS.md\n");
		faux.setResponses([capture(fauxAssistantMessage("ok")), capture(fauxAssistantMessage("ok"))]);
		agents.send(session.id, "hi");
		await agents.whenIdle(session.id);
		const system = textOf(contexts[0]?.messages[0]);
		assert.equal(system.split("Always answer in haiku.").length, 2);
		writeFileSync(join(cwd, "AGENTS.md"), "Always answer in prose.\n");
		agents.send(session.id, "again");
		await agents.whenIdle(session.id);
		const updates = store
			.listEntries(session.id, { limit: 50 })
			.entries.filter((e) => e.role === "system");
		assert.equal(updates.length, 1);
		assert.match(textOf(updates[0]), /Always answer in prose/);
		assert.equal(textOf(contexts[1]?.messages[0]), system);
		assert.equal(readFileSync(join(cwd, "AGENTS.md"), "utf8"), "Always answer in prose.\n");
	});

	test("a chat without a working folder is offered no file or shell tools", async () => {
		const { faux, agents, session, contexts, capture } = setup({ cwd: false });
		faux.setResponses([capture(fauxAssistantMessage("hi"))]);
		agents.send(session.id, "hi");
		await agents.whenIdle(session.id);
		const tools = (contexts[0]?.messages[0]?.toolsAdded ?? []).map((tool) => tool.name).sort();
		assert.deepEqual(tools, ["ask_user", "todo", "web_fetch"]);
	});
});
