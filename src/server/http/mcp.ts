import { Hono } from "hono";
import { invalid } from "../errors.ts";
import type { McpHub, McpStatus } from "../mcp.ts";
import {
	addMcpEntry,
	listMcpEntries,
	type McpEntryView,
	patchMcpEntry,
	removeMcpEntry,
} from "../mcp-config.ts";
import type { Store } from "../store.ts";
import { idempotent } from "./idempotency.ts";
import {
	type Fields,
	optArray,
	optBoolean,
	optObject,
	optString,
	readJson,
	reqString,
} from "./input.ts";
import type { AppEnv } from "./problem.ts";

export interface McpRoutesOptions {
	/** Jig's data folder, where mcp.json is. */
	home: string;
	hub: McpHub;
	log?: (line: string) => void;
}

/** A server in the settings: what mcp.json says about it and how its connection stands. */
export interface McpServerView extends McpEntryView {
	state: McpStatus["state"];
	error: string | null;
	tools: string[];
}

/** Names with text values (null allowed where a value can be removed); anything else is refused. */
function values<T extends string | null>(
	fields: Fields,
	key: "env" | "headers",
	nullable: boolean,
): Record<string, T> | undefined {
	const object = optObject(fields, key);
	if (!object) return undefined;
	for (const [name, value] of Object.entries(object)) {
		if (typeof value !== "string" && !(nullable && value === null)) {
			throw invalid(`The value of ${name} must be text.`, key);
		}
	}
	return object as Record<string, T>;
}

/**
 * The MCP servers in mcp.json (blueprint 6.10, item 29): list them with their connection and tools,
 * add one, turn one off or on, remove one. Each change is written to the file and the running hub
 * reads it again at once. Computer-only: a server is a program this computer starts.
 */
export function mcpRoutes(store: Store, options: McpRoutesOptions): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	const once = idempotent(store.db);
	const { home, hub } = options;

	const shown = (entry: McpEntryView): McpServerView => {
		const status = hub.status().find((server) => server.name === entry.name);
		return {
			...entry,
			// In the file but not read by the hub yet: it is about to be started.
			state: entry.disabled ? "disabled" : (status?.state ?? "connecting"),
			error: entry.disabled ? null : (status?.error ?? null),
			tools: entry.disabled ? [] : (status?.tools ?? []),
		};
	};
	const reload = () => {
		void hub.reload().catch((error: Error) => options.log?.(`mcp: ${error.message}`));
	};

	app.get("/mcp", (c) =>
		c.json({ items: listMcpEntries(home, hub.builtin).map(shown), nextCursor: null }),
	);

	app.post("/mcp", once, async (c) => {
		const fields = await readJson(c);
		const args = optArray(fields, "args");
		if (args?.some((arg) => typeof arg !== "string")) {
			throw invalid("args is a list of text values.", "args");
		}
		const command = optString(fields, "command", 4096);
		const url = optString(fields, "url", 2000);
		const env = values<string>(fields, "env", false);
		const headers = values<string>(fields, "headers", false);
		const entry = addMcpEntry(home, {
			name: reqString(fields, "name", 100),
			...(command !== undefined ? { command } : {}),
			...(args ? { args: args as string[] } : {}),
			...(env ? { env } : {}),
			...(url !== undefined ? { url } : {}),
			...(headers ? { headers } : {}),
		});
		reload();
		return c.json(shown(entry), 201);
	});

	app.patch("/mcp/:name", async (c) => {
		const fields = await readJson(c);
		const disabled = optBoolean(fields, "disabled");
		const env = values<string | null>(fields, "env", true);
		const headers = values<string | null>(fields, "headers", true);
		const entry = patchMcpEntry(
			home,
			c.req.param("name"),
			{
				...(disabled !== undefined ? { disabled } : {}),
				...(env ? { env } : {}),
				...(headers ? { headers } : {}),
			},
			hub.builtin,
		);
		reload();
		return c.json(shown(entry));
	});

	app.delete("/mcp/:name", (c) => {
		removeMcpEntry(home, c.req.param("name"), hub.builtin);
		reload();
		return c.body(null, 204);
	});

	return app;
}
