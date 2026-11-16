import type { Store } from "../store.ts";

/**
 * Sessions that are held back: ones the person stopped, and ones that stopped at a daily spending
 * limit. Kept in the database, so Jig behaves the same after a restart: a session the person stopped
 * is not started by a letter, and one at a limit goes on when the limit is raised that day.
 */
export class Held {
	readonly #store: Store;
	readonly #paused: Set<string>;
	/** The day (local) each session stopped at a limit. */
	readonly #capped: Map<string, string>;

	constructor(store: Store) {
		this.#store = store;
		this.#paused = new Set(store.getSetting<string[]>("pausedSessions", []));
		this.#capped = new Map(
			Object.entries(store.getSetting<Record<string, string>>("cappedSessions", {})),
		);
	}

	isPaused(sessionId: string): boolean {
		return this.#paused.has(sessionId);
	}

	pause(sessionId: string): void {
		if (this.#paused.has(sessionId)) return;
		this.#paused.add(sessionId);
		this.#store.setSetting("pausedSessions", [...this.#paused]);
	}

	resume(sessionId: string): void {
		if (this.#paused.delete(sessionId)) this.#store.setSetting("pausedSessions", [...this.#paused]);
	}

	capped(): [string, string][] {
		return [...this.#capped];
	}

	cap(sessionId: string, day: string): void {
		if (this.#capped.get(sessionId) === day) return;
		this.#capped.set(sessionId, day);
		this.#store.setSetting("cappedSessions", Object.fromEntries(this.#capped));
	}

	uncap(sessionId: string): void {
		if (this.#capped.delete(sessionId)) {
			this.#store.setSetting("cappedSessions", Object.fromEntries(this.#capped));
		}
	}

	/** The session is gone for good. */
	forget(sessionId: string): void {
		this.resume(sessionId);
		this.uncap(sessionId);
	}
}
