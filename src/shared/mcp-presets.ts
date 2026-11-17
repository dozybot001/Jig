/**
 * Official MCP servers people often add, ready to add with a token (blueprint 6.11, item 40). Each
 * was connected and its tools listed with Jig's own client before it went in. Only servers that work
 * with a token are here, not ones that need a sign-in in the browser (OAuth). Adding one writes the
 * same mcp.json entry a person would write by hand; servers started with npx are pinned to a version.
 */
export interface McpPreset {
	/** Its name in mcp.json, and the middle part of its tools' names. */
	id: string;
	name: string;
	/** Who makes and runs it. */
	publisher: string;
	/** Where to read about it. */
	docs: string;
	connect: { url: string } | { command: string; args: string[] };
	token?: {
		/** Sent as a request header, or set as an environment variable of the command. */
		in: "header" | "env";
		key: string;
		/** Written before the token, such as "Bearer ". */
		prefix?: string;
		/** It works without one, with lower limits. */
		optional?: boolean;
		/** Where to make one. */
		where: string;
	};
}

export const MCP_PRESETS: readonly McpPreset[] = [
	{
		id: "github",
		name: "GitHub",
		publisher: "GitHub",
		docs: "https://github.com/github/github-mcp-server",
		connect: { url: "https://api.githubcopilot.com/mcp/" },
		token: {
			in: "header",
			key: "Authorization",
			prefix: "Bearer ",
			where: "https://github.com/settings/personal-access-tokens",
		},
	},
	{
		id: "gitee",
		name: "Gitee",
		publisher: "Gitee",
		docs: "https://gitee.com/oschina/mcp-gitee",
		connect: { command: "npx", args: ["-y", "@gitee/mcp-gitee@1.0.0"] },
		token: {
			in: "env",
			key: "GITEE_ACCESS_TOKEN",
			where: "https://gitee.com/profile/personal_access_tokens",
		},
	},
	{
		id: "context7",
		name: "Context7",
		publisher: "Upstash",
		docs: "https://context7.com",
		connect: { url: "https://mcp.context7.com/mcp" },
		token: {
			in: "header",
			key: "CONTEXT7_API_KEY",
			optional: true,
			where: "https://context7.com/dashboard",
		},
	},
	{
		id: "notion",
		name: "Notion",
		publisher: "Notion",
		docs: "https://github.com/makenotion/notion-mcp-server",
		connect: { command: "npx", args: ["-y", "@notionhq/notion-mcp-server@2.6.1"] },
		token: { in: "env", key: "NOTION_TOKEN", where: "https://www.notion.so/profile/integrations" },
	},
	{
		id: "sentry",
		name: "Sentry",
		publisher: "Sentry",
		docs: "https://github.com/getsentry/sentry-mcp",
		connect: { command: "npx", args: ["-y", "@sentry/mcp-server@0.49.0"] },
		token: {
			in: "env",
			key: "SENTRY_ACCESS_TOKEN",
			where: "https://sentry.io/settings/account/api/auth-tokens/",
		},
	},
];

/** The mcp.json entry for a preset with the token the person gave (empty when it has none). */
export function presetEntry(
	preset: McpPreset,
	token: string,
): {
	name: string;
	url?: string;
	headers?: Record<string, string>;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
} {
	const value = token.trim();
	const secret =
		preset.token && value ? { [preset.token.key]: `${preset.token.prefix ?? ""}${value}` } : null;
	if ("url" in preset.connect) {
		return {
			name: preset.id,
			url: preset.connect.url,
			...(secret && preset.token?.in === "header" ? { headers: secret } : {}),
		};
	}
	return {
		name: preset.id,
		command: preset.connect.command,
		args: [...preset.connect.args],
		...(secret && preset.token?.in === "env" ? { env: secret } : {}),
	};
}
