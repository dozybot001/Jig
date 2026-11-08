import type { Session } from "../../shared/types.ts";
import type { ToolSpec } from "../model/gateway.ts";
import { editTool, readTool, writeTool } from "./files.ts";
import { askUserTool, todoTool } from "./misc.ts";
import { globTool, grepTool } from "./search.ts";
import { shellJobTool, shellTool } from "./shell.ts";
import type { ToolDefinition } from "./types.ts";
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
];

/** Sessions without a working folder are chats: no file or shell tools (blueprint, principle 1). */
export function toolsFor(session: Session, tools: ToolDefinition[] = ALL_TOOLS): ToolDefinition[] {
	return tools.filter((tool) => session.cwd !== null || !tool.needsFolder);
}

export function specs(tools: ToolDefinition[]): ToolSpec[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}
