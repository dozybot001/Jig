import { VERSION } from "../shared/version.ts";
import { openDatabase } from "./db/database.ts";
import { EventBus } from "./events.ts";
import { KeychainStore, type KeyStore } from "./keys.ts";
import { ModelGateway } from "./model/gateway.ts";
import { dbPath, ensureDir, jigHome } from "./paths.ts";
import { Store } from "./store.ts";

export interface Runtime {
	home: string;
	store: Store;
	bus: EventBus;
	keys: KeyStore;
	gateway: ModelGateway;
	close(): void;
}

/** Opens Jig's data directory, database, keychain and model catalog. Used by `jig serve` and the CLI. */
export function openRuntime(
	options: { env?: Record<string, string | undefined>; keys?: KeyStore } = {},
): Runtime {
	const home = ensureDir(jigHome(options.env));
	const bus = new EventBus();
	const db = openDatabase(dbPath(home));
	const store = new Store(db, bus);
	const keys = options.keys ?? new KeychainStore();
	const gateway = new ModelGateway({ keys, version: VERSION, custom: store.listCustomProviders() });
	return { home, store, bus, keys, gateway, close: () => db.close() };
}
