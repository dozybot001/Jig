import { parseArgs } from "node:util";
import type { Sender } from "../server/mail/post.ts";
import type { LetterKind } from "../shared/types.ts";
import { type CliIo, EXIT_ERROR, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";
import { serviceRunning } from "./serve.ts";

const HELP = `Usage: yew send [options] <session> <message>

Send a letter to a session, from a script, CI or a git hook. <session> is the
session's id or name. Use - as the message to read it from standard input; the
first line is the summary. The letter is marked as coming from the command
line, not from you; run inside a session's shell, it comes from that session
and counts against its letters. A running Yew delivers it within a few
seconds; otherwise it waits until Yew starts.

Options:
  -k, --kind <kind>  notice, request or report (default: notice)
      --json         Print the letter as JSON
  -h, --help         Show this help
`;

const KINDS = ["notice", "request", "report"] as const;

export function sendCommand(): Command {
	return {
		name: "send",
		summary: "Send a letter to a session",
		async run(args: string[], io: CliIo): Promise<number> {
			const { values, positionals } = parseArgs({
				args,
				options: {
					kind: { type: "string", short: "k" },
					json: { type: "boolean" },
					help: { type: "boolean", short: "h" },
				},
				allowPositionals: true,
				strict: true,
			});
			if (values.help) {
				io.stdout.write(HELP);
				return EXIT_OK;
			}
			if (positionals.length !== 2) {
				throw new UsageError("yew send needs a session and a message");
			}
			const kind = (values.kind ?? "notice") as LetterKind;
			if (!(KINDS as readonly string[]).includes(kind)) {
				throw new UsageError("--kind must be notice, request or report");
			}
			const [target, raw] = positionals as [string, string];
			let message = raw;
			if (raw === "-") {
				message = "";
				for await (const chunk of io.stdin) message += chunk.toString();
			}
			message = message.trim();
			if (!message) throw new UsageError("the message is empty");

			const { yewHome, dbPath } = await import("../server/paths.ts");
			const { openDatabase } = await import("../server/db/database.ts");
			const { EventBus } = await import("../server/events.ts");
			const { Store } = await import("../server/store.ts");
			const { PostOffice, SUMMARY_MAX, reasonText } = await import("../server/mail/post.ts");
			const { YewError } = await import("../server/errors.ts");
			const home = yewHome(io.env);
			const db = openDatabase(dbPath(home));
			try {
				const store = new Store(db, new EventBus());
				let session = store.findSessionByName(target);
				if (!session) {
					try {
						session = store.getSession(target);
					} catch {
						io.stderr.write(`yew: there is no session with the name or id ${target}\n`);
						return EXIT_ERROR;
					}
				}
				// Inside a session's shell the letter is that session's, with its quota, limits and hold.
				const { fromJigEnv } = await import("../server/from-jig.ts");
				const fromId = fromJigEnv(io.env, "SESSION")?.trim();
				let sender: Sender = { kind: "cli" };
				if (fromId) {
					try {
						sender = { kind: "session", session: store.getSession(fromId) };
					} catch {
						io.stderr.write(`yew: YEW_SESSION names no session (${fromId})\n`);
						return EXIT_ERROR;
					}
				}
				const [first = "", ...rest] = message.split("\n");
				const line = first.trim();
				const summary =
					[...line].length > SUMMARY_MAX
						? `${[...line].slice(0, SUMMARY_MAX - 1).join("")}…`
						: line;
				const body = summary === line ? rest.join("\n").trim() : message;
				let letter: ReturnType<InstanceType<typeof PostOffice>["send"]>;
				try {
					letter = new PostOffice(store).send(sender, { to: session.id, kind, summary, body });
				} catch (error) {
					if (!(error instanceof YewError)) throw error;
					io.stderr.write(`yew: ${error.message}\n`);
					return EXIT_ERROR;
				}
				if (letter.status === "refused" || letter.status === "dropped") {
					io.stderr.write(
						`yew: ${session.name} did not take the letter: ${reasonText(letter.statusReason)}\n`,
					);
					return EXIT_ERROR;
				}
				if (values.json) {
					io.stdout.write(
						`${JSON.stringify({ id: letter.id, to: { id: session.id, name: session.name }, kind, status: letter.status })}\n`,
					);
				} else {
					io.stdout.write(`Sent letter ${letter.id} to ${session.name}.\n`);
				}
				if (letter.status === "held") {
					io.stderr.write("It is held until you release it in Yew's approval center.\n");
				} else if (!serviceRunning(home)) {
					io.stderr.write("Yew is not running; the letter is delivered when it starts.\n");
				}
				return EXIT_OK;
			} finally {
				db.close();
			}
		},
	};
}
