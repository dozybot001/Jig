import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AssistantMessage } from "../../shared/messages.ts";
import type { SessionEvent } from "../../shared/types.ts";
import type { BusEvent, EventBus } from "../events.ts";
import type { Store } from "../store.ts";
import type { AppEnv } from "./problem.ts";

const KEEPALIVE_MS = 15_000;
const MAX_QUEUE = 2000;

/**
 * A session event as the stream sends it. A conversation taken back changes entries already shown,
 * so clients load it again: every client, phones included, already does that on "reset".
 */
function sessionMessage(
	seq: number,
	event: SessionEvent,
): { event: string; id?: string; data: string } {
	if (event.type === "rewound") return { event: "reset", id: String(seq), data: "{}" };
	return { event: "session", id: String(seq), data: JSON.stringify(event) };
}

/** Remembers each session's in-flight draft, so a client that connects mid-answer sees it at once. */
export class DraftCache {
	readonly #drafts = new Map<string, AssistantMessage>();

	constructor(bus: EventBus) {
		bus.subscribe((event) => {
			if (event.scope !== "live") return;
			if (event.event.type === "draft") this.#drafts.set(event.sessionId, event.event.draft);
			else if (event.event.type === "draftCleared") this.#drafts.delete(event.sessionId);
		});
	}

	get(sessionId: string): AssistantMessage | undefined {
		return this.#drafts.get(sessionId);
	}
}

/**
 * One event stream per browser tab (HTTP/1.1 allows six connections per host). It carries the
 * sidebar's events for every session, and the open session's transcript events. Transcript events
 * have the session's sequence number as their SSE id, so after a reconnect the browser's
 * `Last-Event-ID` resumes from the database; drafts and sidebar updates are not replayed, and the
 * client reloads instead (prior-art 5.1). A client that cannot keep up is disconnected.
 */
export function eventRoutes(store: Store, bus: EventBus, drafts: DraftCache): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/events", (c) => {
		const sessionId = c.req.query("session") ?? null;
		const lastId = c.req.header("Last-Event-ID") ?? c.req.query("after");
		const after = lastId !== undefined && /^\d+$/.test(lastId) ? Number(lastId) : null;
		if (sessionId) store.getSession(sessionId);

		return streamSSE(c, async (stream) => {
			const queue: { event: string; data: string; id?: string }[] = [];
			let wake: (() => void) | null = null;
			let overflow = false;
			let replayedUpTo = after ?? 0;
			let replaying = true;
			const buffered: BusEvent[] = [];

			const push = (item: { event: string; data: string; id?: string }) => {
				if (queue.length >= MAX_QUEUE) {
					overflow = true;
				} else {
					queue.push(item);
				}
				wake?.();
			};
			const forward = (event: BusEvent) => {
				if (event.scope === "global") {
					push({ event: "global", data: JSON.stringify(event.event) });
				} else if (event.sessionId === sessionId) {
					if (event.scope === "live") push({ event: "live", data: JSON.stringify(event.event) });
					else if (event.seq > replayedUpTo) {
						replayedUpTo = event.seq;
						push(sessionMessage(event.seq, event.event));
					}
				}
			};
			// Subscribe before reading the database, so nothing falls between replay and live events.
			const unsubscribe = bus.subscribe((event) => {
				if (replaying) buffered.push(event);
				else forward(event);
			});
			stream.onAbort(() => {
				unsubscribe();
				wake?.();
			});

			push({ event: "hello", data: JSON.stringify({ time: Date.now() }) });
			if (sessionId && after !== null) {
				const { events, complete } = store.eventsAfter(sessionId, after, MAX_QUEUE);
				if (!complete || events.length >= MAX_QUEUE) {
					push({ event: "reset", data: "{}" });
					replayedUpTo = store.getSession(sessionId).eventSeq;
				} else {
					for (const { seq, event } of events) {
						replayedUpTo = seq;
						push(sessionMessage(seq, event));
					}
				}
			} else if (sessionId) {
				replayedUpTo = store.getSession(sessionId).eventSeq;
			}
			const draft = sessionId ? drafts.get(sessionId) : undefined;
			if (draft) push({ event: "live", data: JSON.stringify({ type: "draft", draft }) });
			replaying = false;
			for (const event of buffered.splice(0)) forward(event);

			const keepalive = setInterval(() => {
				void stream.write(": keepalive\n\n");
			}, KEEPALIVE_MS);
			try {
				while (!stream.aborted && !overflow) {
					const item = queue.shift();
					if (item) {
						await stream.writeSSE(item);
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					wake = null;
				}
			} finally {
				clearInterval(keepalive);
				unsubscribe();
				if (overflow && !stream.aborted) await stream.writeSSE({ event: "reset", data: "{}" });
			}
		});
	});

	return app;
}
