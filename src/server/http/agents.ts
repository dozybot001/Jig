import { Hono } from "hono";
import type { QuestionAnswer } from "../../shared/types.ts";
import type { Agents } from "../agent/runner.ts";
import { invalid } from "../errors.ts";
import type { Store } from "../store.ts";
import { idempotent } from "./idempotency.ts";
import { optArray, optEnum, optString, readJson, reqString } from "./input.ts";
import type { AppEnv } from "./problem.ts";

/** One answer of a structured question card: option indexes and the person's own words. */
function questionAnswer(value: unknown): QuestionAnswer {
	const fields = (value && typeof value === "object" ? value : null) as Record<
		string,
		unknown
	> | null;
	const choices = fields?.choices;
	if (!fields || !Array.isArray(choices) || choices.some((choice) => !Number.isInteger(choice))) {
		throw invalid("Each answer needs a list of option numbers in choices.", "answers");
	}
	const text = fields.text;
	if (text !== undefined && (typeof text !== "string" || text.length > 10_000)) {
		throw invalid("An answer's text must be text of at most 10000 characters.", "answers");
	}
	return { choices: choices as number[], ...(typeof text === "string" ? { text } : {}) };
}

/** Sending messages, stopping, continuing, and answering approvals and questions. */
/**
 * A decision made on a paired phone. "Always allow" for a tool that acts with the person's sign-ins
 * is only given where its scope is said (spec 21.2), and the phone's card does not show that yet:
 * from a phone it allows this one call. Security review, 2026-11-16.
 */
export function decisionFromPhone<T extends string>(
	decision: T,
	request: unknown,
): T | "allow_once" {
	const warned = (request as { warning?: unknown } | null)?.warning !== undefined;
	return decision === "allow_always" && warned ? "allow_once" : decision;
}

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

	// The conversation goes back to a reply, or to just before one of the person's messages.
	app.post("/sessions/:id/rewind", async (c) => {
		const id = c.req.param("id");
		const withdrawn = agents.rewind(id, reqString(await readJson(c), "entryId", 100));
		return c.json({ withdrawn, session: store.getSession(id) });
	});

	app.post("/sessions/:id/compact", (c) => {
		const id = c.req.param("id");
		store.getSession(id);
		void agents.compactNow(id).catch((error: Error) => log(`compact ${id}: ${error.message}`));
		return c.body(null, 202);
	});

	app.post("/approvals/:id", async (c) => {
		const fields = await readJson(c);
		const asked = optEnum(fields, "decision", ["allow_once", "allow_always", "deny"] as const);
		const decision =
			asked && c.env?.device
				? decisionFromPhone(asked, store.getApproval(c.req.param("id")).request)
				: asked;
		const reason = optString(fields, "reason", 2000);
		const answer = optString(fields, "answer", 10_000);
		const answers = optArray(fields, "answers")?.map(questionAnswer);
		return c.json(
			agents.answer(c.req.param("id"), {
				...(decision ? { decision } : {}),
				...(reason ? { reason } : {}),
				...(answer !== undefined ? { answer } : {}),
				...(answers ? { answers } : {}),
			}),
		);
	});

	return app;
}
