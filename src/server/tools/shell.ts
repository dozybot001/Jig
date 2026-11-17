import { join } from "node:path";
import { startCommand } from "./process.ts";
import {
	bool,
	CONFIRM_ARGUMENT,
	errorResult,
	int,
	str,
	type ToolDefinition,
	type ToolResult,
	text,
} from "./types.ts";

const DEFAULT_TIMEOUT = 120;
const MAX_TIMEOUT = 600;

export const shellTool: ToolDefinition = {
	name: "shell",
	description:
		"Run a command with the user's login shell in the working folder. Standard input is closed, so commands must not wait for input. Output keeps the last 2000 lines or 50 KB; longer output is saved to a file named in the result. Times out after 120 seconds by default (timeout_seconds, up to 600). Set background to start a long-running command, such as a dev server, and check on it with shell_job.",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "The command line to run." },
			description: {
				type: "string",
				description:
					"What the command is for, in a few words in the language the person writes in. Yew shows it to the person when it asks for their permission.",
			},
			timeout_seconds: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT },
			background: { type: "boolean", description: "Start the command and return at once." },
			confirm: CONFIRM_ARGUMENT,
		},
		required: ["command"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: true,
	subject(args) {
		return { kind: "command", tool: "shell", command: str(args, "command", true) };
	},
	preview(args) {
		const description = typeof args.description === "string" ? args.description.trim() : "";
		return description ? { description: description.slice(0, 300) } : {};
	},
	async run(args, ctx): Promise<ToolResult> {
		const command = str(args, "command", true);
		const timeout = int(args, "timeout_seconds", 1, MAX_TIMEOUT) ?? DEFAULT_TIMEOUT;
		const cwd = ctx.session.cwd;
		if (!cwd) return errorResult("This session has no working folder.");
		const logDir = join(ctx.tmpDir, "output");

		if (bool(args, "background")) {
			const job = ctx.jobs.start({ command, cwd, sessionId: ctx.session.id, logDir });
			return {
				content: [
					text(
						`Started in the background as ${job.id}. Use shell_job to read its output or stop it; Yew will tell you when it ends.`,
					),
				],
				detail: { job: job.id },
			};
		}

		const started = Date.now();
		const running = startCommand({
			command,
			cwd,
			sessionId: ctx.session.id,
			logDir,
			onOutput: ctx.output,
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			running.stop();
		}, timeout * 1000);
		const onAbort = () => running.stop();
		ctx.signal.addEventListener("abort", onAbort, { once: true });
		const { exitCode, signal } = await running.done;
		clearTimeout(timer);
		ctx.signal.removeEventListener("abort", onAbort);

		const output = running.output.render();
		const status = timedOut
			? `Stopped after ${timeout} seconds (timeout).`
			: ctx.signal.aborted
				? "Stopped by the user."
				: exitCode === null
					? `Ended by signal ${signal ?? "unknown"}.`
					: `Exit code ${exitCode}.`;
		return {
			content: [text(output ? `${status}\n${output}` : `${status} No output.`)],
			isError: timedOut || exitCode === null,
			detail: {
				exitCode,
				timedOut,
				durationMs: Date.now() - started,
				logFile: running.output.file,
			},
		};
	},
};

export const shellJobTool: ToolDefinition = {
	name: "shell_job",
	description: "Read the output of a command started with background, or stop it.",
	parameters: {
		type: "object",
		properties: {
			job: { type: "string", description: "The job id, such as job-1." },
			action: {
				type: "string",
				enum: ["output", "stop"],
				description: "output (default) or stop.",
			},
		},
		required: ["job"],
		additionalProperties: false,
	},
	readOnly: false,
	needsFolder: true,
	subject() {
		return { kind: "none" };
	},
	async run(args, ctx): Promise<ToolResult> {
		const id = str(args, "job", true);
		const action = str(args, "action") ?? "output";
		const job = ctx.jobs.get(id);
		if (!job) return errorResult(`There is no job ${id} in this session.`);
		if (action === "stop" && !job.finished) {
			job.running.stop();
			await job.running.done;
		}
		const state = job.finished
			? `${id} ended${job.finished.exitCode === null ? "" : ` with exit code ${job.finished.exitCode}`}.`
			: `${id} is still running.`;
		const output = job.running.output.render();
		return { content: [text(output ? `${state}\n${output}` : `${state} No output yet.`)] };
	},
};
