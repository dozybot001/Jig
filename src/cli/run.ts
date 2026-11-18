import { parseArgs } from "node:util";
import { NAME, PRODUCT, PUBLISHER, VERSION, WEBSITE } from "../shared/version.ts";
import { type CliIo, EXIT_ERROR, EXIT_OK, EXIT_USAGE, paint, UsageError } from "./io.ts";

export interface Command {
	name: string;
	summary: string;
	run(args: string[], io: CliIo): Promise<number>;
}

function helpText(io: CliIo, commands: Command[]): string {
	const bold = (s: string) => paint("bold", s, io.stdout, io.env);
	const lines = [
		`${PRODUCT} ${VERSION}`,
		"An AI-native multi-agent workbench.",
		"",
		`${bold("Usage:")} ${NAME} <command> [options]`,
	];
	if (commands.length > 0) {
		lines.push("", bold("Commands:"));
		const width = Math.max(...commands.map((c) => c.name.length));
		for (const c of commands) lines.push(`  ${c.name.padEnd(width)}  ${c.summary}`);
	}
	lines.push(
		"",
		bold("Options:"),
		"  -h, --help     Show this help",
		"  -v, --version  Show the version, publisher and website",
		"      --json     With --version, print JSON",
		"",
		`Run '${NAME} <command> --help' for help on a command.`,
		"",
	);
	return lines.join("\n");
}

function versionText(json: boolean): string {
	if (json) {
		return `${JSON.stringify({ name: NAME, version: VERSION, publisher: PUBLISHER, website: WEBSITE })}\n`;
	}
	return `${PRODUCT} ${VERSION}\n${PUBLISHER} · ${WEBSITE}\n`;
}

export async function run(argv: string[], io: CliIo, commands: Command[] = []): Promise<number> {
	const first = argv[0];
	const command =
		first && !first.startsWith("-") ? commands.find((c) => c.name === first) : undefined;

	try {
		if (command) return await command.run(argv.slice(1), io);

		if (first && !first.startsWith("-")) {
			throw new UsageError(`unknown command '${first}'`);
		}

		const { values } = parseArgs({
			args: argv,
			options: {
				help: { type: "boolean", short: "h" },
				version: { type: "boolean", short: "v" },
				json: { type: "boolean" },
			},
			strict: true,
			allowPositionals: false,
		});

		if (values.version) {
			io.stdout.write(versionText(values.json === true));
			return EXIT_OK;
		}
		if (values.json) throw new UsageError("--json needs --version or a command");
		io.stdout.write(helpText(io, commands));
		return EXIT_OK;
	} catch (error) {
		return report(error, io);
	}
}

function report(error: unknown, io: CliIo): number {
	const prefix = paint("red", `${NAME}:`, io.stderr, io.env);
	if (error instanceof UsageError || isParseArgsError(error)) {
		io.stderr.write(`${prefix} ${(error as Error).message}\nRun '${NAME} --help' for usage.\n`);
		return EXIT_USAGE;
	}
	const message = error instanceof Error ? error.message : String(error);
	io.stderr.write(`${prefix} ${message}\n`);
	return EXIT_ERROR;
}

function isParseArgsError(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}
