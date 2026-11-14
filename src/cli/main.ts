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
		const { SEARCH_SERVICES } = await import("../server/tools/web-search.ts");
		return {
			keys: runtime.keys,
			// Search services keep their keys the same way: jig key set search-bocha.
			providers: [
				...runtime.gateway.providers(),
				...SEARCH_SERVICES.map((service) => ({
					id: service.id,
					name: service.name,
					region: service.region,
					baseUrl: service.origin,
					keyRequired: true,
					custom: false,
				})),
			],
			close: runtime.close,
		};
	}),
];

process.exitCode = await run(
	process.argv.slice(2),
	{ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env },
	commands,
);
