import { Hono } from "hono";
import type { Updates } from "../updates.ts";
import { optBoolean, readJson, reqString } from "./input.ts";
import type { AppEnv } from "./problem.ts";

/** Versions and updates (updates.ts). For the Mac's browser only: phones cannot reach them (security.ts). */
export function updateRoutes(updates: Updates): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/updates", (c) => c.json(updates.state()));

	app.post("/updates/check", async (c) => c.json(await updates.check()));

	app.post("/updates/install", async (c) => {
		const fields = await readJson(c);
		return c.json(updates.install(reqString(fields, "version", 40)), 202);
	});

	app.post("/updates/restart", async (c) => {
		const fields = await readJson(c);
		return c.json(updates.restart(optBoolean(fields, "now") ?? false), 202);
	});

	return app;
}
