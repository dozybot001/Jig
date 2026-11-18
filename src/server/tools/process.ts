import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "../ids.ts";
import { activeSandbox, OUTSIDE_GIT, quote, sandboxed } from "../sandbox.ts";

export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;

/**
 * Keeps the tail of a command's output (2000 lines or 50 KB, prior-art 4.2). Once the output grows past
 * that, everything is also written to a log file, so nothing is lost and the model can read it.
 */
export class OutputTail {
	#tail = "";
	#total = 0;
	#file: string | null = null;
	#dir: string;
	#buffered = "";

	constructor(dir: string) {
		this.#dir = dir;
	}

	push(chunk: string): void {
		this.#total += Buffer.byteLength(chunk);
		this.#tail += chunk;
		if (this.#file) {
			appendFileSync(this.#file, chunk);
		} else {
			this.#buffered += chunk;
			if (Buffer.byteLength(this.#buffered) > MAX_BYTES) {
				mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
				this.#file = join(this.#dir, `${newId()}.log`);
				writeFileSync(this.#file, this.#buffered, { mode: 0o600 });
				this.#buffered = "";
			}
		}
		if (this.#tail.length > MAX_BYTES * 2) this.#tail = this.#tail.slice(-MAX_BYTES * 2);
	}

	get file(): string | null {
		return this.#file;
	}

	/** The kept tail, cut at a line boundary, with a note when output was dropped. */
	render(): string {
		let text = this.#tail;
		let truncated = this.#file !== null;
		let lines = text.split("\n");
		if (lines.length > MAX_LINES) {
			lines = lines.slice(-MAX_LINES);
			truncated = true;
		}
		text = lines.join("\n");
		while (Buffer.byteLength(text) > MAX_BYTES) {
			const cut = text.indexOf("\n");
			text = cut < 0 ? text.slice(-MAX_BYTES) : text.slice(cut + 1);
			truncated = true;
		}
		if (!truncated) return text;
		const where = this.#file ? ` The full output (${this.#total} bytes) is in ${this.#file}.` : "";
		return `[Earlier output was cut; showing the last part.${where}]\n${text}`;
	}
}

/** Provider keys Yew keeps out of commands' environment (AGENTS.md: keys stay in the keychain). */
const KEY_VARIABLES =
	/^(ANTHROPIC|OPENAI|DEEPSEEK|GEMINI|GOOGLE|GROQ|MISTRAL|MOONSHOT|KIMI|ZAI|ZHIPU|MINIMAX|DASHSCOPE|QWEN|XIAOMI|MIMO|OPENROUTER|XAI|TOGETHER|FIREWORKS|CEREBRAS|HF|HUGGINGFACE|NVIDIA|BASETEN|VERCEL_AI_GATEWAY|AZURE_OPENAI)_API_KEY$/;

export function commandEnvironment(sessionId: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (!KEY_VARIABLES.test(name)) env[name] = value;
	}
	return {
		...env,
		YEW_SESSION: sessionId,
		NO_COLOR: "1",
		PAGER: "cat",
		GIT_PAGER: "cat",
		GIT_TERMINAL_PROMPT: "0",
	};
}

export interface RunningCommand {
	child: ChildProcess;
	output: OutputTail;
	done: Promise<{ exitCode: number | null; signal: string | null }>;
	stop(): void;
}

/**
 * Runs a command with the user's login shell in its own process group, so stopping it ends every
 * process it started. When the system sandbox is on (sandbox.ts) the command runs in it, able to
 * write in its working folder, unless the person approved `outsideSandbox` for this one command;
 * `ask` puts a site it wants to reach to the person. Stopping freezes the group first, so `a; b`
 * cannot slip into `b` while it is being ended (pi's approach on macOS, prior-art 4.2), then sends
 * SIGTERM and, 3 seconds later, SIGKILL.
 */
export async function startCommand(options: {
	command: string;
	cwd: string;
	sessionId: string;
	logDir: string;
	onOutput?: (chunk: string) => void;
	outsideSandbox?: boolean;
	ask?: (host: string, port?: number) => Promise<boolean>;
}): Promise<RunningCommand> {
	const shell = process.env.SHELL || "/bin/zsh";
	const env = commandEnvironment(options.sessionId);
	const outside = options.outsideSandbox === true && activeSandbox() !== "none";
	const box = outside
		? null
		: await sandboxed(`exec ${quote(shell)} -lc ${quote(options.command)}`, {
				grant: { writable: [options.cwd] },
				text: options.command,
				...(options.ask ? { ask: options.ask } : {}),
			});
	if (box) {
		for (const name of box.unset) delete env[name];
		Object.assign(env, box.env);
	}
	const child = box
		? spawn(box.line, {
				shell: true,
				cwd: options.cwd,
				env,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			})
		: spawn(shell, ["-lc", options.command], {
				cwd: options.cwd,
				env: outside ? { ...env, ...OUTSIDE_GIT } : env,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
	const output = new OutputTail(options.logDir);
	const onData = (data: Buffer) => {
		const chunk = data.toString("utf8");
		output.push(chunk);
		options.onOutput?.(chunk);
	};
	child.stdout?.on("data", onData);
	child.stderr?.on("data", onData);
	const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
		child.on("error", (error) => {
			output.push(`\n${error.message}\n`);
			resolve({ exitCode: null, signal: null });
		});
		child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
	}).then((result) => {
		// When a command failed, what the sandbox kept from it goes after the output, so the session
		// sees why.
		const blocked = box?.finish() ?? [];
		if (blocked.length > 0 && result.exitCode !== 0) {
			output.push(
				`\n[Blocked by the sandbox: ${blocked.length} time(s). If the command needs this, run it again with outside_sandbox.]\n${blocked.slice(0, 10).join("\n")}\n`,
			);
		}
		return result;
	});
	let stopping = false;
	const stop = () => {
		if (stopping || child.exitCode !== null || child.pid === undefined) return;
		stopping = true;
		const group = -child.pid;
		const send = (signal: NodeJS.Signals) => {
			try {
				process.kill(group, signal);
			} catch {
				// Already gone.
			}
		};
		send("SIGSTOP");
		send("SIGTERM");
		send("SIGCONT");
		const timer = setTimeout(() => send("SIGKILL"), 3000);
		void done.then(() => clearTimeout(timer));
	};
	return { child, output, done, stop };
}
