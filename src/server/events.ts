import type { AssistantMessage } from "../shared/messages.ts";
import type {
	Approval,
	Artifact,
	Card,
	Device,
	Group,
	Letter,
	Schedule,
	Session,
	SessionEvent,
} from "../shared/types.ts";

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
	| { type: "card"; card: Card }
	/** Archived sessions the person deleted for good. */
	| { type: "sessionsDeleted"; ids: string[] }
	/** Paired phones changed, or the relay connection did. */
	| { type: "devices"; devices: Device[] }
	/** A scheduled task was added, changed, run or removed. */
	| { type: "schedules"; schedules: Schedule[] }
	/** A session saved an artifact or a new version of one. */
	| { type: "artifact"; artifact: Artifact }
	| { type: "artifactDeleted"; id: string };

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
