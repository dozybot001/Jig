import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, relative } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { JsonObject } from "../../shared/messages.ts";
import type { Session } from "../../shared/types.ts";
import { resolvePath } from "../permissions/paths.ts";
import { countOccurrences, findUnique } from "./match.ts";
import { MAX_BYTES, MAX_LINES } from "./process.ts";
import {
	bool,
	CONFIRM_ARGUMENT,
	errorResult,
	int,
	str,
	type ToolDefinition,
	ToolInputError,
	type ToolResult,
	text,
} from "./types.ts";

const MAX_LINE_CHARS = 2000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DIFF_CHARS = 200_000;
const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

export function pathArg(args: JsonObject, session: Session, key = "path"): string {
	const raw = str(args, key, true);
	const path = resolvePath(raw, session.cwd);
	if (!path)
		throw new ToolInputError(`${key} must be an absolute path, or relative to the working folder.`);
	return path;
}

/** Paths shown to the model and the person: relative inside the working folder, absolute outside. */
export function display(path: string, session: Session): string {
	if (!session.cwd) return path;
	const rel = relative(session.cwd, path);
	return rel === "" ? "." : rel.startsWith("..") ? path : rel;
}

function numbered(lines: string[], first: number): string {
	const width = String(first + lines.length - 1).length;
	return lines.map((line, index) => `${String(first + index).padStart(width)}\t${line}`).join("\n");
}

function diffDetail(path: string, before: string, after: string, created: boolean): JsonObject {
	let patch = createTwoFilesPatch(path, path, before, after, "", "", { context: 3 });
	let truncated = false;
	if (patch.length > MAX_DIFF_CHARS) {
		patch = patch.slice(0, MAX_DIFF_CHARS);
		truncated = true;
	}
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { path, diff: patch, added, removed, created, truncated };
}

function splitLines(content: string): string[] {
	const lines = content.split(/\r?\n/);
	if (lines.length > 1 && lines.at(-1) === "") lines.pop();
	return lines;
}

export const readTool: ToolDefinition = {
	name: "read",
	description:
		"Read a text file or an image. Text comes back with line numbers. A read stops at 2000 lines or 50 KB; use offset (first line, from 1) and limit (number of lines) to read more. Paths are absolute or relative to the working folder.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "The file to read." },
			offset: { type: "integer", minimum: 1, description: "First line to read, counting from 1." },
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LINES,
				description: "Number of lines to read.",
			},
		},
		required: ["path"],
		additionalProperties: false,
	},
	readOnly: true,
	needsFolder: true,
	subject(args, session) {
		const path = pathArg(args, session);
		return { kind: "read", tool: "read", paths: [path], summary: display(path, session) };
	},
	async run(args, ctx): Promise<ToolResult> {
		const path = pathArg(args, ctx.session);
		const shown = display(path, ctx.session);
		const offset = int(args, "offset", 1, Number.MAX_SAFE_INTEGER) ?? 1;
		const limit = int(args, "limit", 1, MAX_LINES) ?? MAX_LINES;
		if (!existsSync(path)) return errorResult(`There is no file at ${shown}.`);
		const stat = statSync(path);
		if (stat.isDirectory())
			return errorResult(`${shown} is a folder. Use glob to list files in it.`);

		const imageType = IMAGE_TYPES[extname(path).toLowerCase()];
		if (imageType) {
			if (!ctx.acceptsImages) return errorResult("The current model cannot read images.");
			if (stat.size > MAX_IMAGE_BYTES) return errorResult(`${shown} is larger than 5 MB.`);
			const data = readFileSync(path);
			ctx.readState.record(path, data);
			return {
				content: [
					text(`Image ${shown}:`),
					{ type: "image", data: data.toString("base64"), mimeType: imageType },
				],
			};
		}
		if (stat.size > MAX_FILE_BYTES) {
			return errorResult(
				`${shown} is larger than 20 MB. Use grep, or head and tail in the shell, to look inside it.`,
			);
		}
		const data = readFileSync(path);
		if (data.subarray(0, 8192).includes(0)) {
			return errorResult(`${shown} looks like a binary file, so it was not read.`);
		}
		ctx.readState.record(path, data);
		const lines = splitLines(data.toString("utf8").replace(/^﻿/, ""));
		if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
			return { content: [text(`${shown} is empty.`)] };
		}
		if (offset > lines.length) {
			return errorResult(`${shown} has ${lines.length} lines; offset ${offset} is past the end.`);
		}
		const picked: string[] = [];
		let bytes = 0;
		for (let i = offset - 1; i < lines.length && picked.length < limit; i++) {
			let line = lines[i] as string;
			if (line.length > MAX_LINE_CHARS)
				line = `${line.slice(0, MAX_LINE_CHARS)} [line cut at ${MAX_LINE_CHARS} characters]`;
			bytes += Buffer.byteLength(line) + 1;
			if (bytes > MAX_BYTES && picked.length > 0) break;
			picked.push(line);
		}
		const last = offset + picked.length - 1;
		let body = numbered(picked, offset);
		if (last < lines.length) {
			body += `\n[Showing lines ${offset}–${last} of ${lines.length}. Continue with offset ${last + 1}.]`;
		}
		return { content: [text(body)] };
	},
};

