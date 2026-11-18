import type {
	AssistantMessage,
	ImageBlock,
	Notice,
	ToolCallBlock,
	ToolResultMessage,
	UserMessage,
} from "../shared/messages.ts";
import { askedQuestion } from "../shared/messages.ts";
import type { Entry, Session, ToolCallStatus, ToolCallView } from "../shared/types.ts";
import { isOwnNote } from "./agent/context.ts";
import { dollars } from "./budget.ts";

export type ExportLanguage = "zh" | "en";

interface ExportStrings {
	separator: string;
	sessionId: string;
	kind: string;
	kindStanding: string;
	kindTask: string;
	group: string;
	noGroup: string;
	workspace: string;
	chat: string;
	model: string;
	created: string;
	exported: string;
	usage: string;
	token: string;
	role: string;
	you: string;
	thinking: string;
	status: string;
	toolCall: string;
	arguments: string;
	result: string;
	changes: string;
	summary: string;
	instructionsUpdated: string;
	image: string;
	stopped: string;
	modelChanged: string;
	restarted: string;
	changed: string;
	compacted: string;
	modelError: string;
	compactFailed: string;
	budgetReached: string;
	reviewed: string;
	hookError: string;
	hookBlocked: string;
	budgetWarning: string;
	budgetSession: string;
	budgetAll: string;
	missingKey: string;
	error: string;
	jobFinished: string;
	jobExit: string;
	toolStatus: Record<ToolCallStatus, string>;
	/** The verb shown before a tool's target; `running` is used while the call is in flight. */
	tools: Record<string, { done: string; running: string }>;
}

const ZH: ExportStrings = {
	separator: "：",
	sessionId: "会话 ID",
	kind: "类型",
	kindStanding: "常设会话",
	kindTask: "任务会话",
	group: "团队",
	noGroup: "不属于团队",
	workspace: "工作区",
	chat: "聊天",
	model: "模型",
	created: "创建",
	exported: "导出",
	usage: "用量",
	token: "token",
	role: "职责说明",
	you: "你",
	thinking: "思考过程",
	status: "状态",
	toolCall: "工具调用",
	arguments: "参数",
	result: "结果",
	changes: "改动",
	summary: "较早记录的摘要",
	instructionsUpdated: "说明文件有更新",
	image: "图片",
	stopped: "已停止",
	modelChanged: "换了模型",
	restarted: "Yew Harness 重启时这个会话在干活，已标为待核对。检查过后点「继续」接着运行。",
	changed: "{by} 改了这个会话的设置",
	compacted: "较早的记录已压成摘要",
	modelError: "模型请求失败",
	compactFailed: "压缩上下文失败",
	budgetReached: "今天的费用到了{scope}每日上限（{spent} / {limit}），已停下",
	reviewed: "自动检查放行了：{summary}（{reason}）",
	hookError: "hook 出错了（{event}）：{text}",
	hookBlocked: "hook 拦下了这条消息：{text}",
	budgetWarning: "今天的费用超过了{scope}每日上限的 80%（{spent} / {limit}）",
	budgetSession: "这个会话的",
	budgetAll: "全部会话的",
	missingKey: "没有 {provider} 的 API Key",
	error: "出错",
	jobFinished: "后台任务 {job}（{command}）结束了{exit}。",
	jobExit: "，退出码 {code}",
	toolStatus: {
		pending: "等待",
		waiting: "等你授权",
		running: "执行中",
		done: "完成",
		error: "出错",
		denied: "被拒",
		needs_review: "待核对",
	},
	tools: {
		read: { done: "读取", running: "正在读取" },
		write: { done: "写入", running: "正在写入" },
		edit: { done: "编辑", running: "正在编辑" },
		glob: { done: "查找文件", running: "正在查找文件" },
		grep: { done: "搜索", running: "正在搜索" },
		shell: { done: "运行", running: "正在运行" },
		shell_job: { done: "查看后台任务", running: "正在查看后台任务" },
		todo: { done: "更新任务清单", running: "正在更新任务清单" },
		ask_user: { done: "提问", running: "正在提问" },
		web_fetch: { done: "抓取网页", running: "正在抓取网页" },
	},
};

