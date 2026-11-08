import type { Todo } from "../../shared/types.ts";
import {
	errorResult,
	str,
	type ToolDefinition,
	ToolInputError,
	type ToolResult,
	text,
} from "./types.ts";

const STATUSES = ["pending", "in_progress", "done"] as const;

export const todoTool: ToolDefinition = {
	name: "todo",
	description:
		"Keep this session's task list, which the person sees next to the conversation. Send the whole list each time; mark one item in_progress while you work on it and done when finished.",
	parameters: {
		type: "object",
		properties: {
			items: {
				type: "array",
				maxItems: 50,
				items: {
					type: "object",
					properties: {
						text: { type: "string" },
						status: { type: "string", enum: [...STATUSES] },
					},
					required: ["text", "status"],
					additionalProperties: false,
				},
			},
		},
		required: ["items"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const items = args.items;
		if (!Array.isArray(items) || items.length > 50)
			throw new ToolInputError("items must be a list of at most 50.");
		const todos: Todo[] = items.map((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item))
				throw new ToolInputError("Each item needs text and status.");
			const record = item as Record<string, unknown>;
			const status = record.status;
			if (typeof record.text !== "string" || !STATUSES.includes(status as Todo["status"])) {
				throw new ToolInputError(
					"Each item needs text and a status of pending, in_progress or done.",
				);
			}
			return { text: record.text.slice(0, 500), status: status as Todo["status"] };
		});
		ctx.setTodos(todos);
		const marks = { pending: "[ ]", in_progress: "[~]", done: "[x]" } as const;
		const list = todos.map((todo) => `${marks[todo.status]} ${todo.text}`).join("\n");
		return { content: [text(list ? `Task list updated:\n${list}` : "Task list cleared.")] };
	},
};

export const askUserTool: ToolDefinition = {
	name: "ask_user",
	description:
		"Ask the person a question and wait for the answer. Use it when you cannot go on without a decision only they can make. Offer options when the choices are known; they can still answer in their own words.",
	parameters: {
		type: "object",
		properties: {
			question: { type: "string", description: "The question, understandable on its own." },
			options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
		},
		required: ["question"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const question = str(args, "question", true).trim();
		if (!question) return errorResult("The question is empty.");
		const raw = args.options;
		const options = Array.isArray(raw)
			? raw.filter((o): o is string => typeof o === "string").slice(0, 6)
			: undefined;
		const answer = await ctx.ask(
			question.slice(0, 2000),
			options && options.length >= 2 ? options : undefined,
		);
		return { content: [text(`The person answered: ${answer}`)] };
	},
};
