import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { exportFileName, sessionMarkdown } from "../src/server/export.ts";
import { createApp } from "../src/server/http/app.ts";
import type { AssistantMessage, EntryBody } from "../src/shared/messages.ts";
import { newStore, sessionInput } from "./helpers/store.ts";

const user = (text: string): EntryBody => ({
	role: "user",
	message: { role: "user", content: text, timestamp: Date.now() },
});

const assistant = (content: AssistantMessage["content"]): EntryBody => ({
	role: "assistant",
	message: {
		role: "assistant",
		content,
		api: "faux",
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: {
			input: 10,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 30,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	},
});

function sample() {
	const { store } = newStore();
	const group = store.createGroup("产品");
	const session = store.createSession({
		...sessionInput("Jig 产品会话"),
		groupId: group.id,
		responsibility: "负责 Jig 仓库。",
	});
	store.appendEntry(session.id, user("请把会话导出为 Markdown。"));
	const message = store.appendEntry(
		session.id,
		assistant([
			{ type: "thinking", thinking: "先读存储层。" },
			{ type: "text", text: "我先看看现有实现。" },
			{
				type: "toolCall",
				id: "call-1",
				name: "read",
				arguments: { path: "src/server/store.ts" },
			},
		]),
	);
	const call = store.createToolCall({
		sessionId: session.id,
		messageId: message.id,
		callId: "call-1",
		tool: "read",
		args: { path: "src/server/store.ts" },
		status: "done",
	});
	store.appendEntry(session.id, {
		role: "toolResult",
		message: {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "1\timport x from 'y';\n```js\nold\n```" }],
			isError: false,
			timestamp: Date.now(),
		},
	});
	store.updateToolCall(call.id, {
		status: "done",
		detail: { diff: "@@ -1 +1 @@\n-old\n+new" },
	});
	store.addUsage(session.id, { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0 }, 30);
	store.appendEntry(session.id, {
		role: "notice",
		notice: { kind: "model_changed", text: "deepseek/old → deepseek/new", timestamp: 1 },
	});

	return {
		store,
		group,
		session,
		inputs: () => ({
			session: store.getSession(session.id),
			groupName: group.name,
			entries: store.allEntries(session.id),
			toolCalls: store.toolCallsForSession(session.id),
			now: new Date(2026, 10, 9, 14, 30).getTime(),
		}),
	};
}

describe("Markdown export", () => {
	test("writes the session, its messages and each tool call's arguments, changes and result", () => {
		const { inputs } = sample();
		const markdown = sessionMarkdown({ ...inputs(), language: "zh" });

		assert.match(markdown, /^# Jig 产品会话\n/);
		assert.match(markdown, /- 类型：常设会话/);
		assert.match(markdown, /- 分组：产品/);
		assert.match(markdown, /- 模型：deepseek\/deepseek-v4-pro/);
		assert.match(markdown, /- 用量：30 token · USD 0\.00/);
		assert.match(markdown, /## 职责说明\n\n负责 Jig 仓库。/);
		assert.match(markdown, /## 你\n\n> 请把会话导出为 Markdown。/);
		assert.match(markdown, /## Jig 产品会话\n\n> \*\*思考过程\*\*/);
		assert.match(markdown, /我先看看现有实现。/);
		assert.match(markdown, /### 工具调用：读取 src\/server\/store\.ts/);
		assert.match(markdown, /\*\*参数\*\*/);
		assert.match(markdown, /"path": "src\/server\/store\.ts"/);
		assert.match(markdown, /\*\*改动\*\*/);
		assert.match(markdown, /\+new/);
		assert.match(markdown, /\*\*结果\*\*/);
		assert.match(markdown, /````text\n1\timport x from 'y';/);
		assert.match(markdown, /> 换了模型：deepseek\/old → deepseek\/new/);
		assert.ok(!markdown.includes("## 工具结果"));
	});

	test("uses the interface language for headings and tool verbs", () => {
		const { inputs } = sample();
		const markdown = sessionMarkdown({ ...inputs(), language: "en" });
		assert.match(markdown, /- Type: Standing session/);
		assert.match(markdown, /- Group: 产品/);
		assert.match(markdown, /## Role\n\n负责 Jig 仓库。/);
		assert.match(markdown, /## You\n\n> 请把会话导出为 Markdown。/);
		assert.match(markdown, /### Tool call: Read src\/server\/store\.ts/);
		assert.match(markdown, /\*\*Changes\*\*/);
		assert.match(markdown, /\*\*Result\*\*/);
		assert.match(markdown, /> Model changed: deepseek\/old → deepseek\/new/);
	});

	test("a file name is safe on every platform and keeps the session's name", () => {
		const name = exportFileName("总办 / 开发", new Date(2026, 10, 9));
		assert.equal(name, "总办 - 开发-2026-11-09.md");
		assert.equal(exportFileName("...", new Date(2026, 10, 9)), "session-2026-11-09.md");
	});
});

describe("export endpoint", () => {
	test("returns the whole transcript as a Markdown download in the requested language", async () => {
		const { store } = newStore();
		const app = createApp({ store, log: () => {} });
		const session = store.createSession(sessionInput("导出测试"));
		store.appendEntry(session.id, user("hello"));
		store.appendEntry(session.id, assistant([{ type: "text", text: "hi" }]));

		const response = await app.request(`/api/sessions/${session.id}/export.md?lang=en`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
		assert.match(
			response.headers.get("Content-Disposition") ?? "",
			/filename\*=UTF-8''%E5%AF%BC%E5%87%BA%E6%B5%8B%E8%AF%95-20\d{2}-\d{2}-\d{2}\.md/,
		);
		const markdown = await response.text();
		assert.match(markdown, /^# 导出测试/);
		assert.match(markdown, /## You\n\n> hello/);
		assert.match(markdown, /## 导出测试\n\nhi/);

		const saved = await (await app.request(`/api/sessions/${session.id}/export.md`)).text();
		assert.match(saved, /- 类型：常设会话/);
		assert.equal((await app.request(`/api/sessions/${session.id}/export.md?lang=fr`)).status, 400);
		assert.equal((await app.request("/api/sessions/nope/export.md")).status, 404);
	});

	test("without a language it follows the saved interface language", async () => {
		const { store } = newStore();
		const app = createApp({ store, log: () => {} });
		const session = store.createSession(sessionInput("language"));
		store.setSetting("language", "en");
		const markdown = await (await app.request(`/api/sessions/${session.id}/export.md`)).text();
		assert.match(markdown, /- Type: Standing session/);
	});
});
