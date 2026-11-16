import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conflict, invalid, notFound } from "./errors.ts";

/**
 * Changes to `mcp.json` made from the settings (blueprint 6.10, item 29). The file keeps the shape
 * people write by hand and `jig mcp list` reads: entries Jig does not understand, other top-level
 * keys and `${NAME}` references stay as they are. Values of environment variables and headers may
 * be secrets, so what is shown of a server carries their names only.
 */

export const MCP_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const MAX_SERVERS = 50;
const MAX_ARGS = 100;
const MAX_VALUES = 50;
const MAX_VALUE = 8192;

/** One server as the settings show it: how it is started or reached, without any secret value. */
export interface McpEntryView {
	name: string;
	kind: "stdio" | "http";
	/** Set up by Jig itself, not written in mcp.json: it can be turned off, not removed. */
	builtin: boolean;
	disabled: boolean;
	command: string | null;
	args: string[];
	/** Names of the environment variables set for the command; their values are never sent. */
	envNames: string[];
	url: string | null;
	/** Names of the HTTP headers sent to the server; their values are never sent. */
	headerNames: string[];
}

export interface NewMcpServer {
	name: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
}

export interface McpServerPatch {
	disabled?: boolean;
	/** Sets these variables; null removes one. Variables not named stay as they are. */
	env?: Record<string, string | null>;
	headers?: Record<string, string | null>;
}

type Raw = Record<string, unknown>;

interface McpFile {
	doc: Raw;
	servers: Raw;
}

const isObject = (value: unknown): value is Raw =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const mcpFile = (jigHome: string) => join(jigHome, "mcp.json");

/** The file as it is written, with the object that holds the servers (`mcpServers`, or `servers`). */
function readFile(jigHome: string): McpFile {
	const file = mcpFile(jigHome);
	if (!existsSync(file)) {
		const servers: Raw = {};
		return { doc: { mcpServers: servers }, servers };
	}
	let doc: unknown;
	try {
		doc = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		doc = null;
	}
	if (!isObject(doc)) {
		// Not overwritten: the person may have servers in it that a typo is hiding.
		throw conflict(
			"mcp.json in Jig's data folder is not valid JSON. Correct it by hand first.",
			undefined,
			"mcp-unreadable",
		);
	}
	const key = doc.mcpServers === undefined && doc.servers !== undefined ? "servers" : "mcpServers";
	if (doc[key] !== undefined && !isObject(doc[key])) {
		throw conflict(
			`"${key}" in mcp.json is not an object. Correct it by hand first.`,
			undefined,
			"mcp-unreadable",
		);
	}
	const servers = (doc[key] ?? {}) as Raw;
	doc[key] = servers;
	return { doc, servers };
}

/** Written beside the file and moved into place, so a reader never sees half of it. */
function writeFile(jigHome: string, doc: Raw): void {
	const file = mcpFile(jigHome);
	const draft = `${file}.${process.pid}.tmp`;
	// Readable by the person only: values in it may be secrets.
	writeFileSync(draft, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
	renameSync(draft, file);
}

const names = (value: unknown): string[] => (isObject(value) ? Object.keys(value) : []);

function view(name: string, entry: Raw): McpEntryView | null {
	const disabled = entry.disabled === true;
	if (typeof entry.url === "string" && /^https?:\/\//.test(entry.url)) {
		return {
			name,
			kind: "http",
			builtin: false,
			disabled,
			command: null,
			args: [],
			envNames: [],
			url: entry.url,
			headerNames: names(entry.headers),
		};
	}
	if (typeof entry.command === "string" && entry.command) {
		return {
			name,
			kind: "stdio",
			builtin: false,
			disabled,
			command: entry.command,
			args: Array.isArray(entry.args) ? entry.args.filter((arg) => typeof arg === "string") : [],
			envNames: names(entry.env),
			url: null,
			headerNames: [],
		};
	}
	return null;
}

/** What Jig sets up by itself, by name: how each server is started. */
export type BuiltinServers = Record<string, { command?: string; args?: string[] }>;

/** A built-in server as the settings show it; `off` when mcp.json turns it off. */
function builtinView(name: string, builtin: BuiltinServers, off: boolean): McpEntryView {
	return {
		name,
		kind: "stdio",
		builtin: true,
		disabled: off,
		command: builtin[name]?.command ?? null,
		args: builtin[name]?.args ?? [],
		envNames: [],
		url: null,
		headerNames: [],
	};
}

/** In mcp.json a built-in server is either replaced by a full entry or turned off by `disabled`. */
const turnsOff = (entry: unknown): boolean =>
	isObject(entry) && entry.disabled === true && !view("x", entry);

/** The servers Jig runs: its own first, then the file's in the file's order. */
export function listMcpEntries(jigHome: string, builtin: BuiltinServers = {}): McpEntryView[] {
	const { servers } = readFile(jigHome);
	const own = Object.keys(builtin)
		.filter((name) => !Object.hasOwn(servers, name) || turnsOff(servers[name]))
		.map((name) => builtinView(name, builtin, turnsOff(servers[name])));
	const written = Object.entries(servers).flatMap(([name, entry]) => {
		const shown = MCP_NAME.test(name) && isObject(entry) ? view(name, entry) : null;
		return shown ? [shown] : [];
	});
	return [...own, ...written];
}

function checkValues(
	values: Record<string, string | null>,
	pattern: RegExp,
	field: "env" | "headers",
): void {
	const entries = Object.entries(values);
	if (entries.length > MAX_VALUES) throw invalid(`At most ${MAX_VALUES} ${field}.`, field);
	for (const [name, value] of entries) {
		if (!pattern.test(name)) throw invalid(`"${name}" is not a valid name.`, field);
		if (value === null) continue;
		if (typeof value !== "string" || value.length > MAX_VALUE || /[\r\n\0]/.test(value)) {
			throw invalid(`The value of ${name} must be one line of text.`, field);
		}
	}
}

export function addMcpEntry(jigHome: string, input: NewMcpServer): McpEntryView {
	if (!MCP_NAME.test(input.name)) {
		throw invalid("The name uses letters, digits, dashes and underscores, up to 32.", "server");
	}
	const { doc, servers } = readFile(jigHome);
	if (Object.hasOwn(servers, input.name)) {
		throw conflict(`mcp.json already has a server named ${input.name}.`, undefined, "mcp-exists");
	}
	if (Object.keys(servers).length >= MAX_SERVERS) {
		throw invalid(`Up to ${MAX_SERVERS} servers can be set up.`, "server");
	}
	const url = input.url?.trim();
	const command = input.command?.trim();
	if (Boolean(url) === Boolean(command)) {
		throw invalid("Give either a command or a URL.", url ? "url" : "command");
	}
	let entry: Raw;
	if (url) {
		let parsed: URL | null = null;
		try {
			parsed = new URL(url);
		} catch {
			// Reported below.
		}
		if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
			throw invalid("The URL must start with http:// or https://.", "url");
		}
		if (parsed.username || parsed.password) {
			throw invalid("Put credentials in a header, not in the URL.", "url");
		}
		const headers = input.headers ?? {};
		checkValues(headers, HEADER_NAME, "headers");
		entry = { url, ...(Object.keys(headers).length > 0 ? { headers } : {}) };
	} else {
		const args = input.args ?? [];
		if (args.length > MAX_ARGS || args.some((arg) => arg.length > MAX_VALUE || /\0/.test(arg))) {
			throw invalid(`Up to ${MAX_ARGS} arguments.`, "args");
		}
		if ((command as string).length > 4096 || /[\r\n\0]/.test(command as string)) {
			throw invalid("The command must be one line.", "command");
		}
		const env = input.env ?? {};
		checkValues(env, ENV_NAME, "env");
		entry = { command, args, ...(Object.keys(env).length > 0 ? { env } : {}) };
	}
	servers[input.name] = entry;
	writeFile(jigHome, doc);
	return view(input.name, entry) as McpEntryView;
}

