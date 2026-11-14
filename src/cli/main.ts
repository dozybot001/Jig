#!/usr/bin/env node
import { exportCommand } from "./export.ts";
import { keyCommand } from "./key.ts";
import { remoteCommand } from "./remote.ts";
import { run } from "./run.ts";
import { scheduleCommand } from "./schedule.ts";
import { sendCommand } from "./send.ts";
import { openCommand, serveCommand } from "./serve.ts";
import { serviceCommand } from "./service.ts";

const commands = [
	serveCommand(),
	openCommand(),
	sendCommand(),
	scheduleCommand(),
	remoteCommand(),
	serviceCommand(),
	exportCommand(),
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
