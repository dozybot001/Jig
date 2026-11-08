import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/server/db/database.ts";
import { type BusEvent, EventBus } from "../../src/server/events.ts";
import { Store } from "../../src/server/store.ts";

export function newStore(path = ":memory:") {
	const bus = new EventBus();
	const events: BusEvent[] = [];
	bus.subscribe((event) => events.push(event));
	const store = new Store(openDatabase(path), bus);
	return { store, bus, events };
}

/** A throwaway directory, never the real ~/.jig. */
export function tempDir(prefix = "jig-test-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export const sessionInput = (name = "Jig · 开发") => ({
	name,
	kind: "standing" as const,
	provider: "deepseek",
	model: "deepseek-v4-pro",
});
