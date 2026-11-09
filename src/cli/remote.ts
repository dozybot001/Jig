import { parseArgs } from "node:util";
import { type CliIo, EXIT_ERROR, EXIT_OK, UsageError } from "./io.ts";
import type { Command } from "./run.ts";
import { serviceRunning } from "./serve.ts";

const HELP = `Usage: jig remote <on|off|status|pair> [options]

Let your iPhone reach Jig on this Mac through Jig's relay. Both sides connect
out to the relay, so this Mac opens no port; everything between them is
end-to-end encrypted, and the relay sees only ciphertext.

Commands:
  on      Turn on phone access
  off     Turn it off; paired phones stay paired
  status  Show whether it is on, the relay and the paired phones
  pair    Show a QR code to pair an iPhone (valid for 5 minutes, once)

Options:
      --relay <url>  With on: the relay to use (default wss://relay.tenonai.cn)
      --json         Print as JSON
  -h, --help         Show this help
`;

export function remoteCommand(): Command {
	return {
		name: "remote",
		summary: "Let your iPhone reach this Mac",
		async run(args: string[], io: CliIo): Promise<number> {
			const { values, positionals } = parseArgs({
				args,
				options: {
					relay: { type: "string" },
					json: { type: "boolean" },
					help: { type: "boolean", short: "h" },
				},
				allowPositionals: true,
				strict: true,
			});
			if (values.help) {
				io.stdout.write(HELP);
				return EXIT_OK;
			}
			const action = positionals[0];
			if (positionals.length !== 1 || !["on", "off", "status", "pair"].includes(action ?? "")) {
				throw new UsageError("jig remote needs one of on, off, status or pair");
			}
			const relay = values.relay;
			if (relay !== undefined && !/^wss:\/\/|^ws:\/\/(127\.0\.0\.1|localhost)[:/]/.test(relay)) {
				throw new UsageError("--relay must be a wss:// address (ws:// only on this Mac)");
			}

			const { jigHome, dbPath } = await import("../server/paths.ts");
			const { openDatabase } = await import("../server/db/database.ts");
			const { EventBus } = await import("../server/events.ts");
			const { Store } = await import("../server/store.ts");
			const { readSettings } = await import("../server/settings.ts");
			const home = jigHome(io.env);
			const db = openDatabase(dbPath(home));
			try {
				const store = new Store(db, new EventBus());
				const settings = readSettings(store).remote;
				const running = serviceRunning(home);
				if (action === "on" || action === "off") {
					const next = {
						...settings,
						enabled: action === "on",
						...(relay ? { relayUrl: relay } : {}),
					};
					store.setSetting("remote", next);
					if (values.json) io.stdout.write(`${JSON.stringify(next)}\n`);
					else
						io.stdout.write(`Phone access is ${next.enabled ? "on" : "off"} (${next.relayUrl}).\n`);
					// The running service picks the setting up within a few seconds.
					if (!running) io.stderr.write("jig: Jig is not running; start it with 'jig serve'.\n");
					return EXIT_OK;
				}
				if (action === "status") {
					const devices = store.listDevices();
					if (values.json) {
						io.stdout.write(`${JSON.stringify({ ...settings, running, devices })}\n`);
						return EXIT_OK;
					}
					io.stdout.write(
						`Phone access: ${settings.enabled ? "on" : "off"}\nRelay: ${settings.relayUrl}\nJig service: ${running ? "running" : "not running"}\nPaired phones: ${devices.length}\n`,
					);
					for (const device of devices) {
						const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : "never";
						io.stdout.write(`  ${device.name} (last seen ${seen})\n`);
					}
					return EXIT_OK;
				}
				if (!settings.enabled) {
					io.stderr.write("jig: turn on phone access first: jig remote on\n");
					return EXIT_ERROR;
				}
				const { KeychainStore } = await import("../server/keys.ts");
				const { loadIdentity, createPairing } = await import("../remote/identity.ts");
				const { desktopName } = await import("../remote/access.ts");
				const identity = await loadIdentity(new KeychainStore("remote"));
				const { link, expiresAt } = createPairing(store, identity, {
					relay: settings.relayUrl,
					name: desktopName(),
				});
				if (values.json) {
					io.stdout.write(`${JSON.stringify({ link, expiresAt })}\n`);
					return EXIT_OK;
				}
				const { renderUnicodeCompact } = await import("uqr");
				io.stdout.write(
					`${renderUnicodeCompact(link)}\nScan this with Jig on your iPhone within 5 minutes.\n`,
				);
				if (!running) io.stderr.write("jig: Jig is not running; start it with 'jig serve'.\n");
				return EXIT_OK;
			} finally {
				db.close();
			}
		},
	};
}
