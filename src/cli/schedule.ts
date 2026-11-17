import { parseArgs } from "node:util";
import type { Schedule } from "../shared/types.ts";
import { type CliIo, EXIT_ERROR, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";
import { serviceRunning } from "./serve.ts";

const HELP = `Usage: yew schedule <list|run> [options] [<task>]

Scheduled tasks send a standing session a letter at set times; the session's
last reply goes to the main conversation as the report. Set them up in Yew's
web interface, or ask the main conversation.

Commands:
  list         List the scheduled tasks with their next and last runs
  run <task>   Run a task now, by name or id; its next run stays as it was

Options:
      --json   Print as JSON
  -h, --help   Show this help
`;

const pad = (n: number) => String(n).padStart(2, "0");

function time(at: number | null): string {
	if (at === null) return "-";
	const date = new Date(at);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function lastRun(schedule: Schedule): string {
	if (!schedule.lastStatus) return "never run";
	const detail =
		schedule.lastStatus === "skipped"
			? ` (${{ busy: "the last run was not finished", archived: "the session is archived", missed: "missed" }[schedule.lastDetail as "busy" | "archived" | "missed"] ?? schedule.lastDetail})`
			: "";
	return `${schedule.lastStatus}${detail} ${time(schedule.lastRunAt)}`;
}

export function scheduleCommand(): Command {
	return {
		name: "schedule",
		summary: "List scheduled tasks, or run one now",
		async run(args: string[], io: CliIo): Promise<number> {
			const { values, positionals } = parseArgs({
				args,
				options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
				allowPositionals: true,
				strict: true,
			});
			if (values.help) {
				io.stdout.write(HELP);
				return EXIT_OK;
			}
			const [action, ref] = positionals;
			if (action === "list" ? positionals.length !== 1 : action !== "run" || !ref) {
				throw new UsageError(
					action === "run" && !ref
						? "yew schedule run needs a task's name or id"
						: "yew schedule needs list or run",
				);
			}
			if (positionals.length > 2) throw new UsageError("too many arguments");

			const { yewHome, dbPath } = await import("../server/paths.ts");
			const { openDatabase } = await import("../server/db/database.ts");
			const { EventBus } = await import("../server/events.ts");
			const { Store } = await import("../server/store.ts");
			const { PostOffice } = await import("../server/mail/post.ts");
			const { ScheduleBook, Scheduler } = await import("../server/schedules.ts");
			const home = yewHome(io.env);
			const db = openDatabase(dbPath(home));
			try {
				const store = new Store(db, new EventBus());
				const book = new ScheduleBook(store);
				const sessionName = (id: string) => {
					try {
						return store.getSession(id).name;
					} catch {
						return id;
					}
				};
				if (action === "list") {
					const schedules = book.list();
					if (values.json) {
						const items = schedules.map((schedule) => ({
							...schedule,
							session: { id: schedule.sessionId, name: sessionName(schedule.sessionId) },
						}));
						io.stdout.write(`${JSON.stringify(items)}\n`);
						return EXIT_OK;
					}
					if (schedules.length === 0) {
						io.stdout.write("No scheduled tasks yet.\n");
						return EXIT_OK;
					}
					for (const schedule of schedules) {
						io.stdout.write(
							`${schedule.name}  ${schedule.cron}  to ${sessionName(schedule.sessionId)}${schedule.enabled ? "" : "  (off)"}\n  next: ${time(schedule.nextRunAt)}  last: ${lastRun(schedule)}\n`,
						);
					}
					return EXIT_OK;
				}
				const schedule = book.find(ref as string);
				if (!schedule) {
					io.stderr.write(`yew: there is no scheduled task with the name or id ${ref}\n`);
					return EXIT_ERROR;
				}
				const scheduler = new Scheduler(store, new PostOffice(store), book, () => {});
				const result = scheduler.run(schedule.id);
				if ("skipped" in result) {
					io.stderr.write(
						result.skipped === "busy"
							? `yew: the last run of ${schedule.name} is not finished yet\n`
							: `yew: ${sessionName(schedule.sessionId)} is archived\n`,
					);
					return EXIT_ERROR;
				}
				if (values.json) {
					io.stdout.write(
						`${JSON.stringify({ schedule: book.get(schedule.id), letter: result.letter })}\n`,
					);
				} else {
					io.stdout.write(
						`Sent ${schedule.name} to ${sessionName(schedule.sessionId)} (letter ${result.letter.id}).\n`,
					);
				}
				if (!serviceRunning(home)) {
					io.stderr.write("Yew is not running; the letter is delivered when it starts.\n");
				}
				return EXIT_OK;
			} finally {
				db.close();
			}
		},
	};
}