const EN: ExportStrings = {
	separator: ": ",
	sessionId: "Session ID",
	kind: "Type",
	kindStanding: "Standing session",
	kindTask: "Task session",
	group: "Team",
	noGroup: "No team",
	workspace: "Workspace",
	chat: "Chat",
	model: "Model",
	created: "Created",
	exported: "Exported",
	usage: "Usage",
	token: "tokens",
	role: "Role",
	you: "You",
	thinking: "Thinking",
	status: "Status",
	toolCall: "Tool call",
	arguments: "Arguments",
	result: "Result",
	changes: "Changes",
	summary: "Summary of earlier messages",
	instructionsUpdated: "Instruction files updated",
	image: "Image",
	stopped: "Stopped",
	modelChanged: "Model changed",
	restarted:
		"Yew Harness restarted while this session was working, so it is marked for review. Check it, then choose Continue.",
	changed: "{by} changed this session's settings",
	compacted: "Earlier messages were summarized",
	modelError: "The model request failed",
	compactFailed: "Could not compact the context",
	budgetReached: "Stopped: today's spending reached {scope} daily limit ({spent} of {limit})",
	reviewed: "Allowed by the check: {summary} ({reason})",
	hookError: "A hook failed ({event}): {text}",
	hookBlocked: "A hook stopped this message: {text}",
	budgetWarning: "Today's spending passed 80% of {scope} daily limit ({spent} of {limit})",
	budgetSession: "this session's",
	budgetAll: "the shared",
	missingKey: "There is no API key for {provider}",
	error: "Error",
	jobFinished: "Background job {job} ({command}) ended{exit}.",
	jobExit: " with exit code {code}",
	toolStatus: {
		pending: "Waiting",
		waiting: "Needs your permission",
		running: "Running",
		done: "Done",
		error: "Error",
		denied: "Declined",
		needs_review: "Needs review",
	},
	tools: {
		read: { done: "Read", running: "Reading" },
		write: { done: "Wrote", running: "Writing" },
		edit: { done: "Edited", running: "Editing" },
		glob: { done: "Listed files", running: "Listing files" },
		grep: { done: "Searched", running: "Searching" },
		shell: { done: "Ran", running: "Running" },
		shell_job: { done: "Checked job", running: "Checking job" },
		todo: { done: "Updated tasks", running: "Updating tasks" },
		ask_user: { done: "Asked", running: "Asking" },
		web_fetch: { done: "Fetched", running: "Fetching" },
	},
};

const STRINGS: Record<ExportLanguage, ExportStrings> = { zh: ZH, en: EN };

export interface SessionExportInput {
	session: Session;
	groupName: string | null;
	entries: Entry[];
	toolCalls: ToolCallView[];
	language: ExportLanguage;
	/** The export time; tests fix it. */
	now?: number;
}

/**
 * The whole session as one Markdown file: who the session is and what was said, in order.
 * Tool results are folded into the call they answer, the same way the interface shows them.
 */
export function sessionMarkdown(input: SessionExportInput): string {
	const strings = STRINGS[input.language];
	const now = input.now ?? Date.now();
	const sections: string[] = [`# ${input.session.name}`, metadata(input, strings, now)];
	const responsibility = input.session.responsibility.trim();
	if (responsibility) sections.push(`## ${strings.role}\n\n${responsibility}`);

	const toolCalls = new Map(input.toolCalls.map((call) => [call.callId, call]));
	const toolResults = new Map<string, ToolResultMessage>();
	for (const entry of input.entries) {
		if (entry.role === "toolResult") toolResults.set(entry.message.toolCallId, entry.message);
	}

	for (const entry of input.entries) {
		const rendered = entryMarkdown(entry, input.session, strings, toolCalls, toolResults);
		if (rendered) sections.push(rendered);
	}
	return `${sections.join("\n\n")}\n`;
}

function metadata(input: SessionExportInput, strings: ExportStrings, now: number): string {
	const { session } = input;
	const separator = strings.separator;
	const tokens =
		session.usage.input + session.usage.output + session.usage.cacheRead + session.usage.cacheWrite;
	const lines = [
		`- ${strings.sessionId}${separator}${session.id}`,
		`- ${strings.kind}${separator}${session.kind === "standing" ? strings.kindStanding : strings.kindTask}`,
		`- ${strings.group}${separator}${input.groupName ?? strings.noGroup}`,
		`- ${strings.workspace}${separator}${session.cwd ?? strings.chat}`,
		`- ${strings.model}${separator}${session.provider}/${session.model}`,
		`- ${strings.created}${separator}${formatDateTime(session.createdAt)}`,
		`- ${strings.exported}${separator}${formatDateTime(now)}`,
		`- ${strings.usage}${separator}${formatNumber(tokens, input.language)} ${strings.token} · USD ${formatCost(session.usage.cost)}`,
	];
	return lines.join("\n");
}

