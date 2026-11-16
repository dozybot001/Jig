import { execFileSync, spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { VERSION } from "../shared/version.ts";
import { type CliIo, EXIT_ERROR, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";

export const DEFAULT_PORT = 4777;
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** How often the service looks for letters from `jig send`, which writes to the database directly. */
const LETTER_SWEEP_MS = 2000;
/** How often the service checks whether phone access was turned on or off. */
const REMOTE_SYNC_MS = 5000;

const SERVE_HELP = `Usage: jig serve [options]

Start Jig's local service. It listens on 127.0.0.1 only, keeps running while
the browser is closed, and prints a one-time link to open the web interface.

Options:
  -p, --port <n>  Port to listen on (default ${DEFAULT_PORT})
      --open      Open the link in the default browser
  -h, --help      Show this help
`;

const OPEN_HELP = `Usage: jig open [options]

Open the web interface of the running Jig service with a new one-time link.

Options:
      --print  Print the link instead of opening a browser
  -h, --help   Show this help
`;

interface ServeFile {
	port: number;
	pid: number;
	startedAt: number;
}

const serveFile = (home: string) => join(home, "serve.json");

/** The short commit of a source checkout; null when Jig does not run from a git checkout. */
function shortCommit(): string | null {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: fileURLToPath(new URL("../..", import.meta.url)),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

export function openBrowser(url: string): void {
	const [command, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	spawn(command as string, args as string[], { detached: true, stdio: "ignore" }).unref();
}

export function serveCommand(): Command {
	return {
		name: "serve",
		summary: "Start Jig's local service",
		async run(args: string[], io: CliIo): Promise<number> {
			const { values } = parseArgs({
				args,
				options: {
					port: { type: "string", short: "p" },
					open: { type: "boolean" },
					help: { type: "boolean", short: "h" },
				},
				strict: true,
			});
			if (values.help) {
				io.stdout.write(SERVE_HELP);
				return EXIT_OK;
			}
			const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				throw new UsageError("--port must be a whole number from 1 to 65535");
			}

			const { openRuntime } = await import("../server/runtime.ts");
			const { serve } = await import("@hono/node-server");
			const { Agents } = await import("../server/agent/runner.ts");
			const { PermissionEngine } = await import("../server/permissions/engine.ts");
			const { createApp } = await import("../server/http/app.ts");
			const { issueLoginToken } = await import("../server/http/security.ts");
			const { MailStore } = await import("../server/mail/store.ts");
			const { Scheduler } = await import("../server/schedules.ts");

			const runtime = openRuntime({ env: io.env });
			const { store, bus, gateway, home } = runtime;
			const stuck = store.recoverAfterRestart();
			if (stuck.length > 0) {
				io.stderr.write(
					`${stuck.length} session(s) were working when Jig last stopped. They are marked for review; nothing was redone.\n`,
				);
			}
			store.pruneEvents(Date.now() - EVENT_RETENTION_MS);
			// Answers handed to a waiting call whose result was never stored come back as letters.
			new MailStore(store).requeueHandedOff();
			const log = (line: string) => io.stderr.write(`${line}\n`);
			// Tools beyond the built-in ones: web search when a search service has a key (M4 plan).
			const { ALL_TOOLS } = await import("../server/tools/registry.ts");
			const { SearchAccess, webSearchTool } = await import("../server/tools/web-search.ts");
			const search = new SearchAccess(runtime.keys);
			// MCP servers from mcp.json in the data folder; their tools ask before the first use.
			const { McpHub } = await import("../server/mcp.ts");
			const { builtinInstaller, builtinMcp } = await import("../server/mcp-builtin.ts");
			const mcp = new McpHub({
				jigHome: home,
				version: VERSION,
				log,
				builtin: builtinMcp(home, io.env as NodeJS.ProcessEnv),
				prepare: builtinInstaller({ jigHome: home, env: io.env as NodeJS.ProcessEnv, log }),
			});
			const { skillTool } = await import("../server/skills.ts");
			const { homedir } = await import("node:os");
			const { ArtifactStore, saveArtifactTool } = await import("../server/artifacts.ts");
			const artifacts = new ArtifactStore(store, home);
			const extraTools = [
				webSearchTool(search, { version: VERSION }),
				skillTool(home, homedir(), () => store.getSetting<string[]>("disabledSkills", [])),
				saveArtifactTool(artifacts),
			];
			const agents = new Agents({
				store,
				gateway,
				permissions: new PermissionEngine(home),
				home,
				version: VERSION,
				log,
				tools: () => [...ALL_TOOLS, ...extraTools, ...mcp.tools()],
				userHome: homedir(),
			});
			const { RemoteAccess } = await import("../remote/access.ts");
			const { systemKeys } = await import("../server/keys.ts");
			// A paired phone's requests run in-process against the same app, as that device.
			let handle: ((request: Request, device: string) => Promise<Response>) | null = null;
			const remote = new RemoteAccess(store, systemKeys("remote"), {
				version: VERSION,
				log,
				handle: async (request, device) => {
					if (!handle) throw new Error("Jig is still starting.");
					return handle(request, device.id);
				},
			});
			// Notifications to paired phones, sealed for each; the relay passes them to Apple's service.
			const { Notifier } = await import("../server/push.ts");
			const { NoteStreams } = await import("../server/http/notes.ts");
			const notes = new NoteStreams(store);
			const notifier = new Notifier({
				store,
				mail: agents.post.mail,
				bus,
				schedules: () => agents.schedules.list(),
				// iPhones through Apple's service; phones that keep their own connection directly.
				send: (note, mode, id) => remote.push(note, mode, id) + notes.send(note),
			});
			const { systemControl } = await import("./system.ts");
			// Scheduled tasks run from the service, whether or not a page is open (blueprint 6.5).
			const scheduler = new Scheduler(store, agents.post, agents.schedules, log);
			const app = createApp({
				store,
				gateway,
				agents,
				bus,
				log,
				security: { port },
				webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url)),
				build: shortCommit(),
				remote,
				scheduler,
				onPresence: () => notifier.seen(),
				notes,
				artifacts,
				mcp: { home, hub: mcp },
				skills: { home, userHome: homedir() },
				data: { home },
				search,
				system: systemControl({ home, env: io.env }),
			});
			handle = async (request, device) => app.fetch(request, { device });

			const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
			const started = await new Promise<boolean>((resolve) => {
				server.once("listening", () => resolve(true));
				server.once("error", (error: NodeJS.ErrnoException) => {
					io.stderr.write(
						error.code === "EADDRINUSE"
							? `jig: port ${port} is in use. Is Jig already running? Try 'jig open', or pick another port with --port.\n`
							: `jig: could not start: ${error.message}\n`,
					);
					resolve(false);
				});
			});
			if (!started) {
				runtime.close();
				return EXIT_ERROR;
			}
			// Letters that were waiting when Jig stopped, and letters from `jig send`, start their sessions.
			agents.wakeQueued();
			const sweep = setInterval(() => agents.wakeQueued(), LETTER_SWEEP_MS);
			// Runs missed while Jig was not running are run or skipped now, as each task says.
			scheduler.start();
			notifier.start();
			// Phone access follows the settings, which `jig remote` may change while Jig runs.
			const syncRemote = () => {
				void remote.sync().catch((error: Error) => log(`remote access: ${error.message}`));
				// A search key saved with `jig key set` while Jig runs is picked up here.
				void search.refresh().catch(() => {});
				// A changed mcp.json is read again: new servers start, removed ones stop.
				void mcp.refresh().catch((error: Error) => log(`mcp: ${error.message}`));
			};
			syncRemote();
			const remoteSweep = setInterval(syncRemote, REMOTE_SYNC_MS);
			const info: ServeFile = { port, pid: process.pid, startedAt: Date.now() };
			writeFileSync(serveFile(home), JSON.stringify(info), { mode: 0o600 });

			const url = `http://127.0.0.1:${port}/#t=${issueLoginToken(store)}`;
			io.stdout.write(
				`Jig ${VERSION} is running at http://127.0.0.1:${port}/\nSign in with this link (works once, within 10 minutes):\n${url}\nStop with Ctrl-C. For a new link later, run: jig open\n`,
			);
			if (values.open) openBrowser(url);

			return await new Promise<number>((resolve) => {
				const stop = () => {
					io.stderr.write("Stopping Jig…\n");
					clearInterval(sweep);
					clearInterval(remoteSweep);
					scheduler.stop();
					notifier.stop();
					mcp.stop();
					remote.stop();
					agents.shutdown();
					server.close();
					// Open event streams would keep the process alive; end them too.
					if ("closeAllConnections" in server) server.closeAllConnections();
					rmSync(serveFile(home), { force: true });
					runtime.close();
					resolve(EXIT_OK);
				};
				process.once("SIGINT", stop);
				process.once("SIGTERM", stop);
			});
		},
	};
}

/** True when a Jig service is running for this data directory. */
export function serviceRunning(home: string): boolean {
	try {
		const info = JSON.parse(readFileSync(serveFile(home), "utf8")) as ServeFile;
		process.kill(info.pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function openCommand(): Command {
	return {
		name: "open",
		summary: "Open the web interface with a new sign-in link",
		async run(args: string[], io: CliIo): Promise<number> {
			const { values } = parseArgs({
				args,
				options: { print: { type: "boolean" }, help: { type: "boolean", short: "h" } },
				strict: true,
			});
			if (values.help) {
				io.stdout.write(OPEN_HELP);
				return EXIT_OK;
			}
			const { jigHome } = await import("../server/paths.ts");
			const home = jigHome(io.env);
			let info: ServeFile;
			try {
				info = JSON.parse(readFileSync(serveFile(home), "utf8")) as ServeFile;
				process.kill(info.pid, 0);
			} catch {
				io.stderr.write("jig: Jig is not running. Start it with: jig serve\n");
				return EXIT_ERROR;
			}
			const { openDatabase } = await import("../server/db/database.ts");
			const { EventBus } = await import("../server/events.ts");
			const { Store } = await import("../server/store.ts");
			const { dbPath } = await import("../server/paths.ts");
			const { issueLoginToken } = await import("../server/http/security.ts");
			const db = openDatabase(dbPath(home));
			try {
				const url = `http://127.0.0.1:${info.port}/#t=${issueLoginToken(new Store(db, new EventBus()))}`;
				if (values.print) {
					io.stdout.write(`${url}\n`);
				} else {
					openBrowser(url);
					io.stdout.write(`Opened Jig in the browser (http://127.0.0.1:${info.port}/).\n`);
				}
				return EXIT_OK;
			} finally {
				db.close();
			}
		},
	};
}
