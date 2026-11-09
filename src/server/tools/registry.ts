import type { Session } from "../../shared/types.ts";
import type { ToolSpec } from "../model/gateway.ts";
import { editTool, readTool, writeTool } from "./files.ts";
import {
	checkDecisionTool,
	finishTaskTool,
	listCardsTool,
	listSessionsTool,
	openSessionTool,
	organizeSessionsTool,
	postCardTool,
	sendLetterTool,
	updateCardTool,
	withdrawCardTool,
} from "./mail.ts";
import { askUserTool, todoTool } from "./misc.ts";
import { globTool, grepTool } from "./search.ts";
import { shellJobTool, shellTool } from "./shell.ts";
import type { Roles, ToolDefinition } from "./types.ts";
import { webFetchTool } from "./web.ts";

export const ALL_TOOLS: ToolDefinition[] = [
	readTool,
	writeTool,
	editTool,
	globTool,
	grepTool,
	shellTool,
	shellJobTool,
	todoTool,
	askUserTool,
	webFetchTool,
	listSessionsTool,
	sendLetterTool,
	checkDecisionTool,
	openSessionTool,
	finishTaskTool,
	organizeSessionsTool,
	postCardTool,
	updateCardTool,
	withdrawCardTool,
	listCardsTool,
];

/**
 * Sessions without a working folder are chats: no file or shell tools (blueprint, principle 1). Some
 * tools depend on the session's place: card tools for the main conversation, finish_task for tasks.
 */
export function toolsFor(
	session: Session,
	tools: ToolDefinition[] = ALL_TOOLS,
	roles: Roles = { canPostCards: false, canOrganize: false },
): ToolDefinition[] {
	return tools.filter(
		(tool) =>
			(session.cwd !== null || !tool.needsFolder) && (tool.offered?.(session, roles) ?? true),
	);
}

export function specs(tools: ToolDefinition[]): ToolSpec[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}
