// A computer to try the Android app against, all on this machine and in memory: a relay on
// 127.0.0.1:8791, Jig's API behind it with two sessions, and the notifier. Nothing touches ~/.jig or
// the system keychain. Run from the repository root:
//   node android/scripts/test-computer.ts <folder>
// It writes the pairing link to <folder>/link.txt and takes commands as one line written to
// <folder>/cmd:  pair | ask <command> | settle | drop | status
// On the emulator, `adb reverse tcp:8791 tcp:8791` makes 127.0.0.1:8791 reach this relay; a debug
// build then pairs with `adb shell am start -n cn.tenonai.apps.jig.debug/cn.tenonai.apps.jig.MainActivity --es jig.pair '<link>'`.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { Relay } from "../../relay/relay.ts";
import { RemoteAccess } from "../../src/remote/access.ts";
import { createApp } from "../../src/server/http/app.ts";
import { NoteStreams } from "../../src/server/http/notes.ts";
import { MemoryKeyStore } from "../../src/server/keys.ts";
import { MailStore } from "../../src/server/mail/store.ts";
import { Notifier } from "../../src/server/push.ts";
import { newStore, sessionInput } from "../../test/helpers/store.ts";

const folder = process.argv[2];
if (!folder) {
	process.stderr.write("usage: node android/scripts/test-computer.ts <folder>\n");
	process.exit(2);
}
const log = (line: string) => process.stdout.write(`${line}\n`);

const relay = new Relay({ port: 8791, host: "127.0.0.1", log: (line) => log(`relay: ${line}`) });
const relayUrl = `ws://127.0.0.1:${await relay.listen()}`;
const { store, bus } = newStore();
store.setSetting("remote", { enabled: true, relayUrl });
let app: ReturnType<typeof createApp> | null = null;
const remote = new RemoteAccess(store, new MemoryKeyStore(), {
	version: "0.0.0",
	log: (line) => log(`remote: ${line}`),
	WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
	handle: async (request, device) =>
		(app as ReturnType<typeof createApp>).fetch(request, { device: device.id }),
});
const notes = new NoteStreams(store);
app = createApp({ store, bus, remote, notes, log: () => {} });
const notifier = new Notifier({
	store,
	mail: new MailStore(store),
	bus,
	send: (note) => {
		const sent = notes.send(note);
		log(`note: ${JSON.stringify(note)} -> ${sent}`);
		return sent;
	},
});
store.createSession(sessionInput("总办"));
const site = store.createSession({ ...sessionInput("官网"), cwd: "/tmp" });
notifier.start();
await remote.sync();

const pair = async () => writeFileSync(join(folder, "link.txt"), (await remote.pairing()).link);
setTimeout(pair, 1500);
const asked: string[] = [];
setInterval(async () => {
	const file = join(folder, "cmd");
	if (!existsSync(file)) return;
	const line = readFileSync(file, "utf8").trim();
	rmSync(file);
	log(`cmd: ${line}`);
	try {
		if (line === "pair") {
			await pair();
		} else if (line.startsWith("ask ")) {
			// A permission request waiting in the approval center, as a session's push would be.
			const approval = store.createApproval({
				sessionId: site.id,
				toolCallId: null,
				kind: "permission",
				request: { tool: "shell", summary: line.slice(4), mustConfirm: true },
			});
			asked.push(approval.id);
		} else if (line === "settle") {
			const id = asked.pop();
			if (id) store.resolveApproval(id, { decision: "allow_once" });
		} else if (line === "drop") {
			for (const device of store.listDevices()) remote.disconnect(device.id);
		} else if (line === "status") {
			log(JSON.stringify({ devices: store.listDevices(), remote: remote.status() }));
		}
	} catch (error) {
		log(`error: ${String(error)}`);
	}
}, 500);
log(`ready ${relayUrl}`);
