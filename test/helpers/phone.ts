import { inflateRawSync } from "node:zlib";
import WebSocket from "ws";
import {
	generateKeyPair,
	Initiator,
	type KeyPair,
	Opener,
	type Session,
	seal,
} from "../../src/remote/noise.ts";
import {
	type ChannelMessage,
	type PairingLink,
	prologueFor,
	type Welcome,
} from "../../src/remote/protocol.ts";

/**
 * A phone for tests, written the way the iPhone app talks to the Mac: connect to the relay, Noise IK
 * handshake with the Mac's key from the pairing link, then requests and streamed responses.
 */
export class TestPhone {
	readonly key: KeyPair;
	#socket: WebSocket | null = null;
	#session: Session | null = null;
	#opener: Opener | null = null;
	#next = 1;
	#pending = new Map<number, (message: ChannelMessage) => void>();
	#handshake: ((welcome: Welcome) => void) | null = null;
	closed: Promise<number>;
	#closed: (code: number) => void = () => {};

	constructor(key: KeyPair = generateKeyPair()) {
		this.key = key;
		this.closed = new Promise((resolve) => {
			this.#closed = resolve;
		});
	}

	/** Connects and shakes hands; `pair` sends the pairing secret for a phone that is not paired. */
	async connect(
		link: PairingLink,
		options: { pair?: boolean; name?: string } = {},
	): Promise<Welcome> {
		const socket = new WebSocket(`${link.relay}/phone/${encodeURIComponent(link.desktop)}`);
		this.#socket = socket;
		const initiator = new Initiator({
			static: this.key,
			remoteStatic: Buffer.from(link.key, "base64url"),
			prologue: prologueFor(link.desktop),
		});
		const welcome = new Promise<Welcome>((resolve, reject) => {
			this.#handshake = resolve;
			socket.once("close", (code) => reject(new Error(`closed with ${code}`)));
		});
		socket.on("close", (code) => this.#closed(code));
		socket.on("message", (data: Buffer) => {
			if (!this.#session) {
				const { payload, session } = initiator.readSecond(data);
				this.#session = session;
				this.#opener = new Opener(session.receive);
				this.#handshake?.(JSON.parse(payload.toString("utf8")) as Welcome);
				return;
			}
			const message = this.#opener?.open(data);
			if (!message) return;
			const parsed = JSON.parse(message.toString("utf8")) as ChannelMessage;
			if ("id" in parsed) this.#pending.get(parsed.id)?.(parsed);
		});
		await new Promise<void>((resolve, reject) => {
			socket.once("open", () => resolve());
			socket.once("error", reject);
		});
		const hello = {
			...(options.pair ? { pair: link.secret } : {}),
			name: options.name ?? "Test iPhone",
			app: "test",
		};
		socket.send(initiator.writeFirst(Buffer.from(JSON.stringify(hello))));
		return welcome;
	}

	/** Ask for compressed answers, as the apps do; `packed` says whether the last one was. */
	compress = false;
	packed = false;

	/** One request; resolves with the status and the parsed body. */
	request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ status: number; body: unknown }> {
		const id = this.#next++;
		return new Promise((resolve) => {
			this.#pending.set(id, (message) => {
				if (message.t !== "res") return;
				this.#pending.delete(id);
				this.packed = message.z === 1;
				const text = this.packed
					? inflateRawSync(Buffer.from(message.body, "base64")).toString("utf8")
					: message.body;
				resolve({
					status: message.status,
					body: text && message.type.includes("json") ? JSON.parse(text) : text,
				});
			});
			this.#send({
				t: "req",
				id,
				method,
				path,
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				...(this.compress ? { z: 1 as const } : {}),
			});
		});
	}

	/** A streamed request: collects chunks until `until` says enough, then cancels it. */
	stream(path: string, until: (text: string) => boolean): Promise<string> {
		const id = this.#next++;
		let text = "";
		return new Promise((resolve) => {
			this.#pending.set(id, (message) => {
				if (message.t === "chunk") {
					text += message.data;
					if (until(text)) {
						this.#pending.delete(id);
						this.#send({ t: "cancel", id });
						resolve(text);
					}
				}
			});
			this.#send({ t: "req", id, method: "GET", path });
		});
	}

	#send(message: ChannelMessage): void {
		if (!this.#session) throw new Error("not connected");
		for (const part of seal(this.#session.send, Buffer.from(JSON.stringify(message)))) {
			this.#socket?.send(part);
		}
	}

	close(): void {
		this.#socket?.close();
	}
}
