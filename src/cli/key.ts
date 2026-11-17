import { parseArgs } from "node:util";
import type { KeyStore } from "../server/keys.ts";
import type { ProviderInfo } from "../server/model/gateway.ts";
import {
	type CliIo,
	confirm,
	EXIT_ERROR,
	EXIT_OK,
	EXIT_USAGE,
	readSecret,
	UsageError,
} from "./io.ts";
import type { Command } from "./run.ts";

export interface KeyDeps {
	keys: KeyStore;
	providers: ProviderInfo[];
	close?(): void;
}

const HELP = `Usage: yew key <command> [options]

Manage API keys for model providers. Keys are kept in the system keychain only.

Commands:
  set <provider>     Save a key. On a terminal it is read without echo;
                     otherwise it is read from standard input.
  delete <provider>  Remove a saved key. Asks first; --yes skips the question.
  list               Show every provider and whether it has a key.

Options:
      --json   With list, print JSON
  -y, --yes    With delete, do not ask
  -h, --help   Show this help

Examples:
  yew key set deepseek
  pbpaste | yew key set deepseek
`;

const REGION_ORDER = { cn: 0, custom: 1, global: 2 } as const;

function findProvider(deps: KeyDeps, id: string | undefined): ProviderInfo {
	if (!id) throw new UsageError("missing provider. Run 'yew key list' to see them.");
	const provider = deps.providers.find((p) => p.id === id);
	if (!provider) throw new UsageError(`unknown provider '${id}'. Run 'yew key list' to see them.`);
	return provider;
}

export function keyCommand(load: () => KeyDeps | Promise<KeyDeps>): Command {
	return {
		name: "key",
		summary: "Manage API keys for model providers",
		async run(args: string[], io: CliIo): Promise<number> {
			const { values, positionals } = parseArgs({
				args,
				options: {
					help: { type: "boolean", short: "h" },
					json: { type: "boolean" },
					yes: { type: "boolean", short: "y" },
				},
				allowPositionals: true,
				strict: true,
			});
			if (values.help) {
				io.stdout.write(HELP);
				return EXIT_OK;
			}
			const [sub, id, extra] = positionals;
			if (!sub) {
				io.stderr.write(HELP);
				return EXIT_USAGE;
			}
			if (extra !== undefined) throw new UsageError(`unexpected argument '${extra}'`);

			const deps = await load();
			try {
				if (sub === "list") {
					const rows = await Promise.all(
						[...deps.providers]
							.sort(
								(a, b) =>
									REGION_ORDER[a.region] - REGION_ORDER[b.region] || a.id.localeCompare(b.id),
							)
							.map(async (p) => ({
								id: p.id,
								name: p.name,
								region: p.region,
								hasKey: !p.keyRequired || (await deps.keys.get(p.id)) !== null,
							})),
					);
					if (values.json) {
						io.stdout.write(`${JSON.stringify(rows)}\n`);
						return EXIT_OK;
					}
					const width = Math.max(...rows.map((row) => row.id.length));
					for (const row of rows) {
						io.stdout.write(
							`${row.id.padEnd(width)}  ${row.hasKey ? "key saved" : "no key"}  ${row.name}\n`,
						);
					}
					return EXIT_OK;
				}

				if (sub === "set") {
					const provider = findProvider(deps, id);
					const key = await readSecret(io, `API key for ${provider.name} (input hidden): `);
					if (!key) {
						io.stderr.write("yew: no key was entered; nothing saved.\n");
						return EXIT_ERROR;
					}
					await deps.keys.set(provider.id, key);
					io.stdout.write(`Saved the API key for ${provider.name} in the system keychain.\n`);
					return EXIT_OK;
				}

				if (sub === "delete") {
					const provider = findProvider(deps, id);
					if (!values.yes) {
						if (!io.stdin.isTTY) {
							throw new UsageError("refusing to delete without a terminal; pass --yes to confirm.");
						}
						if (
							!(await confirm(io, `Delete the API key for ${provider.name} from the keychain?`))
						) {
							io.stderr.write("Nothing deleted.\n");
							return EXIT_ERROR;
						}
					}
					const removed = await deps.keys.delete(provider.id);
					io.stdout.write(
						removed
							? `Deleted the API key for ${provider.name}.\n`
							: `There was no API key for ${provider.name}.\n`,
					);
					return EXIT_OK;
				}

				throw new UsageError(`unknown key command '${sub}'`);
			} finally {
				deps.close?.();
			}
		},
	};
}
