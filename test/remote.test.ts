import assert from "node:assert/strict";
import { describe, test } from "node:test";
import WebSocket from "ws";
import { Relay } from "../relay/relay.ts";
import { RemoteAccess } from "../src/remote/access.ts";
import { loadIdentity } from "../src/remote/identity.ts";
import {
	generateKeyPair,
	Initiator,
	NoiseError,
	Opener,
	Responder,
	seal,
} from "../src/remote/noise.ts";
import { parsePairingLink } from "../src/remote/protocol.ts";
import { createApp } from "../src/server/http/app.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import type { Store } from "../src/server/store.ts";
import { TestPhone } from "./helpers/phone.ts";
import { newStore } from "./helpers/store.ts";

async function until(check: () => boolean, ms = 3000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("Noise IK", () => {
	const prologue = Buffer.from("yew-remote/1:test");

	function handshake(options: { remoteStatic?: Buffer } = {}) {
		const mac = generateKeyPair();
		const phone = generateKeyPair();
		const initiator = new Initiator({
			static: phone,
			remoteStatic: options.remoteStatic ?? mac.publicKey,
			prologue,
		});
		const responder = new Responder({ static: mac, prologue });
		return { mac, phone, initiator, responder };
	}

	test("both ends agree; the Mac learns the phone's key and both payloads arrive", () => {
		const { phone, initiator, responder } = handshake();
		const first = initiator.writeFirst(Buffer.from("你好"));
		assert.equal(responder.readFirst(first).toString(), "你好");
		assert.ok(responder.remoteStatic?.equals(phone.publicKey));
		// The phone's static key travels encrypted.
		assert.equal(first.indexOf(phone.publicKey), -1);
		const { message, session: mac } = responder.writeSecond(Buffer.from("welcome"));
		const { payload, session } = initiator.readSecond(message);
		assert.equal(payload.toString(), "welcome");
		assert.ok(session.handshakeHash.equals(mac.handshakeHash));
		const sealed = seal(session.send, Buffer.from("ping"));
		assert.equal(new Opener(mac.receive).open(sealed[0] as Buffer)?.toString(), "ping");
	});

	test("a wrong Mac key, a changed byte or a replayed message fails", () => {
		const other = generateKeyPair();
		const wrong = handshake({ remoteStatic: other.publicKey });
		assert.throws(
			() => wrong.responder.readFirst(wrong.initiator.writeFirst(Buffer.from("x"))),
			NoiseError,
		);

		const { initiator, responder } = handshake();
		const first = initiator.writeFirst(Buffer.from("x"));
		const tampered = Buffer.from(first);
		tampered[40] = (tampered[40] as number) ^ 1;
		assert.throws(() => responder.readFirst(tampered), NoiseError);

		const ok = handshake();
		ok.responder.readFirst(ok.initiator.writeFirst(Buffer.from("x")));
		const { message, session: mac } = ok.responder.writeSecond(Buffer.alloc(0));
		const { session } = ok.initiator.readSecond(message);
		const opener = new Opener(mac.receive);
		const [part] = seal(session.send, Buffer.from("once"));
		opener.open(part as Buffer);
		assert.throws(() => opener.open(part as Buffer), NoiseError);
	});

	test("a message larger than one Noise message is split and joined back", () => {
		const { initiator, responder } = handshake();
		responder.readFirst(initiator.writeFirst(Buffer.alloc(0)));
		const { message, session: mac } = responder.writeSecond(Buffer.alloc(0));
		const { session } = initiator.readSecond(message);
		const big = Buffer.alloc(300_000, 9);
		const parts = seal(session.send, big);
		assert.equal(parts.length, 5);
		const opener = new Opener(mac.receive);
		const joined = parts.map((part) => opener.open(part)).filter(Boolean);
		assert.equal(joined.length, 1);
		assert.ok(joined[0]?.equals(big));
	});
});

async function setup() {
	const relay = new Relay({ port: 0, host: "127.0.0.1", log: () => {} });
	const port = await relay.listen();
	const relayUrl = `ws://127.0.0.1:${port}`;
	const { store, bus } = newStore();
	store.setSetting("remote", { enabled: true, relayUrl });
	const keys = new MemoryKeyStore();
	let app: ReturnType<typeof createApp> | null = null;
	const remote = new RemoteAccess(store, keys, {
		version: "0.0.0",
		log: () => {},
		WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
		handle: async (request, device) =>
			(app as ReturnType<typeof createApp>).fetch(request, { device: device.id }),
	});
	app = createApp({ store, bus, remote, security: { port: 4777 }, log: () => {} });
	await remote.sync();
	await until(() => remote.status().connected);
	return {
		relay,
		relayUrl,
		store,
		keys,
		remote,
		async close() {
			remote.stop();
			await relay.close();
		},
	};
}

async function pair(remote: RemoteAccess) {
	const link = parsePairingLink((await remote.pairing()).link);
	assert.ok(link);
	return link;
}

describe("the relay", () => {
	test("a phone reaches its Mac only through a handshake; the relay forwards ciphertext", async () => {
		const { remote, store, close } = await setup();
		try {
			const link = await pair(remote);
			const phone = new TestPhone();
			const welcome = await phone.connect(link, { pair: true, name: "Deyang's iPhone" });
			assert.equal(welcome.version, "0.0.0");
			const [device] = store.listDevices();
			assert.equal(device?.name, "Deyang's iPhone");
			assert.equal(device?.id, welcome.device);
			assert.equal(device?.publicKey, phone.key.publicKey.toString("base64url"));
			// The same API the web interface uses, as this device, without a browser cookie.
			store.createSession({ name: "UI", kind: "standing", provider: "p", model: "m" });
			const sessions = await phone.request("GET", "/api/sessions");
			assert.equal(sessions.status, 200);
			assert.deepEqual(
				(sessions.body as { items: { name: string }[] }).items.map((s) => s.name),
				["UI"],
			);
			phone.close();
		} finally {
			await close();
		}
	});

	test("the pairing secret works once; an unpaired phone without it is turned away", async () => {
		const { remote, store, close } = await setup();
		try {
			const link = await pair(remote);
			await new TestPhone().connect(link, { pair: true });
			const stranger = new TestPhone();
			await assert.rejects(stranger.connect(link, { pair: true }));
			const another = new TestPhone();
			await assert.rejects(another.connect({ ...link, secret: "wrong" }, { pair: true }));
			assert.equal(store.listDevices().length, 1);
		} finally {
			await close();
		}
	});

	test("a paired phone comes back without the secret; a revoked one is cut off", async () => {
		const { remote, store, close } = await setup();
		try {
			const link = await pair(remote);
			const phone = new TestPhone();
			await phone.connect(link, { pair: true });
			phone.close();
			const again = new TestPhone(phone.key);
			await again.connect(link);
			assert.equal((await again.request("GET", "/api/center")).status, 200);
			const [device] = store.listDevices();
			store.deleteDevice(device?.id as string);
			remote.disconnect(device?.id as string);
			assert.equal(await again.closed, 1000);
			await assert.rejects(new TestPhone(phone.key).connect(link));
		} finally {
			await close();
		}
	});

	test("keys, devices and remote access stay on the Mac; the event stream comes through", async () => {
		const { remote, store, close } = await setup();
		try {
			const link = await pair(remote);
			const phone = new TestPhone();
			await phone.connect(link, { pair: true });
			assert.equal((await phone.request("POST", "/api/devices/pairing")).status, 403);
			assert.equal(
				(await phone.request("PATCH", "/api/settings", { remote: { enabled: false } })).status,
				400,
			);
			assert.equal((await phone.request("GET", "/api/devices")).status, 200);
			// The event stream stays open and brings changes as they happen.
			const events = phone.stream("/api/events", (text) => text.includes("手机上看到的"));
			setTimeout(
				() =>
					store.createSession({
						name: "手机上看到的",
						kind: "standing",
						provider: "p",
						model: "m",
					}),
				50,
			);
			assert.match(await events, /event: global/);
			phone.close();
		} finally {
			await close();
		}
	});

	test("a phone that asks gets long answers compressed; others get them as before", async () => {
		const { remote, store, close } = await setup();
		try {
			for (let n = 0; n < 12; n++) {
				store.createSession({
					name: `一个名字很长的会话，用来把列表撑过压缩的门槛 ${n}`,
					kind: "standing",
					provider: "p",
					model: "m",
				});
			}
			const phone = new TestPhone();
			await phone.connect(await pair(remote), { pair: true });
			const plain = await phone.request("GET", "/api/sessions");
			assert.equal(phone.packed, false);
			phone.compress = true;
			const packed = await phone.request("GET", "/api/sessions");
			assert.equal(phone.packed, true);
			assert.deepEqual(packed.body, plain.body);
			// A short answer is not worth compressing.
			assert.equal((await phone.request("POST", "/api/devices/pairing")).status, 403);
			assert.equal(phone.packed, false);
			phone.close();
		} finally {
			await close();
		}
	});

	test("a phone may remove itself when it unpairs, but no other phone", async () => {
		const { remote, store, close } = await setup();
		try {
			const first = new TestPhone();
			const one = await first.connect(await pair(remote), { pair: true, name: "one" });
			const second = new TestPhone();
			const two = await second.connect(await pair(remote), { pair: true, name: "two" });
			assert.equal((await first.request("DELETE", `/api/devices/${two.device}`)).status, 403);
			// The Mac closes the phone's channel as it removes it, so the answer never arrives.
			void first.request("DELETE", `/api/devices/${one.device}`);
			assert.equal(await first.closed, 1000);
			assert.deepEqual(
				store.listDevices().map((device) => device.name),
				["two"],
			);
			second.close();
		} finally {
			await close();
		}
	});

	test("a phone for a Mac that is not connected is closed with 4404; a bad hello is refused", async () => {
		const relay = new Relay({ port: 0, host: "127.0.0.1", log: () => {} });
		const port = await relay.listen();
		try {
			const phone = new WebSocket(`ws://127.0.0.1:${port}/phone/nobody`);
			const code = await new Promise<number>((resolve) => phone.on("close", resolve));
			assert.equal(code, 4404);
			const mac = new WebSocket(`ws://127.0.0.1:${port}/desktop`);
			await new Promise((resolve) => mac.once("message", resolve));
			mac.send(JSON.stringify({ type: "hello", key: "AAAA", sig: "AAAA" }));
			const refused = await new Promise<number>((resolve) => mac.on("close", resolve));
			assert.equal(refused, 1008);
		} finally {
			await relay.close();
		}
	});

	test("the Mac's keys are made once and kept", async () => {
		const keys = new MemoryKeyStore();
		const first = await loadIdentity(keys);
		const second = await loadIdentity(keys);
		assert.equal(first.desktopId, second.desktopId);
		assert.ok(first.noise.publicKey.equals(second.noise.publicKey));
		assert.ok((await keys.get("noise")) && (await keys.get("signing")));
	});
});

export type { Store };