function entryMarkdown(
	entry: Entry,
	session: Session,
	strings: ExportStrings,
	toolCalls: Map<string, ToolCallView>,
	toolResults: Map<string, ToolResultMessage>,
): string {
	switch (entry.role) {
		case "user": {
			const text = userText(entry.message, strings);
			// Yew's own notes to the model; the interface hides them and shows the matching notice.
			if (!text || isOwnNote(text)) return "";
			return `## ${strings.you}\n\n${quote(text)}`;
		}
		case "assistant":
			return assistantMarkdown(entry.message, session.name, strings, toolCalls, toolResults);
		case "toolResult":
			// Shown inside the tool call it answers.
			return "";
		case "system":
			return `## ${strings.instructionsUpdated}\n\n${entry.message.content}`;
		case "compaction":
			return `## ${strings.summary}\n\n${entry.compaction.summary}`;
		case "notice":
			return `> ${noticeLine(entry.notice, strings)}`;
	}
}

function assistantMarkdown(
	message: AssistantMessage,
	sessionName: string,
	strings: ExportStrings,
	toolCalls: Map<string, ToolCallView>,
	toolResults: Map<string, ToolResultMessage>,
): string {
	const blocks: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") {
			if (block.text.trim()) blocks.push(block.text);
		} else if (block.type === "thinking") {
			if (block.thinking.trim()) blocks.push(quoteWithLabel(strings.thinking, block.thinking));
		} else {
			const result = toolResults.get(block.id);
			blocks.push(toolCallMarkdown(block, toolCalls.get(block.id), result, strings));
		}
	}
	if (blocks.length === 0) return "";
	return `## ${sessionName}\n\n${blocks.join("\n\n")}`;
}

function toolCallMarkdown(
	call: ToolCallBlock,
	view: ToolCallView | undefined,
	result: ToolResultMessage | undefined,
	strings: ExportStrings,
): string {
	const status: ToolCallStatus =
		view?.status ?? (result ? (result.isError ? "error" : "done") : "pending");
	const running = status === "running";
	const verb = strings.tools[call.name]?.[running ? "running" : "done"] ?? call.name;
	const target = callTarget(call.arguments);
	const title = target ? `${verb} ${target}` : verb;
	const parts = [`### ${strings.toolCall}${strings.separator}${title}`];

	if (status !== "done") {
		parts.push(`**${strings.status}**${strings.separator}${strings.toolStatus[status]}`);
	}
	parts.push(
		`**${strings.arguments}**\n\n${fenced(JSON.stringify(call.arguments, null, 2), "json")}`,
	);

	const diff = view?.detail?.diff;
	if (typeof diff === "string" && diff.trim()) {
		parts.push(`**${strings.changes}**\n\n${fenced(diff, "diff")}`);
	}
	const output = result ? toolResultText(result, strings) : "";
	if (output) parts.push(`**${strings.result}**\n\n${output}`);
	return parts.join("\n\n");
}

function toolResultText(result: ToolResultMessage, strings: ExportStrings): string {
	const parts: string[] = [];
	for (const block of result.content) {
		if (block.type === "text") {
			if (block.text.trim()) parts.push(fenced(block.text, "text"));
		} else {
			parts.push(imageMarkdown(block, strings));
		}
	}
	return parts.join("\n\n");
}

function userText(message: UserMessage, strings: ExportStrings): string {
	if (typeof message.content === "string") return message.content;
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") {
			if (block.text) parts.push(block.text);
		} else {
			parts.push(imageMarkdown(block, strings));
		}
	}
	return parts.join("\n\n");
}

function imageMarkdown(block: ImageBlock, strings: ExportStrings): string {
	return `![${strings.image}](data:${block.mimeType};base64,${block.data})`;
}

