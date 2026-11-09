import type { CardOption, Letter, TaskOutcome } from "../../shared/types.ts";
import { TASK_OUTCOMES } from "../../shared/types.ts";
import { JigError } from "../errors.ts";
import { decisionReport, directoryLine, neutralize } from "../mail/envelope.ts";
import { type CardInput, reasonText } from "../mail/post.ts";
import {
	bool,
	CONFIRM_ARGUMENT,
	errorResult,
	int,
	type MailContext,
	type OrganizeChange,
	str,
	type ToolDefinition,
	ToolInputError,
	type ToolResult,
	text,
	type WaitResult,
} from "./types.ts";

/** Jig's domain errors become messages the model can act on. */
function attempt<T>(fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		if (error instanceof JigError) throw new ToolInputError(error.message);
		throw error;
	}
}

function choice<T extends string>(
	args: Record<string, unknown>,
	key: string,
	values: readonly T[],
): T | undefined {
	const value = args[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || !values.includes(value as T)) {
		throw new ToolInputError(`${key} must be one of: ${values.join(", ")}.`);
	}
	return value as T;
}

function nameOf(mail: MailContext, id: string): string {
	return mail.post.sessionName(id) ?? id;
}

/** What a waiting call returns. The other session's words cannot pass for Jig's own tags. */
function waitText(name: string, result: WaitResult): ToolResult {
	switch (result.kind) {
		case "letter": {
			const letter = result.letter;
			const words = neutralize(`${letter.summary}${letter.body ? `\n\n${letter.body}` : ""}`);
			return {
				content: [text(`${name} wrote back (letter ${letter.id}, ${letter.kind}):\n${words}`)],
			};
		}
		case "ended": {
			const said = neutralize(result.text.trim());
			if (result.stopped) {
				return errorResult(
					`The person stopped ${name} before it finished.${said ? ` Its last reply:\n${said}` : ""} When it goes on, its reply comes to you as a letter.`,
				);
			}
			if (result.status === "error") {
				return errorResult(
					`${name} stopped with an error: ${result.detail ?? "unknown error"}\nWhen it goes on, its reply comes to you as a letter.`,
				);
			}
			return {
				content: [
					text(`${name} finished its turn. Its last reply:\n${said || "(no written reply)"}`),
				],
			};
		}
		case "timeout":
			return {
				content: [
					text(
						`${name} is still working after 30 minutes. Its reply will come to you as a letter.`,
					),
				],
			};
		case "cycle":
			return {
				content: [
					text(
						`Not waiting: ${name} is already waiting for you, directly or through other sessions. The letter was sent; its reply will come to you as a letter.`,
					),
				],
			};
		case "not-running":
			return {
				content: [
					text(
						`${name} is not running (${result.status}); the letter waits until the person continues it. Its reply will come to you as a letter.`,
					),
				],
			};
		case "stopped":
			return errorResult(`Stopped while waiting for ${name}.`);
		case "archived":
			return errorResult(`${name} was archived before it read the letter; it will not answer.`);
	}
}

/** What happened to a letter, for the sender. Undelivered letters are errors so the model notices. */
function sentText(mail: MailContext, letter: Letter): ToolResult | null {
	const name = nameOf(mail, letter.toSession);
	if (letter.status === "refused" || letter.status === "dropped") {
		return errorResult(`Not sent to ${name}: ${reasonText(letter.statusReason)}.`);
	}
	if (letter.status === "held") {
		return {
			content: [
				text(
					`Letter ${letter.id} to ${name} is held: ${reasonText(letter.statusReason)}. The person can release it in the approval center; do not send it again.`,
				),
			],
		};
	}
	return null;
}

function letterDetail(mail: MailContext, letter: Letter) {
	return {
		letterId: letter.id,
		to: letter.toSession,
		toName: nameOf(mail, letter.toSession),
		kind: letter.kind,
		status: letter.status,
		...(letter.statusReason ? { reason: letter.statusReason } : {}),
	};
}

export const listSessionsTool: ToolDefinition = {
	name: "list_sessions",
	description:
		"List the sessions that can receive letters (id, name, kind, status, team, and the first line of each role) and the teams. Letters are addressed by id.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	readOnly: true,
	needsFolder: false,
	subject() {
		return { kind: "none" };
	},
	async run(_args, ctx): Promise<ToolResult> {
		const post = ctx.mail.post;
		const { sessions, groups } = post.directory();
		const main = post.mainSessionId();
		const lines = sessions.map((session) =>
			directoryLine(session, {
				you: session.id === ctx.session.id,
				main: session.id === main,
				parentName: session.parentId ? nameOf(ctx.mail, session.parentId) : null,
				group: session.groupId ? (groups.get(session.groupId) ?? null) : null,
			}),
		);
		const teams = [...groups].map(([id, name]) => `- ${id} · ${name}`);
		return {
			content: [
				text(
					`Sessions (id · name · kind · status):\n${lines.join("\n")}\n\nTeams (id · name):\n${teams.length > 0 ? teams.join("\n") : "(none)"}`,
				),
			],
		};
	},
};

