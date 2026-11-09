import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	type KeyObject,
	randomBytes,
	sign,
	timingSafeEqual,
} from "node:crypto";
import type { KeyStore } from "../server/keys.ts";
import type { Store } from "../server/store.ts";
import { type KeyPair, publicKeyOf } from "./noise.ts";
import { CHALLENGE_PREFIX, desktopIdOf, pairingLink } from "./protocol.ts";

/**
 * This Mac's keys for remote access: a Noise static key (X25519) that phones encrypt to, and an Ed25519
 * key that proves to the relay which Mac it is. Both private keys live in the system keychain only.
 */
export interface Identity {
	noise: KeyPair;
	signing: KeyObject;
	signingPublic: Buffer;
	desktopId: string;
}

const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_LENGTH = 12;

export async function loadIdentity(keys: KeyStore): Promise<Identity> {
	let noise = await keys.get("noise");
	if (!noise) {
		const { privateKey } = generateKeyPairSync("x25519");
		noise = privateKey.export({ format: "der", type: "pkcs8" }).subarray(16).toString("base64url");
		await keys.set("noise", noise);
	}
	let signingRaw = await keys.get("signing");
	if (!signingRaw) {
		const { privateKey } = generateKeyPairSync("ed25519");
		signingRaw = privateKey
			.export({ format: "der", type: "pkcs8" })
			.subarray(ED25519_PKCS8.length)
			.toString("base64url");
		await keys.set("signing", signingRaw);
	}
	const noisePrivate = Buffer.from(noise, "base64url");
	const signing = createPrivateKey({
		key: Buffer.concat([ED25519_PKCS8, Buffer.from(signingRaw, "base64url")]),
		format: "der",
		type: "pkcs8",
	});
	const signingPublic = createPublicKey(signing)
		.export({ format: "der", type: "spki" })
		.subarray(ED25519_SPKI_LENGTH);
	return {
		noise: { privateKey: noisePrivate, publicKey: publicKeyOf(noisePrivate) },
		signing,
		signingPublic,
		desktopId: desktopIdOf(signingPublic),
	};
}

export function signChallenge(identity: Identity, nonce: string): string {
	return sign(null, Buffer.from(CHALLENGE_PREFIX + nonce), identity.signing).toString("base64url");
}

const PAIRING_MS = 5 * 60 * 1000;
const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * A new pairing: the QR code's content, valid five minutes and once. Only the secret's hash is kept,
 * in the database, so `jig remote pair` and the running service share it.
 */
export function createPairing(
	store: Store,
	identity: Identity,
	options: { relay: string; name: string },
): { link: string; expiresAt: number } {
	const secret = randomBytes(18).toString("base64url");
	const expiresAt = Date.now() + PAIRING_MS;
	store.setSetting("pairing", { hash: sha256(secret).toString("hex"), expiresAt });
	return {
		link: pairingLink({
			relay: options.relay,
			desktop: identity.desktopId,
			key: identity.noise.publicKey.toString("base64url"),
			secret,
			name: options.name,
		}),
		expiresAt,
	};
}

/** Checks a phone's pairing secret and uses it up; a wrong one also ends the pairing. */
export function consumePairing(store: Store, secret: string): boolean {
	const pending = store.getSetting<{ hash: string; expiresAt: number } | null>("pairing", null);
	store.setSetting("pairing", null);
	if (!pending || pending.expiresAt < Date.now()) return false;
	const expected = Buffer.from(pending.hash, "hex");
	const given = sha256(secret);
	return expected.length === given.length && timingSafeEqual(expected, given);
}
