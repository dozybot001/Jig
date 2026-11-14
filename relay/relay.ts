import { createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { CHALLENGE_PREFIX, desktopIdOf, OFFLINE } from "../src/remote/protocol.ts";
import { MAX_PUSH_DATA, PUSH_TOKEN, type PushJob, type PushResult } from "../src/remote/push.ts";

/**
 * Jig's relay (M3 plan, section 5): joins a phone's connection to the Mac it names and forwards their
 * frames. Both ends dial out to it, so the Mac opens no port. Everything between them is end-to-end
 * encrypted (Noise), so the relay sees only ciphertext: it stores nothing and logs no content.
 *
 * Mac:   GET /desktop  → {type:"challenge", nonce} → {type:"hello", key, sig} → {type:"ready", desktop}
 *        then {type:"open"|"close", channel} as phones come and go, and binary frames
 *        [channel: uint32 big-endian][payload] both ways. {type:"push", token, data, mode, id?} asks
 *        for a notification to a phone; the relay hands the sealed data to Apple's push service and
 *        answers {type:"pushResult", token, ok, gone, reason?}.
 * Phone: GET /phone/<desktop id> → binary frames with the payload only; closed with 4404 when the Mac
 *        is not connected.
 */

export interface RelayOptions {
	port: number;
	host?: string;
	/** Largest frame either end may send, in bytes. */
	maxFrame?: number;
	/** Phones one Mac may have connected at once. */
	maxPhones?: number;
	/** Frames a connection may send per second, on average, with bursts up to twice that. */
	frameRate?: number;
	heartbeatMs?: number;
	log?: (line: string) => void;
	/** Hands a notification to the push service; without it the relay answers that push is not set up. */
	push?: (job: PushJob) => Promise<PushResult>;
	/** Notifications one Mac may ask for per minute, on average, with bursts up to that many. */
	pushPerMinute?: number;
}

const TOO_MANY = 4429;
const REPLACED = 4409;

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

function verifies(key: Buffer, message: Buffer, signature: Buffer): boolean {
	if (key.length !== 32 || signature.length !== 64) return false;
	try {
		const publicKey = createPublicKey({
			key: Buffer.concat([SPKI_ED25519, key]),
			format: "der",
			type: "spki",
		});
		return verify(null, message, publicKey, signature);
	} catch {
		return false;
	}
}

interface Desktop {
	socket: WebSocket;
	phones: Map<number, WebSocket>;
	next: number;
}

/** Reads a push request; null when it is not one the relay passes on. */
function pushJob(message: Record<string, unknown>): PushJob | null {
	const { token, data, mode, id } = message;
	if (typeof token !== "string" || !PUSH_TOKEN.test(token)) return null;
	if (typeof data !== "string" || data.length > MAX_PUSH_DATA || !/^[A-Za-z0-9+/=]+$/.test(data)) {
		return null;
	}
	if (mode !== "alert" && mode !== "background") return null;
	if (id !== undefined && (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id))) return null;
	return { token, data, mode, ...(id ? { id } : {}) };
}

/** A token bucket per connection: refuses floods without slowing normal use. */
function limiter(rate: number, burst = rate * 2) {
	let tokens = burst;
	let last = Date.now();
	return () => {
		const now = Date.now();
		tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
		last = now;
		if (tokens < 1) return false;
		tokens -= 1;
		return true;
	};
}

export class Relay {
	readonly #options: Required<Omit<RelayOptions, "host" | "push">> & { host: string };
	readonly #push: RelayOptions["push"];
	/** Notifications handed on since the last count, for the health log: a number, no tokens. */
	pushes = 0;
	readonly #desktops = new Map<string, Desktop>();
	readonly #http: Server;
	readonly #wss: WebSocketServer;
	#heartbeat: NodeJS.Timeout | null = null;

