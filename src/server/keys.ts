import { AsyncEntry } from "@napi-rs/keyring";

/** Where API keys live. They never go into SQLite, logs, URLs or command arguments (spec 15.1.3). */
export interface KeyStore {
	get(provider: string): Promise<string | null>;
	set(provider: string, key: string): Promise<void>;
	/** Resolves true when a key was there to delete. */
	delete(provider: string): Promise<boolean>;
}

export const KEYCHAIN_SERVICE = "asia.tenon.yew";
/** Where Jig kept them before it was renamed Yew; a key found there moves over when first read. */
const JIG_SERVICE = "asia.tenon.jig";

/** The operating system keychain (macOS Keychain, Windows Credential Manager, Secret Service). */
export class KeychainStore implements KeyStore {
	readonly #prefix: string;

	/** `prefix` keeps different kinds apart: "provider" for API keys, "remote" for the relay keys. */
	constructor(prefix = "provider") {
		this.#prefix = prefix;
	}

	#entry(name: string, service = KEYCHAIN_SERVICE): AsyncEntry {
		return new AsyncEntry(service, `${this.#prefix}:${name}`);
	}

	async get(provider: string): Promise<string | null> {
		const key = await this.#entry(provider).getPassword();
		if (key !== null && key !== undefined) return key;
		const old = this.#entry(provider, JIG_SERVICE);
		const kept = await old.getPassword().catch(() => null);
		if (kept === null || kept === undefined) return null;
		await this.#entry(provider).setPassword(kept);
		await old.deleteCredential().catch(() => false);
		return kept;
	}

	async set(provider: string, key: string): Promise<void> {
		await this.#entry(provider).setPassword(key);
		await this.#entry(provider, JIG_SERVICE)
			.deleteCredential()
			.catch(() => false);
	}

	async delete(provider: string): Promise<boolean> {
		const had = await this.#entry(provider)
			.deleteCredential()
			.catch(() => false);
		const hadOld = await this.#entry(provider, JIG_SERVICE)
			.deleteCredential()
			.catch(() => false);
		return had || hadOld;
	}
}

/**
 * The key store Yew runs with: the system keychain, or one in memory when `YEW_KEYCHAIN=off` (or
 * `JIG_KEYCHAIN=off`, its name before the rename).
 * The keychain is shared by every data folder on this computer, so a Yew started on a scratch
 * `YEW_HOME` to try something out would otherwise hold the real API keys and could call a model
 * with them. With the switch off it starts with no keys and forgets what is saved when it stops.
 */
export function systemKeys(prefix = "provider", env: NodeJS.ProcessEnv = process.env): KeyStore {
	const off = (env.YEW_KEYCHAIN ?? env.JIG_KEYCHAIN) === "off";
	return off ? new MemoryKeyStore() : new KeychainStore(prefix);
}

/** For tests: keeps keys in memory. */
export class MemoryKeyStore implements KeyStore {
	readonly #keys = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [provider, key] of Object.entries(initial)) this.#keys.set(provider, key);
	}

	async get(provider: string): Promise<string | null> {
		return this.#keys.get(provider) ?? null;
	}

	async set(provider: string, key: string): Promise<void> {
		this.#keys.set(provider, key);
	}

	async delete(provider: string): Promise<boolean> {
		return this.#keys.delete(provider);
	}
}
