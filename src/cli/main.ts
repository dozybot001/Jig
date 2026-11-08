#!/usr/bin/env node
import { keyCommand } from "./key.ts";
import { run } from "./run.ts";
import { openCommand, serveCommand } from "./serve.ts";

const commands = [
	serveCommand(),
	openCommand(),
	keyCommand(async () => {
		const { openRuntime } = await import("../server/runtime.ts");
		const runtime = openRuntime();
		return {
			keys: runtime.keys,
			providers: runtime.gateway.providers(),
			close: runtime.close,
		};
	}),
];

process.exitCode = await run(
	process.argv.slice(2),
	{ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env },
	commands,
);
