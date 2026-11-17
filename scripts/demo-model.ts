/**
 * A scripted stand-in for a model provider, for demos and App Review recordings: it speaks the
 * OpenAI chat API on 127.0.0.1 and answers a few requests the same way every time, so a recorded
 * walk-through can be repeated. Add it to a throwaway Jig as a custom provider with the base URL
 * http://127.0.0.1:<port>/v1 and no key. It never calls a real model.
 *
 * What it does, by the last message it is sent:
 * - a request to clean up the drafts folder: runs `rm drafts/old-home.html` (Jig asks first);
 * - a request for release notes: asks which version they are for, then saves them as an artifact;
 * - a request to run the tests: runs `npm test` and reports how many passed;
 * - anything else: a short acknowledgement.
 *
 *   node scripts/demo-model.ts [port]
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message = {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | { type: string; text?: string }[] | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
};
type Reply = { text?: string; call?: { name: string; args: Record<string, unknown> } };

const textOf = (message: Message | undefined): string =>
	typeof message?.content === "string"
		? message.content
		: (message?.content ?? []).map((part) => part.text ?? "").join("\n");

const chinese = (text: string) => /[一-鿿]/.test(text);

/** What the stand-in says next, given the conversation so far. */
export function nextReply(messages: Message[]): Reply {
	const last = messages.at(-1);
	if (last?.role === "tool") {
		const call = messages
			.flatMap((message) => message.tool_calls ?? [])
			.find((item) => item.id === last.tool_call_id);
		const args = JSON.parse(call?.function.arguments || "{}") as Record<string, unknown>;
		const result = textOf(last);
		const asked = textOf(messages.findLast((message) => message.role === "user"));
		const zh = chinese(asked);
		if (/declined|stopped|Not run/i.test(result)) {
			return { text: zh ? "好的，没有动它。" : "OK, I left it as it is." };
		}
		if (call?.function.name === "shell" && String(args.command).startsWith("rm ")) {
			return {
				text: zh
					? "已删除 drafts/old-home.html，草稿文件夹空了，发布时不会带上它。"
					: "Removed drafts/old-home.html. The drafts folder is empty now, so it won't ship with the release.",
			};
		}
		if (call?.function.name === "shell") {
			const passed = /(?:#|ℹ) pass (\d+)/.exec(result)?.[1];
			const failed = Number(/(?:#|ℹ) fail (\d+)/.exec(result)?.[1] ?? 0);
			if (passed && failed === 0) {
				return { text: zh ? `测试全部通过，共 ${passed} 项。` : `All ${passed} tests pass.` };
			}
			return { text: zh ? "测试跑完了，结果在上面。" : "The tests ran; the output is above." };
		}
		if (call?.function.name === "ask_user") {
			const version = /\d+\.\d+\.\d+/.exec(result)?.[0] ?? "1.2.0";
			return {
				call: {
					name: "save_artifact",
					args: {
						name: `Release notes ${version}`,
						kind: "markdown",
						content: `# Website ${version}\n\n- New contact page.\n- Faster image loading on the home page.\n- The old draft home page is gone.\n`,
					},
				},
			};
		}
		if (call?.function.name === "save_artifact") {
			return {
				text: "The release notes are saved. Open them from the artifacts page.",
			};
		}
		return { text: "Done." };
	}
	const said = textOf(last);
	const zh = chinese(said);
	if (/draft|草稿/i.test(said)) {
		return {
			text: zh ? "我来删掉旧的草稿页。" : "I'll remove the old draft page.",
			call: {
				name: "shell",
				args: {
					command: "rm drafts/old-home.html",
					description: zh ? "删掉旧的草稿页" : "Remove the old draft page",
				},
			},
		};
	}
	if (/release notes|发布说明/i.test(said)) {
		return {
			call: {
				name: "ask_user",
				args: {
					questions: [
						{
							header: "Version",
							question: "Which version should the release notes cover?",
							options: [
								{ label: "1.2.0", detail: "The release going out this week." },
								{ label: "1.1.1", detail: "The fix released last week." },
							],
							recommended: 1,
						},
					],
				},
			},
		};
	}
	if (/test|测试/i.test(said)) {
		return {
			call: {
				name: "shell",
				args: { command: "npm test", description: zh ? "跑测试" : "Run the tests" },
			},
		};
	}
	return { text: zh ? "收到。" : "Got it." };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes a reply as a stream of small pieces, as a real model does. */
async function stream(res: ServerResponse, reply: Reply): Promise<void> {
	const meta = {
		id: `demo-${Date.now()}`,
		object: "chat.completion.chunk",
		created: 0,
		model: "demo-1",
	};
	const chunk = (delta: object, finish: string | null = null) =>
		res.write(
			`data: ${JSON.stringify({ ...meta, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
		);
	res.writeHead(200, { "Content-Type": "text/event-stream" });
	await pause(700);
	chunk({ role: "assistant", content: "" });
	for (const piece of (reply.text ?? "").match(/\S+\s*|[一-鿿]{1,3}/g) ?? []) {
		chunk({ content: piece });
		await pause(45);
	}
	if (reply.call) {
		chunk({
			tool_calls: [
				{
					index: 0,
					id: `call_${Date.now()}`,
					type: "function",
					function: { name: reply.call.name, arguments: JSON.stringify(reply.call.args) },
				},
			],
		});
	}
	res.write(
		`data: ${JSON.stringify({ ...meta, choices: [{ index: 0, delta: {}, finish_reason: reply.call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })}\n\n`,
	);
	res.end("data: [DONE]\n\n");
}

export function startDemoModel(port: number): Promise<Server> {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (piece: Buffer) => {
			body += piece.toString("utf8");
		});
		req.on("end", () => {
			let messages: Message[] = [];
			try {
				messages = (JSON.parse(body) as { messages?: Message[] }).messages ?? [];
			} catch {
				// An empty conversation gets the plain acknowledgement.
			}
			void stream(res, nextReply(messages));
		});
	});
	return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const port = Number(process.argv[2] ?? 8798);
	await startDemoModel(port);
	process.stderr.write(`demo model at http://127.0.0.1:${port}/v1\n`);
}
