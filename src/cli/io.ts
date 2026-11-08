import { styleText } from "node:util";

export interface OutStream {
	write(chunk: string): unknown;
	isTTY?: boolean;
}

export interface InStream extends AsyncIterable<string | Buffer> {
	isTTY?: boolean;
	setRawMode?(mode: boolean): unknown;
}

/** Everything a command touches outside its arguments, so tests can swap it out. */
export interface CliIo {
	stdout: OutStream;
	stderr: OutStream;
	stdin: InStream;
	env: Record<string, string | undefined>;
}

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

/** Thrown for bad arguments; the runner prints it with a pointer to --help and exits with 2. */
export class UsageError extends Error {}

/** clig.dev and spec 20.5: no ANSI colors when NO_COLOR is non-empty or the stream is not a terminal. */
export function useColor(stream: OutStream, env: CliIo["env"]): boolean {
	if (env.NO_COLOR) return false;
	if (env.TERM === "dumb") return false;
	return stream.isTTY === true;
}

export function paint(
	format: Parameters<typeof styleText>[0],
	text: string,
	stream: OutStream,
	env: CliIo["env"],
): string {
	return useColor(stream, env) ? styleText(format, text, { validateStream: false }) : text;
}
