import { hostname } from "node:os";
import type { KeyStore } from "../server/keys.ts";
import { readSettings } from "../server/settings.ts";
import type { Store } from "../server/store.ts";
import type { Device } from "../shared/types.ts";
import { Connector } from "./connector.ts";
import { createPairing, type Identity, loadIdentity } from "./identity.ts";
import { MAX_PUSH_DATA, pushKey, sealPush } from "./push.ts";

/** Where remote access stands, for the settings page and `yew remote status`. */
export interface RemoteStatus {
	enabled: boolean;
	connected: boolean;
	relayUrl: string;
	desktopId: string | null;
}

/** The name phones see for this Mac: the host name without `.local`. */
export const desktopName = () => hostname().replace(/\.local$/, "") || "Mac";

/**
 * Starts and stops the relay connection to match the settings, which the interface, `manage_yew` and
 * `yew remote` change; `sync` runs every few seconds, so changes made from the command line take hold.
 */
export class RemoteAccess {
	readonly #store: Store;
	readonly #keys: KeyStore;
	readonly #options: {
		version: string;
		handle(request: Request, device: Device): Promise<Response>;
		log?: (line: string) => void;
		WebSocketImpl?: typeof WebSocket;
	};
	#identity: Identity | null = null;
	#connector: Connector | null = null;
	/** Each phone's notification key, by its public key. */
	readonly #pushKeys = new Map<string, Buffer>();

	constructor(
		store: Store,
		keys: KeyStore,
		options: {
			version: string;
			handle(request: Request, device: Device): Promise<Response>;
			log?: (line: string) => void;
			WebSocketImpl?: typeof WebSocket;
		},
	) {
		this.#store = store;
		this.#keys = keys;
		this.#options = options;
	}

	async identity(): Promise<Identity> {
		this.#identity ??= await loadIdentity(this.#keys);
		return this.#identity;
	}

	async sync(): Promise<void> {
		const { enabled, relayUrl } = readSettings(this.#store).remote;
		const current = this.#connector;
		if (current && (!enabled || current.relayUrl !== relayUrl)) {
			current.stop();
			this.#connector = null;
		}
		if (!enabled || this.#connector) return;
		this.#connector = new Connector({
			store: this.#store,
			identity: await this.identity(),
			relayUrl,
			desktopName: desktopName(),
			version: this.#options.version,
			handle: this.#options.handle,
			onPushResult: (result) => {
				// Apple no longer knows the token (the app was removed, or restored elsewhere): forget it.
				if (result.gone) this.#store.dropPushToken(result.token);
				else if (!result.ok) this.#options.log?.(`notifications: ${result.reason ?? "not sent"}`);
			},
			...(this.#options.log ? { log: this.#options.log } : {}),
			...(this.#options.WebSocketImpl ? { WebSocketImpl: this.#options.WebSocketImpl } : {}),
		});
		this.#connector.start();
	}

	status(): RemoteStatus {
		const { enabled, relayUrl } = readSettings(this.#store).remote;
		return {
			enabled,
			connected: this.#connector?.connected ?? false,
			relayUrl,
			desktopId: this.#identity?.desktopId ?? null,
		};
	}

	/** A pairing QR code's content, valid five minutes and once. */
	async pairing(): Promise<{ link: string; expiresAt: number }> {
		const { relayUrl } = readSettings(this.#store).remote;
		return createPairing(this.#store, await this.identity(), {
			relay: relayUrl,
			name: desktopName(),
		});
	}

	/**
	 * Sends one notification to every paired phone that takes them, each sealed with that phone's key.
	 * Returns how many the relay was asked to deliver.
	 */
	push(note: object, mode: "alert" | "background", id?: string): number {
		const connector = this.#connector;
		const identity = this.#identity;
		if (!connector?.connected || !identity) return 0;
		const plaintext = Buffer.from(JSON.stringify(note));
		let sent = 0;
		for (const target of this.#store.pushTargets()) {
			let key = this.#pushKeys.get(target.publicKey);
			if (!key) {
				key = pushKey(identity.noise, Buffer.from(target.publicKey, "base64url"));
				this.#pushKeys.set(target.publicKey, key);
			}
			const data = sealPush(key, plaintext).toString("base64");
			if (data.length > MAX_PUSH_DATA) continue;
			if (connector.push({ token: target.token, data, mode, ...(id ? { id } : {}) })) sent += 1;
		}
		return sent;
	}

	/** A revoked device loses its open connections at once. */
	disconnect(deviceId: string): void {
		this.#connector?.disconnect(deviceId);
	}

	stop(): void {
		this.#connector?.stop();
		this.#connector = null;
	}
}
