import type { AssistantMessage } from "../shared/messages.ts";
import type { Approval, Card, Group, Letter, Session, SessionEvent } from "../shared/types.ts";

/** Ephemeral updates: not stored, not replayed; a reconnecting client gets a fresh snapshot instead. */
export type LiveEvent =
	| { type: "draft"; draft: AssistantMessage }
	| { type: "draftCleared" }
	| { type: "toolOutput"; toolCallId: string; output: string };

/**
 * Updates every tab hears: the sidebar, the approval center and the letters list. Volatile: after a
 * reconnect the client reloads them.
 */
export type GlobalEvent =
	| { type: "sessionSummary"; session: Session }
	| { type: "groups"; groups: Group[] }
	| { type: "approval"; approval: Approval }
	| { type: "letter"; letter: Letter }
	| { type: "card"; card: Card };

export type BusEvent =
	| { scope: "session"; sessionId: string; seq: number; event: SessionEvent }
	| { scope: "live"; sessionId: string; event: LiveEvent }
	| { scope: "global"; event: GlobalEvent };

type Listener = (event: BusEvent) => void;

export class EventBus {
	readonly #listeners = new Set<Listener>();

	publish(event: BusEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch {
				// A failing subscriber must not stop delivery to the others.
			}
		}
	}

	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}