	constructor(options: RelayOptions) {
		this.#options = {
			host: options.host ?? "0.0.0.0",
			port: options.port,
			maxFrame: options.maxFrame ?? 1024 * 1024,
			maxPhones: options.maxPhones ?? 16,
			frameRate: options.frameRate ?? 200,
			heartbeatMs: options.heartbeatMs ?? 30_000,
			log: options.log ?? ((line) => process.stderr.write(`${line}\n`)),
			pushPerMinute: options.pushPerMinute ?? 60,
		};
		this.#push = options.push;
		this.#http = createServer((request, response) => {
			if (request.url === "/health") {
				response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
				return;
			}
			response.writeHead(404).end();
		});
		this.#wss = new WebSocketServer({
			server: this.#http,
			maxPayload: this.#options.maxFrame,
		});
		this.#wss.on("connection", (socket, request) => this.#connected(socket, request));
	}

	/** Starts listening; resolves with the port (useful with port 0 in tests). */
	async listen(): Promise<number> {
		await new Promise<void>((resolve) =>
			this.#http.listen(this.#options.port, this.#options.host, resolve),
		);
		this.#heartbeat = setInterval(() => this.#ping(), this.#options.heartbeatMs);
		return (this.#http.address() as AddressInfo).port;
	}

	async close(): Promise<void> {
		if (this.#heartbeat) clearInterval(this.#heartbeat);
		for (const socket of this.#wss.clients) socket.terminate();
		await new Promise<void>((resolve) => this.#wss.close(() => resolve()));
		await new Promise<void>((resolve) => this.#http.close(() => resolve()));
	}

	/** Connected Macs and phones, for the health log. */
	get counts(): { desktops: number; phones: number } {
		let phones = 0;
		for (const desktop of this.#desktops.values()) phones += desktop.phones.size;
		return { desktops: this.#desktops.size, phones };
	}

	#connected(socket: WebSocket, request: IncomingMessage): void {
		const alive = socket as WebSocket & { alive?: boolean };
		alive.alive = true;
		socket.on("pong", () => {
			alive.alive = true;
		});
		const path = new URL(request.url ?? "/", "http://relay").pathname;
		if (path === "/desktop") this.#desktop(socket);
		else if (path.startsWith("/phone/")) this.#phone(socket, decodeURIComponent(path.slice(7)));
		else socket.close(1008, "unknown path");
	}

	#desktop(socket: WebSocket): void {
		const nonce = randomBytes(32).toString("base64url");
		socket.send(JSON.stringify({ type: "challenge", nonce }));
		let id: string | null = null;
		const allowed = limiter(this.#options.frameRate);
		const pushAllowed = limiter(this.#options.pushPerMinute / 60, this.#options.pushPerMinute);
		socket.on("message", (data, binary) => {
			if (!allowed()) {
				socket.close(TOO_MANY, "too many frames");
				return;
			}
			if (id === null) {
				// The first frame proves the Mac holds the key its id is made from.
				const hello = parse(data, binary);
				const key = typeof hello?.key === "string" ? Buffer.from(hello.key, "base64url") : null;
				const sig = typeof hello?.sig === "string" ? Buffer.from(hello.sig, "base64url") : null;
				if (
					hello?.type !== "hello" ||
					!key ||
					!sig ||
					!verifies(key, Buffer.from(CHALLENGE_PREFIX + nonce), sig)
				) {
					socket.close(1008, "bad hello");
					return;
				}
				id = desktopIdOf(key);
				const previous = this.#desktops.get(id);
				if (previous) this.#drop(id, previous, REPLACED);
				this.#desktops.set(id, { socket, phones: new Map(), next: 1 });
				socket.send(JSON.stringify({ type: "ready", desktop: id }));
				return;
			}
			const desktop = this.#desktops.get(id);
			if (!desktop || desktop.socket !== socket) return;
			if (binary) {
				const frame = toBuffer(data);
				if (frame.length < 4) return;
				desktop.phones.get(frame.readUInt32BE(0))?.send(frame.subarray(4), { binary: true });
				return;
			}
			const message = parse(data, binary);
			if (message?.type === "close" && typeof message.channel === "number") {
				desktop.phones.get(message.channel)?.close(1000, "closed by the Mac");
			} else if (message?.type === "push") {
				const job = pushJob(message);
				if (!job) return;
				const answer = (result: PushResult) => {
					if (socket.readyState === socket.OPEN) {
						socket.send(JSON.stringify({ type: "pushResult", ...result }));
					}
				};
				const refuse = (reason: string) =>
					answer({ token: job.token, ok: false, gone: false, reason });
				if (!this.#push) refuse("push is not set up on this relay");
				else if (!pushAllowed()) refuse("too many notifications");
				else {
					this.pushes += 1;
					void this.#push(job).then(answer, (error: Error) => refuse(error.message));
				}
			}
		});
		socket.on("close", () => {
			if (id === null) return;
			const desktop = this.#desktops.get(id);
			if (desktop && desktop.socket === socket) this.#drop(id, desktop, OFFLINE);
		});
	}

	#phone(socket: WebSocket, desktopId: string): void {
		const desktop = this.#desktops.get(desktopId);
		if (!desktop) {
			socket.close(OFFLINE, "the Mac is not connected");
			return;
		}
		if (desktop.phones.size >= this.#options.maxPhones) {
			socket.close(TOO_MANY, "too many phones");
			return;
		}
		const channel = desktop.next++;
		desktop.phones.set(channel, socket);
		desktop.socket.send(JSON.stringify({ type: "open", channel }));
		const allowed = limiter(this.#options.frameRate);
		socket.on("message", (data, binary) => {
			if (!allowed()) {
				socket.close(TOO_MANY, "too many frames");
				return;
			}
			if (!binary) return;
			const payload = toBuffer(data);
			const header = Buffer.alloc(4);
			header.writeUInt32BE(channel, 0);
			desktop.socket.send(Buffer.concat([header, payload]), { binary: true });
		});
		socket.on("close", () => {
			if (desktop.phones.get(channel) !== socket) return;
			desktop.phones.delete(channel);
			if (this.#desktops.get(desktopId) === desktop) {
				desktop.socket.send(JSON.stringify({ type: "close", channel }));
			}
		});
	}

	#drop(id: string, desktop: Desktop, code: number): void {
		this.#desktops.delete(id);
		for (const phone of desktop.phones.values()) phone.close(OFFLINE, "the Mac went away");
		desktop.phones.clear();
		if (desktop.socket.readyState === desktop.socket.OPEN) desktop.socket.close(code);
	}

	#ping(): void {
		for (const socket of this.#wss.clients) {
			const alive = socket as WebSocket & { alive?: boolean };
			if (alive.alive === false) {
				socket.terminate();
				continue;
			}
			alive.alive = false;
			socket.ping();
		}
	}
}

function toBuffer(data: RawData): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (Array.isArray(data)) return Buffer.concat(data);
	return Buffer.from(data);
}

function parse(data: RawData, binary: boolean): Record<string, unknown> | null {
	if (binary) return null;
	try {
		const value = JSON.parse(toBuffer(data).toString("utf8"));
		return value && typeof value === "object" ? value : null;
	} catch {
		return null;
	}
}
