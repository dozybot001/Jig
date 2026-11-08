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
	#entry(provider: string): AsyncEntry {
		return new AsyncEntry(KEYCHAIN_SERVICE, `provider:${provider}`);
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