export const sendLetterTool: ToolDefinition = {
	name: "send_letter",
	description:
		"Send a letter to another session by its id. A notice is for information; a request asks the recipient to do or answer something, and its final reply comes back to you as a letter; a report gives the result of something you were asked. When you answer a letter, give its id as reply_to. With wait, this call waits until the recipient replies to this letter or finishes its turn (at most 30 minutes) and returns its answer. Write the summary so it makes sense on its own, and do not write only to acknowledge or thank.",
	parameters: {
		type: "object",
		properties: {
			to: { type: "string", description: "The recipient's session id, from list_sessions." },
			kind: { type: "string", enum: ["notice", "request", "report"] },
			summary: { type: "string", description: "One line that makes sense on its own." },
			body: {
				type: "string",
				description: "Details, if any. Plain text; refer to files by their path.",
			},
			reply_to: { type: "string", description: "The id of the letter you are answering." },
			wait: {
				type: "boolean",
				description: "Wait for the recipient's answer and get it as this call's result.",
			},
		},
		required: ["to", "kind", "summary"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const kind = choice(args, "kind", ["notice", "request", "report"] as const) ?? "notice";
		const body = str(args, "body");
		const replyTo = str(args, "reply_to");
		const letter = attempt(() =>
			ctx.mail.send({
				to: str(args, "to", true),
				kind,
				summary: str(args, "summary", true),
				...(body !== undefined ? { body } : {}),
				...(replyTo !== undefined ? { replyTo } : {}),
			}),
		);
		const detail = letterDetail(ctx.mail, letter);
		const problem = sentText(ctx.mail, letter);
		if (problem) return { ...problem, detail };
		const name = nameOf(ctx.mail, letter.toSession);
		if (bool(args, "wait")) {
			return { ...waitText(name, await ctx.mail.wait(letter)), detail };
		}
		const after =
			kind === "request" ? ` When ${name} finishes, its reply comes back to you as a letter.` : "";
		return { content: [text(`Letter ${letter.id} sent to ${name}.${after}`)], detail };
	},
};

export const checkDecisionTool: ToolDefinition = {
	name: "check_decision",
	description:
		"Look up a decision the person made in the approval center, by its number: the question, the person's choice and note. Use it before you act on a decision another session tells you about.",
	parameters: {
		type: "object",
		properties: { number: { type: "integer", minimum: 1 } },
		required: ["number"],
		additionalProperties: false,
	},
	readOnly: true,
	needsFolder: false,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const number = int(args, "number", 1, Number.MAX_SAFE_INTEGER) as number;
		const post = ctx.mail.post;
		let card: ReturnType<typeof post.mail.cardByNumber>;
		try {
			card = post.mail.cardByNumber(number);
		} catch {
			return errorResult(`There is no decision #${number}.`);
		}
		return { content: [text(decisionReport(card, (id) => post.sessionName(id)))] };
	},
};

