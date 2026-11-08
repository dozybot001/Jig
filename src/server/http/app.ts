import { Hono } from "hono";
import { type ApiDeps, api } from "./api.ts";
import { type AppEnv, errorHandler, problemResponse, requestId, titleFor } from "./problem.ts";

export interface AppOptions extends ApiDeps {
	log?: (line: string) => void;
}

export function createApp(options: AppOptions): Hono<AppEnv> {
	const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
	const app = new Hono<AppEnv>();
	app.use("*", requestId());
	app.onError(errorHandler(log));
	app.notFound((c) => problemResponse(c, 404, "not-found", titleFor(404), "No such endpoint."));
	app.route("/api", api(options));
	return app;
}
