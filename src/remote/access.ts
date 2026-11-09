import { hostname } from "node:os";
import type { KeyStore } from "../server/keys.ts";
import { readSettings } from "../server/settings.ts";
import type { Store } from "../server/store.ts";
import type { Device } from "../shared/types.ts";
import { Connector } from "./connector.ts";
import { createPairing, type Identity, loadIdentity } from "./identity.ts";

/** Where remote access stands, for the settings page and `jig remote status`. */
export interface RemoteStatus {
	enabled: boolean;
	connected: boolean;
	relayUrl: string;
	desktopId: string | null;
}

/** The name phones see for this Mac: the host name without `.local`. */
export const desktopName = () => hostname().replace(/\.local$/, "") || "Mac";

/**
 * Starts and stops the relay connection to match the settings, which the interface, `manage_jig` and
 * `jig remote` change; `sync` runs every few seconds, so changes made from the command line take hold.
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

	/** A revoked device loses its open connections at once. */
	disconnect(deviceId: string): void {
		this.#connector?.disconnect(deviceId);
	}

	stop(): void {
		this.#connector?.stop();
		this.#connector = null;
	}
}