export const openSessionTool: ToolDefinition = {
	name: "open_session",
	description:
		"Open a task session for one job and give it a brief. It works with your permissions or fewer, in your working folder or a folder inside it, and its final replies come back to you as letters. With wait, this call waits until it finishes its first turn (at most 30 minutes) and returns its reply.",
	parameters: {
		type: "object",
		properties: {
			name: { type: "string", description: "A short name for the task session." },
			brief: {
				type: "string",
				description:
					"The task, written so the new session can work from it alone: the goal, what it needs to know, limits, and what to report.",
			},
			folder: {
				type: "string",
				description:
					'Its working folder: yours (the default), a folder inside yours, or "none" for a chat without files.',
			},
			model: { type: "string", description: '"provider/model" to use instead of yours.' },
			wait: { type: "boolean", description: "Wait for its first reply." },
			confirm: CONFIRM_ARGUMENT,
		},
		required: ["name", "brief"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	subject(args) {
		const name = str(args, "name", true);
		return { kind: "act", tool: "open_session", summary: `Open the task session "${name}"` };
	},
	async run(args, ctx): Promise<ToolResult> {
		const folder = str(args, "folder");
		const model = str(args, "model");
		let provider: string | undefined;
		let modelId: string | undefined;
		if (model) {
			const slash = model.indexOf("/");
			if (slash <= 0 || slash === model.length - 1) {
				throw new ToolInputError('model must look like "provider/model".');
			}
			provider = model.slice(0, slash);
			modelId = model.slice(slash + 1);
		}
		const opened = attempt(() =>
			ctx.mail.open({
				name: str(args, "name", true),
				brief: str(args, "brief", true),
				...(folder === undefined ? {} : { cwd: folder === "none" ? null : folder }),
				...(provider && modelId ? { provider, model: modelId } : {}),
			}),
		);
		const detail = {
			sessionId: opened.session.id,
			name: opened.session.name,
			letterId: opened.letter.id,
		};
		const problem = sentText(ctx.mail, opened.letter);
		if (problem) return { ...problem, detail };
		if (bool(args, "wait")) {
			return { ...waitText(opened.session.name, await ctx.mail.wait(opened.letter)), detail };
		}
		return {
			content: [
				text(
					`Opened the task session "${opened.session.name}" (id ${opened.session.id}). It starts on the brief now; its report comes back to you as a letter.`,
				),
			],
			detail,
		};
	},
};

const ORGANIZE_ACTIONS = ["rename_session", "create_team", "rename_team", "move_to_team"] as const;

/** The changes an organize_sessions call asks for, checked for shape; the runner checks the rest. */
function organizeChanges(args: Record<string, unknown>): OrganizeChange[] {
	const list = args.changes;
	if (!Array.isArray(list) || list.length === 0)
		throw new ToolInputError("changes must list at least one change.");
	if (list.length > 50) throw new ToolInputError("Give at most 50 changes in one call.");
	return list.map((item, index) => {
		if (!item || typeof item !== "object")
			throw new ToolInputError(`changes[${index}] must be an object.`);
		const change = item as Record<string, unknown>;
		const action = choice(change, "action", ORGANIZE_ACTIONS);
		const field = (key: string) => {
			const value = change[key];
			if (typeof value !== "string" || !value.trim()) {
				throw new ToolInputError(`changes[${index}].${key} is required for ${action}.`);
			}
			return value.trim();
		};
		switch (action) {
			case "rename_session":
				return { action, session: field("session"), name: field("name") };
			case "create_team":
				return { action, name: field("name") };
			case "rename_team":
				return { action, team: field("team"), name: field("name") };
			case "move_to_team": {
				const sessions = change.sessions;
				if (
					!Array.isArray(sessions) ||
					sessions.length === 0 ||
					sessions.some((id) => typeof id !== "string")
				) {
					throw new ToolInputError(`changes[${index}].sessions must list session ids.`);
				}
				const team =
					typeof change.team === "string" && change.team.trim() ? change.team.trim() : null;
				return { action, sessions: sessions as string[], team };
			}
			default:
				throw new ToolInputError(
					`changes[${index}].action must be one of: ${ORGANIZE_ACTIONS.join(", ")}.`,
				);
		}
	});
}

/** One line per change, with session names, for the person's approval and the result. */
function describeChange(change: OrganizeChange, names: (id: string) => string | null): string {
	const name = (id: string) => `"${names(id) ?? id}"`;
	switch (change.action) {
		case "rename_session":
			return `Rename ${name(change.session)} to "${change.name}"`;
		case "create_team":
			return `Create the team "${change.name}"`;
		case "rename_team":
			return `Rename the team "${change.team}" to "${change.name}"`;
		case "move_to_team":
			return change.team
				? `Move ${change.sessions.map(name).join(", ")} into the team "${change.team}"`
				: `Take ${change.sessions.map(name).join(", ")} out of their team`;
	}
}

export const organizeSessionsTool: ToolDefinition = {
	name: "organize_sessions",
	description:
		"Keep the person's sessions in order: rename sessions, create and rename teams, and move sessions into or out of teams. Put every change in one call; Jig checks them all and applies all or none. Name sessions by id and teams by id or exact name (list_sessions shows both); a team created earlier in the call can be used by name. Working folders, models, permissions and how sessions receive letters stay the person's.",
	parameters: {
		type: "object",
		properties: {
			changes: {
				type: "array",
				minItems: 1,
				maxItems: 50,
				items: {
					type: "object",
					properties: {
						action: { type: "string", enum: [...ORGANIZE_ACTIONS] },
						session: { type: "string", description: "rename_session: the session's id." },
						sessions: {
							type: "array",
							items: { type: "string" },
							description: "move_to_team: the sessions' ids.",
						},
						team: {
							type: "string",
							description:
								"rename_team, move_to_team: the team's id or exact name. For move_to_team, leave it out to take the sessions out of their team.",
						},
						name: {
							type: "string",
							description: "rename_session, create_team, rename_team: the new name.",
						},
					},
					required: ["action"],
					additionalProperties: false,
				},
			},
			confirm: CONFIRM_ARGUMENT,
		},
		required: ["changes"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	offered: (_session, roles) => roles.canOrganize,
	subject(args, _session, names = () => null) {
		const lines = organizeChanges(args).map((change) => `- ${describeChange(change, names)}`);
		return {
			kind: "act",
			tool: "organize_sessions",
			summary: `Organize sessions:\n${lines.join("\n")}`,
		};
	},
	async run(args, ctx): Promise<ToolResult> {
		const done = attempt(() => ctx.mail.organize(organizeChanges(args)));
		return {
			content: [
				text(
					done.length > 0
						? `Done:\n${done.map((line) => `- ${line}`).join("\n")}`
						: "Nothing needed changing.",
				),
			],
			detail: { changes: done.length },
		};
	},
};

export const finishTaskTool: ToolDefinition = {
	name: "finish_task",
	description:
		"Record how your task ended: done, given_up or failed. Then end your turn with your report: the result, what changed, how you checked it, and what is left.",
	parameters: {
		type: "object",
		properties: { result: { type: "string", enum: [...TASK_OUTCOMES] } },
		required: ["result"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	offered: (session) => session.kind === "task",
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const outcome = choice(args, "result", TASK_OUTCOMES) as TaskOutcome;
		if (!outcome) throw new ToolInputError("result is required.");
		const session = ctx.mail.finish(outcome);
		const to = session.parentId
			? `It goes to ${nameOf(ctx.mail, session.parentId)}.`
			: "The person reads it here.";
		return { content: [text(`Recorded: ${outcome}. Now end your turn with your report. ${to}`)] };
	},
};

const CARD_PROPERTIES = {
	title: { type: "string", description: "The question to decide, short enough for one line." },
	context: {
		type: "string",
		description:
			"What the person needs to know to decide without opening any session, in two or three short sentences. Do not repeat the options, the deadline or whether it can be undone.",
	},
	options: {
		type: "array",
		maxItems: 6,
		description:
			"The choices. Do not add one for other answers: the person can always write a note.",
		items: {
			type: "object",
			properties: {
				label: { type: "string", description: "A few words, such as the action to take." },
				detail: {
					type: "string",
					description:
						"What happens if the person picks it, in a short sentence. Leave it out when the label says it.",
				},
			},
			required: ["label"],
			additionalProperties: false,
		},
	},
	recommended: {
		type: "integer",
		minimum: 1,
		description: "The option you recommend, counting from 1.",
	},
	deadline: {
		type: "string",
		description:
			'When it must be decided, in a few words, such as "2026-11-12" or "before the release".',
	},
	sessions: {
		type: "array",
		items: { type: "string" },
		description: "Ids of other sessions involved, besides the one that asked and you.",
	},
	undoable: {
		type: "boolean",
		description: "Whether the decision can be undone after it is carried out.",
	},
	reversible: {
		type: "string",
		description:
			"How to undo it, or what cannot be undone, in a few words. Leave it out when that is obvious.",
	},
	after: {
		type: "string",
		description:
			"Who does what once it is decided, when the options do not say it. Leave it out when the decision only goes back to the session that asked.",
	},
} as const;

function cardInput(args: Record<string, unknown>): CardInput {
	const input: CardInput = {};
	for (const key of ["title", "context", "deadline", "reversible", "after"] as const) {
		const value = args[key];
		if (value !== undefined) {
			if (typeof value !== "string") throw new ToolInputError(`${key} must be text.`);
			input[key] = value;
		}
	}
	if (args.options !== undefined) {
		if (!Array.isArray(args.options)) throw new ToolInputError("options must be a list.");
		input.options = args.options.map((option) => {
			if (!option || typeof option !== "object")
				throw new ToolInputError("Each option needs a label.");
			const { label, detail } = option as Record<string, unknown>;
			if (typeof label !== "string") throw new ToolInputError("Each option needs a label.");
			return (typeof detail === "string" && detail ? { label, detail } : { label }) as CardOption;
		});
	}
	if (args.recommended !== undefined) {
		const value = args.recommended;
		if (value === null) input.recommended = null;
		else if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
			throw new ToolInputError("recommended must count from 1.");
		} else input.recommended = value - 1;
	}
	if (args.undoable !== undefined) {
		if (typeof args.undoable !== "boolean")
			throw new ToolInputError("undoable must be true or false.");
		input.undoable = args.undoable;
	}
	if (args.sessions !== undefined) {
		if (!Array.isArray(args.sessions) || args.sessions.some((id) => typeof id !== "string")) {
			throw new ToolInputError("sessions must be a list of session ids.");
		}
		input.sessions = args.sessions as string[];
	}
	return input;
}

const maintainers = (_session: unknown, roles: { canPostCards: boolean }) => roles.canPostCards;

function cardText(number: number, title: string, verb: string): ToolResult {
	return { content: [text(`#${number} ${verb}: ${title}`)] };
}

export const postCardTool: ToolDefinition = {
	name: "post_card",
	description:
		"Put a decision card in the approval center for the person. Keep it short enough to take in at a glance: the question in one line, a few sentences of context, the options with the one you recommend, the deadline if there is one, and whether it can be undone. Say each thing once. The person's decision goes to the requesting session and to you.",
	parameters: {
		type: "object",
		properties: {
			...CARD_PROPERTIES,
			requested_by: {
				type: "string",
				description:
					"The id of the session whose request this is; the decision goes back to it. Leave it out when the question is yours.",
			},
			replaces: {
				type: "array",
				items: { type: "integer" },
				description: "Numbers of waiting cards this one replaces; they are withdrawn.",
			},
		},
		required: ["title", "undoable"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	offered: maintainers,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const requestedBy = str(args, "requested_by");
		const replaces = args.replaces;
		if (
			replaces !== undefined &&
			(!Array.isArray(replaces) || replaces.some((n) => !Number.isInteger(n)))
		) {
			throw new ToolInputError("replaces must be a list of card numbers.");
		}
		const card = attempt(() =>
			ctx.mail.post.postCard(ctx.session, {
				...cardInput(args),
				...(requestedBy ? { requestedBy } : {}),
				...(replaces ? { replaces: replaces as number[] } : {}),
			}),
		);
		return {
			...cardText(card.number, card.title, "is in the approval center"),
			detail: { cardNumber: card.number },
		};
	},
};

export const updateCardTool: ToolDefinition = {
	name: "update_card",
	description:
		"Change a card that is still waiting for the person. Give its number and only the fields that change.",
	parameters: {
		type: "object",
		properties: { number: { type: "integer", minimum: 1 }, ...CARD_PROPERTIES },
		required: ["number"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	offered: maintainers,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const number = int(args, "number", 1, Number.MAX_SAFE_INTEGER) as number;
		const card = attempt(() => ctx.mail.post.updateCard(ctx.session, number, cardInput(args)));
		return { ...cardText(card.number, card.title, "was updated"), detail: { cardNumber: number } };
	},
};

export const withdrawCardTool: ToolDefinition = {
	name: "withdraw_card",
	description:
		"Take a card that no longer needs deciding out of the approval center, with the reason.",
	parameters: {
		type: "object",
		properties: { number: { type: "integer", minimum: 1 }, reason: { type: "string" } },
		required: ["number", "reason"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: false,
	offered: maintainers,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const number = int(args, "number", 1, Number.MAX_SAFE_INTEGER) as number;
		const card = attempt(() =>
			ctx.mail.post.withdrawCard(ctx.session, number, str(args, "reason", true)),
		);
		return {
			...cardText(card.number, card.title, "was withdrawn"),
			detail: { cardNumber: number },
		};
	},
};

export const listCardsTool: ToolDefinition = {
	name: "list_cards",
	description: "List the cards waiting in the approval center and the ten latest decisions.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	readOnly: true,
	needsFolder: false,
	offered: maintainers,
	subject() {
		return { kind: "none" };
	},
	async run(_args, ctx): Promise<ToolResult> {
		const post = ctx.mail.post;
		const names = (id: string) => post.sessionName(id);
		const pending = post.mail.pendingCards();
		const decided = post.mail.listCards({ status: "decided", limit: 10 }).items;
		const parts = [
			pending.length > 0
				? `Waiting for the person:\n\n${pending.map((card) => decisionReport(card, names)).join("\n\n")}`
				: "No cards are waiting for the person.",
		];
		if (decided.length > 0) {
			parts.push(
				`Latest decisions:\n\n${decided.map((card) => decisionReport(card, names)).join("\n\n")}`,
			);
		}
		return { content: [text(parts.join("\n\n"))] };
	},
};
