import { spawn } from "node:child_process";
import type { JsonObject } from "../../shared/messages.ts";
import type { Session } from "../../shared/types.ts";
import { display, pathArg } from "./files.ts";
import {
	bool,
	errorResult,
	int,
	str,
	type ToolDefinition,
	type ToolResult,
	text,
} from "./types.ts";

const MAX_FILES = 200;
const MAX_MATCHES = 100;
const MAX_MATCH_CHARS = 500;

function searchRoot(args: JsonObject, session: Session): string {
	if (args.path === undefined || args.path === null) return session.cwd ?? "/";
	return pathArg(args, session);
}

/** Runs ripgrep without a shell. `--no-config` keeps a personal ripgreprc from changing results (prior-art 4.2). */
function ripgrep(
	args: string[],
	cwd: string,
	signal: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string; missing: boolean }> {
	return new Promise((resolve) => {
		const child = spawn(
			"rg",
			["--no-config", "--color=never", "--hidden", "--glob", "!.git", ...args],
			{
				cwd,
				signal,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			if (stdout.length > 20_000_000) child.kill();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error: NodeJS.ErrnoException) =>
			resolve({ code: null, stdout, stderr: error.message, missing: error.code === "ENOENT" }),
		);
		child.on("close", (code) => resolve({ code, stdout, stderr, missing: false }));
	});
}

const RG_MISSING =
	"ripgrep (rg) is not installed. Install it, for example with: brew install ripgrep";

export const globTool: ToolDefinition = {
	name: "glob",
	description:
		"Find files by name with a glob pattern such as **/*.ts or src/**/test_*.py. Respects .gitignore. Returns up to 200 paths.",
	parameters: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: "Glob pattern, matched against paths below the search folder.",
			},
			path: { type: "string", description: "Folder to search; defaults to the working folder." },
		},
		required: ["pattern"],
		additionalProperties: false,
	},
	readOnly: true,
	needsFolder: true,
	subject(args, session) {
		const root = searchRoot(args, session);
		return {
			kind: "read",
			tool: "glob",
			paths: [root],
			summary: `${str(args, "pattern", true)} in ${display(root, session)}`,
		};
	},
	async run(args, ctx): Promise<ToolResult> {
		const pattern = str(args, "pattern", true);
		const root = searchRoot(args, ctx.session);
		const result = await ripgrep(
			["--files", "--sort=path", "--glob", pattern, root],
			ctx.session.cwd ?? root,
			ctx.signal,
		);
		if (result.missing) return errorResult(RG_MISSING);
		if (result.code === 2) return errorResult(result.stderr.trim() || "The search failed.");
		const files = result.stdout
			.split("\n")
			.filter((file) => file && !ctx.offLimits?.(file))
			.map((file) => display(file, ctx.session));
		if (files.length === 0) return { content: [text("No files matched.")] };
		const shown = files.slice(0, MAX_FILES).join("\n");
		const more =
			files.length > MAX_FILES
				? `\n[${files.length - MAX_FILES} more not shown. Narrow the pattern.]`
				: "";
		return { content: [text(shown + more)] };
	},
};

interface RgEvent {
	type: string;
	data: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
}

export const grepTool: ToolDefinition = {
	name: "grep",
	description:
		"Search file contents with a regular expression (ripgrep syntax). Respects .gitignore. Returns matching lines with file and line number, up to 100 matches; narrow with path or glob.",
	parameters: {
		type: "object",
		properties: {
			pattern: { type: "string", description: "Regular expression to search for." },
			path: {
				type: "string",
				description: "File or folder to search; defaults to the working folder.",
			},
			glob: { type: "string", description: "Only search files matching this glob, such as *.ts." },
			ignore_case: { type: "boolean", description: "Match regardless of case." },
			context: {
				type: "integer",
				minimum: 0,
				maximum: 5,
				description: "Lines of context around each match.",
			},
		},
		required: ["pattern"],
		additionalProperties: false,
	},
	readOnly: true,
	needsFolder: true,
	subject(args, session) {
		const root = searchRoot(args, session);
		return {
			kind: "read",
			tool: "grep",
			paths: [root],
			summary: `${str(args, "pattern", true)} in ${display(root, session)}`,
		};
	},
	async run(args, ctx): Promise<ToolResult> {
		const pattern = str(args, "pattern", true);
		const root = searchRoot(args, ctx.session);
		const glob = str(args, "glob");
		const context = int(args, "context", 0, 5) ?? 0;
		const rgArgs = ["--json", "--line-number"];
		if (bool(args, "ignore_case")) rgArgs.push("--ignore-case");
		if (glob) rgArgs.push("--glob", glob);
		if (context > 0) rgArgs.push("--context", String(context));
		rgArgs.push("--regexp", pattern, root);
		const result = await ripgrep(rgArgs, ctx.session.cwd ?? root, ctx.signal);
		if (result.missing) return errorResult(RG_MISSING);
		if (result.code === 2 && !result.stdout)
			return errorResult(result.stderr.trim() || "The search failed.");

		const lines: string[] = [];
		let matches = 0;
		let lastFile = "";
		for (const raw of result.stdout.split("\n")) {
			if (!raw) continue;
			let event: RgEvent;
			try {
				event = JSON.parse(raw) as RgEvent;
			} catch {
				continue;
			}
			if (event.type !== "match" && event.type !== "context") continue;
			const file = event.data.path?.text ?? "";
			// What sessions may not read stays out, though the search reached it.
			if (ctx.offLimits?.(file)) continue;
			if (event.type === "match") {
				if (matches >= MAX_MATCHES) {
					matches++;
					continue;
				}
				matches++;
			}
			if (file !== lastFile) {
				if (lines.length > 0) lines.push("");
				lines.push(display(file, ctx.session));
				lastFile = file;
			}
			let line = (event.data.lines?.text ?? "").replace(/\r?\n$/, "");
			if (line.length > MAX_MATCH_CHARS) line = `${line.slice(0, MAX_MATCH_CHARS)}…`;
			lines.push(`${event.data.line_number}${event.type === "match" ? ":" : "-"} ${line}`);
		}
		if (matches === 0) return { content: [text("No matches.")] };
		const more =
			matches > MAX_MATCHES
				? `\n[${matches - MAX_MATCHES} more matches not shown. Narrow the search.]`
				: "";
		return { content: [text(lines.join("\n") + more)] };
	},
};