function entryOf(servers: Raw, name: string): Raw {
	const entry = Object.hasOwn(servers, name) ? servers[name] : undefined;
	if (!MCP_NAME.test(name) || !isObject(entry) || !view(name, entry)) {
		throw notFound("MCP server", name);
	}
	return entry;
}

export function patchMcpEntry(
	jigHome: string,
	name: string,
	patch: McpServerPatch,
	builtin: BuiltinServers = {},
): McpEntryView {
	const { doc, servers } = readFile(jigHome);
	if (builtin[name] && (!Object.hasOwn(servers, name) || turnsOff(servers[name]))) {
		// One of Jig's own: the file only records that it is off.
		if (patch.env || patch.headers) {
			throw invalid("A server Jig sets up by itself has no variables to set.", "env");
		}
		if (patch.disabled === true) servers[name] = { disabled: true };
		else if (patch.disabled === false) delete servers[name];
		if (patch.disabled !== undefined) writeFile(jigHome, doc);
		return builtinView(name, builtin, turnsOff(servers[name]));
	}
	const entry = entryOf(servers, name);
	const http = typeof entry.url === "string";
	if (patch.disabled === true) entry.disabled = true;
	else if (patch.disabled === false) delete entry.disabled;
	const merge = (key: "env" | "headers", values: Record<string, string | null>) => {
		const next: Raw = isObject(entry[key]) ? { ...entry[key] } : {};
		for (const [field, value] of Object.entries(values)) {
			if (value === null) delete next[field];
			else next[field] = value;
		}
		if (Object.keys(next).length > MAX_VALUES) throw invalid(`At most ${MAX_VALUES} ${key}.`, key);
		if (Object.keys(next).length > 0) entry[key] = next;
		else delete entry[key];
	};
	if (patch.env) {
		if (http) throw invalid("A server reached by URL takes headers, not variables.", "env");
		checkValues(patch.env, ENV_NAME, "env");
		merge("env", patch.env);
	}
	if (patch.headers) {
		if (!http)
			throw invalid("A server started by a command takes variables, not headers.", "headers");
		checkValues(patch.headers, HEADER_NAME, "headers");
		merge("headers", patch.headers);
	}
	writeFile(jigHome, doc);
	return view(name, entry) as McpEntryView;
}

export function removeMcpEntry(jigHome: string, name: string, builtin: BuiltinServers = {}): void {
	const { doc, servers } = readFile(jigHome);
	if (builtin[name] && (!Object.hasOwn(servers, name) || turnsOff(servers[name]))) {
		throw conflict(
			`${name} is set up by Jig itself. It can be turned off, not removed.`,
			undefined,
			"mcp-builtin",
		);
	}
	entryOf(servers, name);
	delete servers[name];
	writeFile(jigHome, doc);
}
