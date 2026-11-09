import { Hono } from "hono";
import { invalid } from "../errors.ts";
import type { PostOffice } from "../mail/post.ts";
import { idempotent } from "./idempotency.ts";
import { optEnum, optString, pageParams, readJson } from "./input.ts";
import type { AppEnv } from "./problem.ts";

/** The approval center, decisions and letters (M2 plan, section 8). */
export function mailRoutes(post: PostOffice): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	const once = idempotent(post.mail.db);

	// Everything waiting for the person, across sessions.
	app.get("/center", (c) => c.json(post.center()));

	app.get("/cards", (c) => {
		const { limit, cursor } = pageParams(c);
		const status = optEnum({ status: c.req.query("status") }, "status", [
			"pending",
			"decided",
			"withdrawn",
		] as const);
		if (cursor !== null && !/^\d+$/.test(cursor)) throw invalid("cursor is not valid.", "cursor");
		return c.json(
			post.mail.listCards({
				status: status ?? null,
				cursor: cursor ? Number(cursor) : null,
				limit,
			}),
		);
	});

	// The person decides: an option, a note, or both. Only the person can reach this, from Jig's page.
	app.post("/cards/:id/decide", once, async (c) => {
		const fields = await readJson(c);
		const choice = fields.choice;
		if (choice !== undefined && choice !== null && typeof choice !== "number") {
			throw invalid("choice must be the index of an option, or null.", "choice");
		}
		const note = optString(fields, "note", 4000) ?? null;
		return c.json(
			post.decide(c.req.param("id"), (choice as number | null | undefined) ?? null, note),
		);
	});

	app.get("/letters", (c) => {
		const { limit, cursor } = pageParams(c);
		const session = c.req.query("session") ?? null;
		return c.json(post.mail.listLetters({ sessionId: session, cursor, limit }));
	});

	app.post("/letters/:id/release", (c) => c.json(post.release(c.req.param("id"))));

	app.post("/letters/:id/refuse", (c) => c.json(post.refuse(c.req.param("id"))));

	return app;
}
