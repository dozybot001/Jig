import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "./mcp.ts";

/**
 * The MCP servers Jig sets up by itself (blueprint 6.10, item 38): a browser and control of this
 * computer. Jig does not build these in; it runs two open-source servers.
 *
 * - browser: Playwright MCP by Microsoft (Apache-2.0). It opens its own Chrome window with a
 *   profile kept in Jig's data folder, so sign-ins made there stay, apart from the person's Chrome.
 * - computer: computer-use-mcp by Adam Jones (MIT). Screenshots, mouse and keyboard for the whole
 *   screen; macOS asks once for Screen Recording and Accessibility for the program that runs Jig.
 *
 * What runs is fixed by `mcp-builtin/package-lock.json`, which ships with Jig: every package of
 * both dependency trees at one version with its hash. The first time a server is needed Jig installs
 * exactly that into its data folder (`npm ci`, without install scripts) and from then on starts the
 * servers with node from there. Nothing is resolved at run time, so what runs changes only when Jig
 * is updated.
 *
 * An entry of the same name in mcp.json replaces one of these; `{"disabled": true}` turns it off.
 * `JIG_MCP_BUILTIN=off` leaves them out, for a throwaway Jig that should start nothing.
 */
const SOURCE = fileURLToPath(new URL("../../mcp-builtin/", import.meta.url));
const FILES = ["package.json", "package-lock.json"] as const;

/** Where the servers are installed. */
const installDir = (jigHome: string) => join(jigHome, "mcp-builtin");

export function builtinMcp(
	jigHome: string,
	env: NodeJS.ProcessEnv = process.env,
): Record<string, McpServerConfig> {
	if (env.JIG_MCP_BUILTIN === "off") return {};
	const modules = join(installDir(jigHome), "node_modules");
	return {
		browser: {
			command: process.execPath,
			args: [
				join(modules, "@playwright", "mcp", "cli.js"),
				"--user-data-dir",
				join(jigHome, "browser"),
				// Page snapshots and screenshots it saves; otherwise they land in the folder Jig was started in.
				"--output-dir",
				join(jigHome, "tmp", "browser"),
			],
			ownEnv: true,
		},
		computer: {
			command: process.execPath,
			args: [join(modules, "computer-use-mcp", "dist", "main.js")],
			ownEnv: true,
		},
	};
}

/** Runs `npm ci` in a folder; rejects with the end of npm's output when it fails. */
function npmCi(folder: string, env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
			cwd: folder,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		const keep = (chunk: Buffer) => {
			output = (output + chunk.toString("utf8")).slice(-2000);
		};
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		child.on("error", (error) => reject(new Error(`npm could not be started: ${error.message}`)));
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`npm ci failed (${code}): ${output.trim()}`)),
		);
	});
}

export interface InstallOptions {
	jigHome: string;
	env?: NodeJS.ProcessEnv;
	log?: (line: string) => void;
	/** Where package.json and package-lock.json are read from; tests give their own. */
	source?: string;
	/** Installs what the lock file in the folder names; tests replace it. */
	install?: (folder: string, env: NodeJS.ProcessEnv) => Promise<void>;
}

/**
 * Makes sure the servers are installed as the lock file that ships with this Jig says. Done once per
 * lock file: a marker holds its hash, so an update of Jig that changes the lock installs again and
 * anything else returns at once. A failed install leaves no marker and is tried again next time.
 */
export function builtinInstaller(options: InstallOptions): () => Promise<void> {
	const source = options.source ?? SOURCE;
	const folder = installDir(options.jigHome);
	const marker = join(folder, ".installed");
	const install = options.install ?? npmCi;
	let running: Promise<void> | null = null;
	const run = async () => {
		const wanted = createHash("sha256")
			.update(readFileSync(join(source, "package-lock.json")))
			.digest("hex");
		if (existsSync(marker) && readFileSync(marker, "utf8").trim() === wanted) return;
		options.log?.("mcp: installing Jig's own servers (browser, computer control) from npm");
		mkdirSync(folder, { recursive: true });
		for (const file of FILES) copyFileSync(join(source, file), join(folder, file));
		await install(folder, serverEnv(options.env ?? process.env));
		writeFileSync(marker, `${wanted}\n`);
	};
	return () => {
		running ??= run().finally(() => {
			running = null;
		});
		return running;
	};
}

/**
 * What a server Jig sets up by itself is given of Jig's environment: where programs and the home
 * folder are, the language, and proxy settings. Not the rest, which in a person's shell often
 * holds keys for other services.
 */
const PASSED = new Set([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"DISPLAY",
	"WAYLAND_DISPLAY",
	"XAUTHORITY",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"all_proxy",
	"no_proxy",
]);

export function serverEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([name]) => PASSED.has(name)));
}
