import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, test } from "node:test";
import WebSocket from "ws";
import { Apns } from "../relay/apns.ts";
import { Relay } from "../relay/relay.ts";
import { RemoteAccess } from "../src/remote/access.ts";
import { publicKeyOf } from "../src/remote/noise.ts";
import { parsePairingLink } from "../src/remote/protocol.ts";
import { openPush, type PushJob, type PushResult, pushKey, sealPush } from "../src/remote/push.ts";
import { createApp } from "../src/server/http/app.ts";
import { NoteStreams } from "../src/server/http/notes.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { MailStore } from "../src/server/mail/store.ts";
import { type Clear, type Note, Notifier } from "../src/server/push.ts";
import { TestPhone } from "./helpers/phone.ts";
import { newStore, sessionInput } from "./helpers/store.ts";

async function until(check: () => boolean, ms = 3000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

// The same vector is checked against the iPhone's code (ios/Shared/PushCrypto.swift).
const VECTOR = {
	mac: Buffer.alloc(32, 1),
	phone: Buffer.alloc(32, 2),
	nonce: Buffer.alloc(12, 3),
	note: '{"v":1,"id":"n1","kind":"permission","title":"官网","body":"git push","badge":2}',
	// Derived from the two fixed test keys above; not a secret.
	key: "bf2f399751d75ff40f167677924af1407de6afd15b6daa221300a279db14fa2c", // gitleaks:allow
	sealed:
		"AwMDAwMDAwMDAwMDzlSL/SON53/W/tTl6GMwmom0kDXkK4kZJ+oDF+dDT3PM+7WahUcxbjb+0S51ticZLimYofNBxprt/PVjZgZGDvt2QNdmP3KukCVTHGN9yXVCG7u/8ewUsx7sxw9Dgrnhzvo=",
};

describe("notification encryption", () => {
	test("the Mac and the phone derive the same key; the sealed bytes match the fixed vector", () => {
		const mac = { privateKey: VECTOR.mac, publicKey: publicKeyOf(VECTOR.mac) };
		const phone = { privateKey: VECTOR.phone, publicKey: publicKeyOf(VECTOR.phone) };
		const key = pushKey(mac, phone.publicKey);
		assert.equal(key.toString("hex"), VECTOR.key);
		assert.ok(pushKey(phone, mac.publicKey).equals(key));
		const sealed = sealPush(key, Buffer.from(VECTOR.note), VECTOR.nonce);
		assert.equal(sealed.toString("base64"), VECTOR.sealed);
		assert.equal(openPush(key, sealed).toString(), VECTOR.note);
	});

	test("a changed byte or another phone's key does not open it", () => {
		const mac = { privateKey: VECTOR.mac, publicKey: publicKeyOf(VECTOR.mac) };
		const key = pushKey(mac, publicKeyOf(VECTOR.phone));
		const sealed = sealPush(key, Buffer.from("hello"));
		const changed = Buffer.from(sealed);
		changed[14] = (changed[14] as number) ^ 1;
		assert.throws(() => openPush(key, changed));
		const other = pushKey(mac, publicKeyOf(Buffer.alloc(32, 9)));
		assert.throws(() => openPush(other, sealed));
		assert.throws(() => openPush(key, Buffer.alloc(8)));
	});
});

describe("the relay's APNs client", () => {
	function setup(answer: { status: number; body: string } = { status: 200, body: "" }) {
		const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const calls: { host: string; headers: Record<string, string>; body: string }[] = [];
		let now = 1_800_000_000_000;
		const apns = new Apns(
			{
				key: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
				keyId: "KEY1234567",
				teamId: "TEAM123456",
				topic: "cn.tenonai.apps.yew",
			},
			{
				request: async (host, headers, body) => {
					calls.push({ host, headers, body });
					return answer;
				},
				now: () => now,
			},
		);
		return {
			apns,
			calls,
			publicKey,
			advance(ms: number) {
				now += ms;
			},
		};
	}
	const job: PushJob = {
		token: `sandbox:${"ab".repeat(32)}`,
		data: "c2VhbGVk",
		mode: "alert",
		id: "n1",
	};

	test("an alert goes to the token's environment with a signed provider token and only the sealed data", async () => {
		const { apns, calls, publicKey } = setup();
		assert.deepEqual(await apns.send(job), { token: job.token, ok: true, gone: false });
		const [call] = calls;
		assert.equal(call?.host, "https://api.sandbox.push.apple.com");
		assert.equal(call?.headers[":path"], `/3/device/${"ab".repeat(32)}`);
		assert.equal(call?.headers["apns-topic"], "cn.tenonai.apps.yew");
		assert.equal(call?.headers["apns-push-type"], "alert");
		assert.equal(call?.headers["apns-collapse-id"], "n1");
		assert.deepEqual(JSON.parse(call?.body ?? ""), {
			aps: { alert: { "loc-key": "push.fallback" }, "mutable-content": 1, sound: "default" },
			e: "c2VhbGVk",
		});
		const [head, claims, signature] = (call?.headers.authorization ?? "").slice(7).split(".");
		assert.deepEqual(JSON.parse(Buffer.from(head as string, "base64url").toString()), {
			alg: "ES256",
			kid: "KEY1234567",
		});
		assert.equal(
			JSON.parse(Buffer.from(claims as string, "base64url").toString()).iss,
			"TEAM123456",
		);
		assert.ok(
			verify(
				"sha256",
				Buffer.from(`${head}.${claims}`),
				{ key: publicKey, dsaEncoding: "ieee-p1363" },
				Buffer.from(signature as string, "base64url"),
			),
		);
	});

	test("a background notification is quiet; the provider token is reused, then renewed", async () => {
		const { apns, calls, advance } = setup();
		await apns.send({ ...job, token: `production:${"cd".repeat(32)}`, mode: "background" });
		assert.equal(calls[0]?.host, "https://api.push.apple.com");
		assert.equal(calls[0]?.headers["apns-push-type"], "background");
		assert.equal(calls[0]?.headers["apns-priority"], "5");
		assert.deepEqual(JSON.parse(calls[0]?.body ?? "").aps, { "content-available": 1 });
		advance(10 * 60 * 1000);
		await apns.send(job);
		assert.equal(calls[1]?.headers.authorization, calls[0]?.headers.authorization);
		advance(40 * 60 * 1000);
		await apns.send(job);
		assert.notEqual(calls[2]?.headers.authorization, calls[0]?.headers.authorization);
	});

	test("a token Apple no longer knows is reported as gone; other failures are not", async () => {
		const gone = await setup({ status: 410, body: '{"reason":"Unregistered"}' }).apns.send(job);
		assert.deepEqual(gone, { token: job.token, ok: false, gone: true, reason: "Unregistered" });
		const bad = await setup({ status: 400, body: '{"reason":"BadDeviceToken"}' }).apns.send(job);
		assert.equal(bad.gone, true);
		const busy = await setup({ status: 503, body: "" }).apns.send(job);
		assert.deepEqual(busy, { token: job.token, ok: false, gone: false, reason: "503" });
	});
});

describe("notifications through the relay", () => {
	async function setup(push?: (job: PushJob) => Promise<PushResult>) {
		const relay = new Relay({
			port: 0,
			host: "127.0.0.1",
			log: () => {},
			pushPerMinute: 3,
			...(push ? { push } : {}),
		});
		const relayUrl = `ws://127.0.0.1:${await relay.listen()}`;
		const { store, bus } = newStore();
		store.setSetting("remote", { enabled: true, relayUrl });
		const logs: string[] = [];
		let app: ReturnType<typeof createApp> | null = null;
		const remote = new RemoteAccess(store, new MemoryKeyStore(), {
			version: "0.0.0",
			log: (line) => logs.push(line),
			WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
			handle: async (request, device) =>
				(app as ReturnType<typeof createApp>).fetch(request, { device: device.id }),
		});
		const notes = new NoteStreams(store);
		app = createApp({ store, bus, remote, notes, log: () => {} });
		await remote.sync();
		await until(() => remote.status().connected);
		const link = parsePairingLink((await remote.pairing()).link);
		assert.ok(link);
		const phone = new TestPhone();
		const welcome = await phone.connect(link, { pair: true });
		return {
			store,
			remote,
			phone,
			link,
			device: welcome.device,
			logs,
			app,
			notes,
			async close() {
				phone.close();
				remote.stop();
				await relay.close();
			},
		};
	}
	const token = `sandbox:${"0f".repeat(32)}`;

	test("the phone hands over its token; a notification reaches the push service sealed for that phone", async () => {
		const jobs: PushJob[] = [];
		const { store, remote, phone, link, device, close } = await setup(async (job) => {
			jobs.push(job);
			return { token: job.token, ok: true, gone: false };
		});
		try {
			assert.equal(remote.push({ v: 1 }, "alert"), 0);
			const path = `/api/devices/${device}`;
			assert.equal((await phone.request("PATCH", path, { pushToken: "not a token" })).status, 400);
			assert.equal((await phone.request("PATCH", path, { pushToken: token })).status, 200);
			assert.equal(store.listDevices()[0]?.canPush, true);
			const note = { v: 1, id: "n1", kind: "card", title: "#3 定价", body: "", badge: 1 };
			assert.equal(remote.push(note, "alert", "n1"), 1);
			await until(() => jobs.length === 1);
			assert.equal(jobs[0]?.token, token);
			assert.equal(jobs[0]?.mode, "alert");
			assert.equal(jobs[0]?.id, "n1");
			// The relay holds ciphertext only: nothing of the text is in what it was given.
			assert.equal(JSON.stringify(jobs[0]).includes("定价"), false);
			const key = pushKey(phone.key, Buffer.from(link.key, "base64url"));
			const opened = openPush(key, Buffer.from(jobs[0]?.data ?? "", "base64"));
			assert.deepEqual(JSON.parse(opened.toString()), note);
			// A phone with notifications turned off on the Mac gets none.
			store.updateDevice(device, { push: false });
			assert.equal(remote.push(note, "alert"), 0);
		} finally {
			await close();
		}
	});

	test("a phone that keeps its own connection gets notifications over the channel", async () => {
		const { store, phone, device, app, notes, close } = await setup();
		try {
			assert.equal(notes.send({ v: 1, clear: [], badge: 0 }), 0);
			const note = {
				v: 1 as const,
				id: "n1",
				kind: "card" as const,
				title: "#3",
				body: "",
				badge: 1,
			};
			const stream = phone.stream("/api/notes", (text) => text.includes('"n1"'));
			await until(() => notes.send({ v: 1, clear: [], badge: 0 }) === 1);
			assert.equal(notes.send(note), 1);
			const text = await stream;
			assert.match(text, /event: hello/);
			assert.match(text, /event: note\ndata: \{"v":1,"id":"n1"/);
			// Turned off on the Mac, the phone is not written to; the Mac's own page cannot listen.
			store.updateDevice(device, { push: false });
			assert.equal(notes.send(note), 0);
			assert.equal((await app.request("/api/notes")).status, 400);
			// A phone turns its own notifications on and off, and touches no other phone.
			assert.equal(
				(await phone.request("PATCH", `/api/devices/${device}`, { push: true })).status,
				200,
			);
			const other = store.addDevice("another", "k".repeat(43));
			assert.equal(
				(await phone.request("PATCH", `/api/devices/${other.id}`, { push: false })).status,
				403,
			);
		} finally {
			await close();
		}
	});

	test("a token Apple no longer knows is forgotten; too many notifications are refused", async () => {
		let gone = true;
		const { store, remote, phone, device, logs, close } = await setup(async (job) => ({
			token: job.token,
			ok: !gone,
			gone,
			reason: "Unregistered",
		}));
		try {
			await phone.request("PATCH", `/api/devices/${device}`, { pushToken: token });
			remote.push({ v: 1 }, "background");
			await until(() => store.listDevices()[0]?.canPush === false);
			gone = false;
			await phone.request("PATCH", `/api/devices/${device}`, { pushToken: token });
			for (let i = 0; i < 5; i++) remote.push({ v: 1 }, "alert");
			await until(() => logs.some((line) => line.includes("too many notifications")));
			assert.equal(store.listDevices()[0]?.canPush, true);
		} finally {
			await close();
		}
	});

	test("a relay without a signing key says push is not set up", async () => {
		const { remote, phone, device, logs, close } = await setup();
		try {
			await phone.request("PATCH", `/api/devices/${device}`, { pushToken: token });
			assert.equal(remote.push({ v: 1 }, "alert"), 1);
			await until(() => logs.some((line) => line.includes("push is not set up")));
		} finally {
			await close();
		}
	});
});

describe("what the phone is told, and when", () => {
	function setup() {
		const { store, bus } = newStore();
		const mail = new MailStore(store);
		const sent: { note: Note | Clear; mode: string }[] = [];
		let now = 1_800_000_000_000;
		let reach = 1;
		const notifier = new Notifier({
			store,
			mail,
			bus,
			send: (note, mode) => {
				if (reach > 0) sent.push({ note, mode });
				return reach;
			},
			now: () => now,
		});
		const session = store.createSession(sessionInput("官网"));
		notifier.start();
		const ask = (summary: string) =>
			store.createApproval({
				sessionId: session.id,
				toolCallId: null,
				kind: "permission",
				request: { tool: "shell", summary, mustConfirm: true },
			});
		const pass = (ms: number) => {
			now += ms;
			notifier.tick();
		};
		return {
			store,
			notifier,
			session,
			sent,
			ask,
			pass,
			unreachable(value: boolean) {
				reach = value ? 0 : 1;
			},
			notes: () => sent.filter((s) => s.mode === "alert").map((s) => s.note as Note),
			clears: () => sent.filter((s) => s.mode === "background").map((s) => s.note as Clear),
		};
	}

	test("a new approval goes out once it has settled, with the session, the request and the badge", () => {
		const { ask, pass, notes, notifier } = setup();
		ask("git push origin main");
		pass(500);
		assert.equal(notes().length, 0);
		pass(1500);
		const [note] = notes();
		assert.equal(note?.kind, "permission");
		assert.equal(note?.title, "官网");
		assert.equal(note?.body, "git push origin main");
		assert.equal(note?.badge, 1);
		pass(60_000);
		assert.equal(notes().length, 1);
		notifier.stop();
	});

	test("one settled before it went out is never sent", () => {
		const { store, ask, pass, sent, notifier } = setup();
		const approval = ask("rm build");
		store.resolveApproval(approval.id, { decision: "deny" });
		pass(5000);
		assert.equal(sent.length, 0);
		notifier.stop();
	});

	test("more within the window are summed up in one; handled ones come off the phone", () => {
		const { store, ask, pass, notes, clears, notifier } = setup();
		const first = ask("git push");
		pass(100);
		pass(1500);
		const second = ask("npm publish");
		const third = ask("rm -rf dist");
		pass(100);
		pass(2000);
		assert.equal(notes().length, 1);
		pass(8000);
		assert.equal(notes().length, 2);
		assert.equal(notes()[1]?.kind, "many");
		assert.equal(notes()[1]?.n, 2);
		assert.equal(notes()[1]?.badge, 3);

		store.resolveApproval(first.id, { decision: "allow_once" });
		pass(100);
		assert.deepEqual(clears(), [{ v: 1, clear: [notes()[0]?.id], badge: 2 }]);
		// The summary stays until everything it carried is handled.
		store.resolveApproval(second.id, { decision: "deny" });
		pass(100);
		assert.equal(clears().length, 1);
		store.resolveApproval(third.id, { decision: "deny" });
		pass(100);
		assert.deepEqual(clears()[1], { v: 1, clear: [notes()[1]?.id], badge: 0 });
		notifier.stop();
	});

	test("while you are at the Mac it waits, and goes out after you left if still open", () => {
		const { store, ask, pass, notes, notifier, session } = setup();
		notifier.seen();
		ask("git push");
		// News that needs nothing from you is not sent while you are there.
		store.setStatus(session.id, "error", "The model request failed.");
		pass(5000);
		assert.equal(notes().length, 0);
		pass(2 * 60 * 1000);
		assert.equal(notes().length, 1);
		assert.equal(notes()[0]?.kind, "permission");
		notifier.stop();
	});

	test("errors, budget lines and held letters are news too", () => {
		const { store, pass, notes, notifier, session } = setup();
		store.setStatus(session.id, "working");
		store.setStatus(session.id, "error", "**Rate limited** by the provider.\nRetry later.");
		pass(2000);
		assert.equal(notes()[0]?.kind, "error");
		assert.equal(notes()[0]?.body, "Rate limited by the provider.");
		assert.equal(notes()[0]?.session, session.id);
		store.appendEntry(session.id, {
			role: "notice",
			notice: {
				kind: "budget",
				text: "",
				data: { code: "budget-reached", scope: "session", spent: 2.13, limit: 2 },
				timestamp: Date.now(),
			},
		});
		pass(10_000);
		assert.equal(notes()[1]?.kind, "budget");
		assert.equal(notes()[1]?.code, "budget-reached");
		assert.equal(notes()[1]?.body, "$2.13 / $2.00");
		notifier.stop();
	});

	test("with no phone in reach, what needs you is tried again", () => {
		const { ask, pass, notes, unreachable, notifier } = setup();
		unreachable(true);
		ask("git push");
		pass(2000);
		assert.equal(notes().length, 0);
		unreachable(false);
		pass(5000);
		assert.equal(notes().length, 1);
		notifier.stop();
	});
});
