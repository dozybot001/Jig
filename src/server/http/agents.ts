import { Hono } from "hono";
import type { Agents } from "../agent/runner.ts";
import type { Store } from "../store.ts";
import { idempotent } from "./idempotency.ts";
import { optEnum, optString, readJson, reqString } from "./input.ts";
import type { AppEnv } from "./problem.ts";

/** Sending messages, stopping, continuing, and answering approvals and questions. */
export function agentRoutes(
	store: Store,
	agents: Agents,
	log: (line: string) => void,
): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	const once = idempotent(store.db);

	// The person deletes all archived sessions for good (settings, data); the interface asks first.
	app.delete("/sessions/archived", (c) => c.json({ deleted: agents.deleteArchived() }));

	app.post("/sessions/:id/messages", once, async (c) => {
		const fields = await readJson(c);
		const result = agents.send(c.req.param("id"), reqString(fields, "text", 100_000));
		return c.json(result, "entry" in result ? 201 : 202);
	});

	app.post("/sessions/:id/stop", (c) => {
		const id = c.req.param("id");
		store.getSession(id);
		agents.stop(id);
		return c.body(null, 204);
	});

	app.post("/sessions/:id/continue", (c) => {
		const id = c.req.param("id");
		agents.continue(id);
		return c.json(store.getSession(id), 202);
	});

	app.post("/sessions/:id/compact", (c) => {
		const id = c.req.param("id");
		store.getSession(id);
		void agents.compactNow(id).catch((error: Error) => log(`compact ${id}: ${error.message}`));
		return c.body(null, 202);
	});

	app.post("/approvals/:id", async (c) => {
		const fields = await readJson(c);
		const decision = optEnum(fields, "decision", ["allow_once", "allow_always", "deny"] as const);
		const reason = optString(fields, "reason", 2000);
		const answer = optString(fields, "answer", 10_000);
		return c.json(
			agents.answer(c.req.param("id"), {
				...(decision ? { decision } : {}),
				...(reason ? { reason } : {}),
				...(answer !== undefined ? { answer } : {}),
			}),
		);
	});

	return app;
}
