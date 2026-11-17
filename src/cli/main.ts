#!/usr/bin/env node
import { moveJigHome } from "../server/paths.ts";
import { appCommand } from "./app.ts";
import { exportCommand } from "./export.ts";
import { keyCommand } from "./key.ts";
import { mcpCommand } from "./mcp.ts";
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
	appCommand(),
	exportCommand(),
	mcpCommand(),
	keyCommand(async () => {
		const { openRuntime } = await import("../server/runtime.ts");
		const runtime = openRuntime();
		const { SEARCH_SERVICES } = await import("../server/tools/web-search.ts");
		return {
			keys: runtime.keys,
			// Search services keep their keys the same way: yew key set search-bocha.
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

// Jig is now Yew: its data folder moves the first time Yew runs (blueprint, section 12).
try {
	const move = moveJigHome(process.env);
	if (move && "moved" in move) {
		process.stderr.write(
			`yew: Jig is now Yew. Moved its data folder ${move.moved} to ${move.to} and left a link in its place.\n`,
		);
	} else if (move && "busy" in move) {
		process.stderr.write(
			`yew: Jig is still running from ${move.folder} (process ${move.busy}). Stop it, then start Yew again to move its data; until then Yew uses ${move.folder}.\n`,
		);
	}
} catch (error) {
	process.stderr.write(`yew: could not move Jig's data folder: ${(error as Error).message}\n`);
}

process.exitCode = await run(
	process.argv.slice(2),
	{ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env },
	commands,
);
