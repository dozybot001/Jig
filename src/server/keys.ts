import { AsyncEntry } from "@napi-rs/keyring";

/** Where API keys live. They never go into SQLite, logs, URLs or command arguments (spec 15.1.3). */
export interface KeyStore {
	get(provider: string): Promise<string | null>;
	set(provider: string, key: string): Promise<void>;
	/** Resolves true when a key was there to delete. */
	delete(provider: string): Promise<boolean>;
}

export const KEYCHAIN_SERVICE = "asia.tenon.jig";

/** The operating system keychain (macOS Keychain, Windows Credential Manager, Secret Service). */
export class KeychainStore implements KeyStore {
	readonly #prefix: string;

	/** `prefix` keeps different kinds apart: "provider" for API keys, "remote" for the relay keys. */
	constructor(prefix = "provider") {
		this.#prefix = prefix;
	}

	#entry(name: string): AsyncEntry {
		return new AsyncEntry(KEYCHAIN_SERVICE, `${this.#prefix}:${name}`);
	}

	get(provider: string): Promise<string | null> {
		return this.#entry(provider).getPassword();
	}

	set(provider: string, key: string): Promise<void> {
		return this.#entry(provider).setPassword(key);
	}

	delete(provider: string): Promise<boolean> {
		return this.#entry(provider).deleteCredential();
	}
}

/**
 * The key store Jig runs with: the system keychain, or one in memory when `JIG_KEYCHAIN=off`.
 * The keychain is shared by every data folder on this computer, so a Jig started on a scratch
 * `JIG_HOME` to try something out would otherwise hold the real API keys and could call a model
 * with them. With the switch off it starts with no keys and forgets what is saved when it stops.
 */
export function systemKeys(prefix = "provider", env: NodeJS.ProcessEnv = process.env): KeyStore {
	return env.JIG_KEYCHAIN === "off" ? new MemoryKeyStore() : new KeychainStore(prefix);
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
