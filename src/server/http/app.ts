import { Hono } from "hono";
import type { ModelGateway } from "../model/gateway.ts";
import type { Store } from "../store.ts";
import { api } from "./api.ts";
import { type AppEnv, errorHandler, problemResponse, requestId, titleFor } from "./problem.ts";
import { providerRoutes } from "./providers.ts";

export interface AppOptions {
	store: Store;
	gateway?: ModelGateway;
	log?: (line: string) => void;
}

export function createApp(options: AppOptions): Hono<AppEnv> {
	const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
	const { store, gateway } = options;
	const app = new Hono<AppEnv>();
	app.use("*", requestId());
	app.onError(errorHandler(log));
	app.notFound((c) => problemResponse(c, 404, "not-found", titleFor(404), "No such endpoint."));
	app.route(
		"/api",
		api({
			store,
			...(gateway ? { checkModel: (p: string, m: string) => gateway.check(p, m) } : {}),
		}),
	);
	if (gateway) app.route("/api", providerRoutes(store, gateway));
	return app;
}
