import { type RunningCommand, startCommand } from "./process.ts";

export interface Job {
	id: string;
	command: string;
	running: RunningCommand;
	startedAt: number;
	finished: { exitCode: number | null; signal: string | null; at: number } | null;
}

/** Commands a session started in the background. They keep running between turns until they end or are stopped. */
export class Jobs {
	readonly #jobs = new Map<string, Job>();
	#next = 1;
	readonly #onFinish: (job: Job) => void;

	constructor(onFinish: (job: Job) => void) {
		this.#onFinish = onFinish;
	}

	start(options: { command: string; cwd: string; sessionId: string; logDir: string }): Job {
		const id = `job-${this.#next++}`;
		const running = startCommand(options);
		const job: Job = {
			id,
			command: options.command,
			running,
			startedAt: Date.now(),
			finished: null,
		};
		this.#jobs.set(id, job);
		void running.done.then((result) => {
			job.finished = { ...result, at: Date.now() };
			this.#onFinish(job);
		});
		return job;
	}

	get(id: string): Job | undefined {
		return this.#jobs.get(id);
	}

	list(): Job[] {
		return [...this.#jobs.values()];
	}

	stopAll(): void {
		for (const job of this.#jobs.values()) if (!job.finished) job.running.stop();
	}
}
