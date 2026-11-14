import { parseArgs } from "node:util";
import { VERSION } from "../shared/version.ts";
import { type CliIo, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";

const HELP = `Usage: jig mcp list [options]

Show the MCP servers set up in mcp.json in Jig's data folder: whether each one
connects, and the tools it offers. The file uses the usual shape:

  { "mcpServers": {
      "files":  { "command": "npx", "args": ["some-mcp-server"], "env": { "KEY": "\${KEY}" } },
      "search": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer \${TOKEN}" } } } }

\${NAME} is taken from the environment Jig runs in. Sessions ask you before
they use a tool of a server for the first time. A project's own .mcp.json is
not read.

Options:
      --json  Print as JSON
  -h, --help  Show this help
`;

export function mcpCommand(): Command {
	return {
		name: "mcp",
		summary: "Show the MCP servers and their tools",
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
			if (positionals.length !== 1 || positionals[0] !== "list") {
				throw new UsageError("jig mcp needs list");
			}
			const { jigHome } = await import("../server/paths.ts");
			const { McpHub } = await import("../server/mcp.ts");
			const hub = new McpHub({
				jigHome: jigHome(io.env),
				version: VERSION,
				env: io.env as NodeJS.ProcessEnv,
				log: () => {},
			});
			try {
				await hub.refresh();
				const servers = hub.status();
				if (values.json) {
					io.stdout.write(`${JSON.stringify(servers)}\n`);
					return EXIT_OK;
				}
				if (servers.length === 0) {
					io.stdout.write("No MCP servers are set up. See 'jig mcp --help'.\n");
					return EXIT_OK;
				}
				for (const server of servers) {
					io.stdout.write(
						`${server.name} (${server.kind}): ${server.state === "ready" ? `${server.tools.length} tools` : `not connected: ${server.error ?? "unknown"}`}\n`,
					);
					for (const tool of server.tools) io.stdout.write(`  ${tool}\n`);
				}
				return EXIT_OK;
			} finally {
				hub.stop();
			}
		},
	};
}
