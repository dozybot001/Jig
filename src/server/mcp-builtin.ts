import { join } from "node:path";
import type { McpServerConfig } from "./mcp.ts";

/**
 * The MCP servers Jig sets up by itself (blueprint 6.10, item 38): a browser and control of this computer.
 * Jig does not build these in; it starts two open-source servers the way a person would in
 * mcp.json, at exact versions, so what runs changes only when Jig is updated.
 *
 * - browser: Playwright MCP by Microsoft (Apache-2.0). It opens its own Chrome window with a
 *   profile kept in Jig's data folder, so sign-ins made there stay, apart from the person's Chrome.
 * - computer: computer-use-mcp by Adam Jones (MIT). Screenshots, mouse and keyboard for the whole
 *   screen; macOS asks once for Screen Recording and Accessibility for the program that runs Jig.
 *
 * An entry of the same name in mcp.json replaces one of these; `{"disabled": true}` turns it off.
 * `JIG_MCP_BUILTIN=off` leaves them out, for a throwaway Jig that should start nothing.
 */
export const BUILTIN_VERSIONS = {
	browser: "@playwright/mcp@0.0.85",
	computer: "computer-use-mcp@1.8.0",
} as const;

export function builtinMcp(
	jigHome: string,
	env: NodeJS.ProcessEnv = process.env,
): Record<string, McpServerConfig> {
	if (env.JIG_MCP_BUILTIN === "off") return {};
	return {
		browser: {
			command: "npx",
			args: [
				"-y",
				BUILTIN_VERSIONS.browser,
				"--user-data-dir",
				join(jigHome, "browser"),
				// Page snapshots and screenshots it saves; otherwise they land in the folder Jig was started in.
				"--output-dir",
				join(jigHome, "tmp", "browser"),
			],
		},
		computer: { command: "npx", args: ["-y", BUILTIN_VERSIONS.computer] },
	};
}
