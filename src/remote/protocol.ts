import { createHash } from "node:crypto";

/**
 * What the Mac, the relay and the phone agree on (M3 plan, sections 4–6). The relay reads only the
 * outer frames; everything in `ChannelMessage` travels inside the Noise channel.
 */

/** Signed by the Mac when it connects, after the relay's nonce. */
export const CHALLENGE_PREFIX = "jig-relay-desktop:";
/** Mixed into every handshake with the Mac's id, so a handshake cannot be replayed to another Mac. */
export const PROLOGUE_PREFIX = "jig-remote/1:";
/** The relay closes a phone's connection with this code when its Mac is not connected. */
export const OFFLINE = 4404;

/** The id a Mac is reached by: the first 16 bytes of the SHA-256 of its Ed25519 public key. */
export function desktopIdOf(publicKey: Buffer): string {
	return createHash("sha256").update(publicKey).digest().subarray(0, 16).toString("base64url");
}

export const prologueFor = (desktopId: string) => Buffer.from(PROLOGUE_PREFIX + desktopId);

/**
 * A relay address Jig accepts: wss:// anywhere, ws:// only inside this network (this Mac, `.local`
 * names, private addresses), for a test relay. The channel is end-to-end encrypted either way.
 */
export const RELAY_URL =
	/^wss:\/\/[^/\s]+|^ws:\/\/(127\.0\.0\.1|localhost|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?(\/|$)/;

/** What the pairing QR code carries. */
export interface PairingLink {
	relay: string;
	desktop: string;
	/** The Mac's Noise static key, base64url. */
	key: string;
	/** The one-time pairing secret, base64url. */
	secret: string;
	name: string;
}

export function pairingLink(link: PairingLink): string {
	const query = new URLSearchParams({
		r: link.relay,
		d: link.desktop,
		k: link.key,
		s: link.secret,
		n: link.name,
	});
	return `jig://pair?${query.toString()}`;
}

export function parsePairingLink(text: string): PairingLink | null {
	if (!text.startsWith("jig://pair?")) return null;
	const query = new URLSearchParams(text.slice("jig://pair?".length));
	const [relay, desktop, key, secret, name] = ["r", "d", "k", "s", "n"].map((k) => query.get(k));
	if (!relay || !desktop || !key || !secret) return null;
	return { relay, desktop, key, secret, name: name ?? "" };
}

/** The phone's first handshake payload. `pair` carries the secret when it is not paired yet. */
export interface Hello {
	pair?: string;
	/** What the phone calls itself, for the device list. */
	name?: string;
	/** The app's version. */
	app?: string;
}

/** The Mac's handshake answer. */
export interface Welcome {
	desktop: string;
	version: string;
	/** The phone's id in the Mac's device list. */
	device: string;
}

/**
 * Requests and responses inside the channel: the phone uses the Mac's local API as the web interface
 * does. A streamed response (the event stream) comes as `head`, then `chunk`s, then `end`.
 */
export type ChannelMessage =
	| { t: "req"; id: number; method: string; path: string; body?: string }
	| { t: "cancel"; id: number }
	| { t: "res"; id: number; status: number; type: string; body: string }
	| { t: "head"; id: number; status: number; type: string }
	| { t: "chunk"; id: number; data: string }
	| { t: "end"; id: number };