function noticeLine(notice: Notice, strings: ExportStrings): string {
	switch (notice.kind) {
		case "interrupted":
			return strings.stopped;
		case "model_changed":
			return `${strings.modelChanged}${strings.separator}${notice.text ?? ""}`;
		case "restarted":
			return strings.restarted;
		case "compacted":
			return strings.compacted;
		case "changed": {
			const by = typeof notice.data?.by === "string" ? notice.data.by : "";
			return strings.changed.replace("{by}", () => by);
		}
		case "budget": {
			const data = notice.data ?? {};
			const amount = (value: unknown) => (typeof value === "number" ? dollars(value) : "");
			return (data.code === "budget-reached" ? strings.budgetReached : strings.budgetWarning)
				.replace("{scope}", data.scope === "session" ? strings.budgetSession : strings.budgetAll)
				.replace("{spent}", () => amount(data.spent))
				.replace("{limit}", () => amount(data.limit));
		}
		case "hook": {
			const data = notice.data ?? {};
			const text = (value: unknown) => (typeof value === "string" ? value : "");
			return (data.kind === "blocked" ? strings.hookBlocked : strings.hookError)
				.replace("{event}", () => text(data.event))
				.replace("{text}", () => text(data.text));
		}
		case "reviewed": {
			const data = notice.data ?? {};
			const text = (value: unknown) => (typeof value === "string" ? value : "");
			return strings.reviewed
				.replace("{summary}", () => text(data.summary))
				.replace("{reason}", () => text(data.reason));
		}
		case "error": {
			const code = typeof notice.data?.code === "string" ? notice.data.code : "";
			if (code === "model-error") {
				return `${strings.modelError}${strings.separator}${notice.text ?? ""}`;
			}
			if (code === "compact-failed") {
				return `${strings.compactFailed}${strings.separator}${notice.text ?? ""}`;
			}
			if (code === "missing-api-key") {
				const provider = typeof notice.data?.provider === "string" ? notice.data.provider : "";
				return strings.missingKey.replace("{provider}", () => provider);
			}
			return `${strings.error}${strings.separator}${notice.text ?? ""}`;
		}
		case "job_finished": {
			const data = notice.data ?? {};
			const job = data.job;
			const command = data.command;
			if (typeof job !== "string" || typeof command !== "string") {
				return notice.text ?? strings.jobFinished;
			}
			const exit =
				typeof data.exitCode === "number"
					? strings.jobExit.replace("{code}", String(data.exitCode))
					: "";
			return strings.jobFinished
				.replace("{job}", () => job)
				.replace("{command}", () => command)
				.replace("{exit}", () => exit);
		}
	}
}

function callTarget(args: ToolCallBlock["arguments"]): string {
	const asked = askedQuestion(args);
	if (asked) return oneLine(asked.question);
	const value = args.command ?? args.path ?? args.pattern ?? args.url ?? args.job;
	return typeof value === "string" ? oneLine(value) : "";
}

/** One line, at most `max` characters, for a heading. */
function oneLine(text: string, max = 140): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const characters = [...flat];
	return characters.length > max ? `${characters.slice(0, max).join("")}…` : flat;
}

/** Every line quoted, so what the person wrote is not read as the assistant's Markdown. */
function quote(text: string): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `> ${line}` : ">"))
		.join("\n");
}

function quoteWithLabel(label: string, text: string): string {
	const lines = [`**${label}**`, "", ...text.split("\n")];
	return lines.map((line) => (line.length > 0 ? `> ${line}` : ">")).join("\n");
}

/** A fenced block whose fence is longer than any run of backticks inside, so the content survives. */
function fenced(text: string, language: string): string {
	let longest = 0;
	for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
	const fence = "`".repeat(Math.max(3, longest + 1));
	return `${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}`;
}

function formatNumber(value: number, language: ExportLanguage): string {
	return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US").format(value);
}

function formatCost(value: number): string {
	return value > 0 && value < 0.01 ? "<0.01" : value.toFixed(2);
}

/** `2026-11-09 14:30 UTC+8`, with the machine's own offset so the time is unambiguous. */
function formatDateTime(ms: number): string {
	const date = new Date(ms);
	const pad = (value: number) => String(value).padStart(2, "0");
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const hours = Math.floor(Math.abs(offset) / 60);
	const minutes = Math.abs(offset) % 60;
	const zone = `UTC${sign}${hours}${minutes > 0 ? `:${pad(minutes)}` : ""}`;
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} ${zone}`;
}

/** A readable file name: the session's name, today's date and `.md`, safe on every platform. */
export function exportFileName(name: string, at = new Date()): string {
	const clean = name
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\p{Cc}/gu, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[. ]+$/, "");
	const base = ([...clean].slice(0, 80).join("") || "session").trim();
	const pad = (value: number) => String(value).padStart(2, "0");
	const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
	return `${base}-${date}.md`;
}
