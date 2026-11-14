import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type CliIo, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";

const HELP = `Usage: jig export <folder> [options]

Write everything Jig keeps into a folder, as files you can read without Jig:
each session as Markdown; letters, decision cards, scheduled tasks and
settings as JSON; and every version of every artifact. The folder must be new
or empty.

API keys stay in the system keychain and are not exported; neither are paired
phones or sign-in tokens.

Options:
      --json  Print what was written as JSON
  -h, --help  Show this help
`;

export function exportCommand(): Command {
	return {
		name: "export",
		summary: "Write all of Jig's data into a folder",
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
			if (positionals.length !== 1) throw new UsageError("jig export needs one folder");
			const folder = resolve(positionals[0] as string);
			const { jigHome, dbPath } = await import("../server/paths.ts");
			const { openDatabase } = await import("../server/db/database.ts");
			const { EventBus } = await import("../server/events.ts");
			const { Store } = await import("../server/store.ts");
			const { exportAll } = await import("../server/data-export.ts");
			const home = jigHome(io.env);
			const db = openDatabase(dbPath(home));
			try {
				const counts = exportAll(new Store(db, new EventBus()), folder, Date.now(), home);
				if (values.json) io.stdout.write(`${JSON.stringify({ folder, ...counts })}\n`);
				else {
					io.stdout.write(
						`Exported ${counts.sessions} sessions, ${counts.letters} letters, ${counts.cards} decision cards, ${counts.schedules} scheduled tasks and ${counts.artifacts} artifacts to ${folder} (${counts.files} files).\n`,
					);
				}
				return EXIT_OK;
			} finally {
				db.close();
			}
		},
	};
}