export const writeTool: ToolDefinition = {
	name: "write",
	description:
		"Create a file, or replace a whole file. An existing file must have been read in this session first, and must not have changed since. To change part of a file, use edit.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "The file to write." },
			content: { type: "string", description: "The complete new content." },
			confirm: CONFIRM_ARGUMENT,
		},
		required: ["path", "content"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: true,
	subject(args, session) {
		const path = pathArg(args, session);
		return { kind: "write", tool: "write", paths: [path], summary: display(path, session) };
	},
	async run(args, ctx): Promise<ToolResult> {
		const path = pathArg(args, ctx.session);
		const shown = display(path, ctx.session);
		const content = str(args, "content", true);
		const exists = existsSync(path);
		let before = "";
		if (exists) {
			if (statSync(path).isDirectory()) return errorResult(`${shown} is a folder.`);
			const problem = ctx.readState.check(path);
			if (problem) return errorResult(problem);
			before = readFileSync(path, "utf8");
		}
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		ctx.readState.record(path, content);
		const lines = splitLines(content).length;
		return {
			content: [text(`${exists ? "Replaced" : "Created"} ${shown} (${lines} lines).`)],
			detail: diffDetail(shown, before, content, !exists),
		};
	},
};

export const editTool: ToolDefinition = {
	name: "edit",
	description:
		"Replace one piece of text in a file. old_text must match exactly one place, including indentation; add surrounding lines if it is not unique, or set replace_all to change every occurrence. The file must have been read in this session and not changed since.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "The file to change." },
			old_text: { type: "string", description: "The text to replace, copied from the file." },
			new_text: { type: "string", description: "The text to put in its place." },
			replace_all: { type: "boolean", description: "Replace every occurrence of old_text." },
			confirm: CONFIRM_ARGUMENT,
		},
		required: ["path", "old_text", "new_text"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: true,
	subject(args, session) {
		const path = pathArg(args, session);
		return { kind: "write", tool: "edit", paths: [path], summary: display(path, session) };
	},
	async run(args, ctx): Promise<ToolResult> {
		const path = pathArg(args, ctx.session);
		const shown = display(path, ctx.session);
		let oldText = str(args, "old_text", true);
		let newText = str(args, "new_text", true);
		const replaceAll = bool(args, "replace_all") ?? false;
		if (oldText.length === 0) return errorResult("old_text is empty. Use write to create a file.");
		if (oldText === newText) return errorResult("old_text and new_text are the same.");
		if (!existsSync(path)) return errorResult(`There is no file at ${shown}.`);
		const problem = ctx.readState.check(path);
		if (problem) return errorResult(problem);

		const raw = readFileSync(path, "utf8");
		const bom = raw.startsWith("﻿") ? "﻿" : "";
		const body = raw.slice(bom.length);
		// Models write \n; keep a file's \r\n line endings intact.
		if (body.includes("\r\n")) {
			if (!oldText.includes("\r\n")) oldText = oldText.replace(/\n/g, "\r\n");
			if (!newText.includes("\r\n")) newText = newText.replace(/\n/g, "\r\n");
		}

		let updated: string;
		let count = 1;
		let start: number;
		if (replaceAll) {
			count = countOccurrences(body, oldText);
			if (count === 0) {
				return errorResult(
					`old_text was not found in ${shown}. Read the file again and copy the text exactly.`,
				);
			}
			start = body.indexOf(oldText);
			updated = body.split(oldText).join(newText);
		} else {
			const match = findUnique(body, oldText);
			if (!match.ok) {
				return errorResult(
					match.reason === "ambiguous"
						? `old_text appears ${match.count} times in ${shown}. Include more surrounding lines so it matches once, or set replace_all.`
						: `old_text was not found in ${shown}. Read the file again and copy the text exactly, including indentation.`,
				);
			}
			start = match.start;
			updated = body.slice(0, match.start) + newText + body.slice(match.end);
		}
		writeFileSync(path, bom + updated);
		ctx.readState.record(path, bom + updated);

		// Show the changed region so the model can check its work without reading the file again.
		const lines = splitLines(updated);
		const firstLine = body.slice(0, start).split("\n").length;
		const changed = Math.max(1, newText.split("\n").length);
		const from = Math.max(1, firstLine - 2);
		const to = Math.min(lines.length, firstLine + changed + 1);
		const region = numbered(lines.slice(from - 1, to), from);
		return {
			content: [
				text(
					`Edited ${shown}: ${count === 1 ? "1 replacement" : `${count} replacements`}. Lines ${from}–${to} now read:\n${region}`,
				),
			],
			detail: diffDetail(shown, body, updated, false),
		};
	},
};
