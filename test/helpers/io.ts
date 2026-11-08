import type { CliIo, OutStream } from "../../src/cli/io.ts";

export interface CapturedStream extends OutStream {
	text(): string;
}

export function capture(isTTY = false): CapturedStream {
	let buffer = "";
	return {
		isTTY,
		write(chunk: string) {
			buffer += chunk;
			return true;
		},
		text: () => buffer,
	};
}

export function fakeIo(options: { stdin?: string[]; env?: CliIo["env"]; tty?: boolean } = {}) {
	const stdout = capture(options.tty);
	const stderr = capture(options.tty);
	const chunks = options.stdin ?? [];
	const io: CliIo = {
		stdout,
		stderr,
		stdin: {
			isTTY: options.tty ?? false,
			async *[Symbol.asyncIterator]() {
				yield* chunks;
			},
		},
		env: options.env ?? {},
	};
	return { io, stdout, stderr };
}
