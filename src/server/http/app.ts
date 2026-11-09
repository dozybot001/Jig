import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { VERSION } from "../../shared/version.ts";
import type { Agents } from "../agent/runner.ts";
import type { EventBus } from "../events.ts";
import { PostOffice } from "../mail/post.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { Store } from "../store.ts";
import { agentRoutes } from "./agents.ts";
import { api } from "./api.ts";
import { DraftCache, eventRoutes } from "./events.ts";
import { mailRoutes } from "./mail.ts";
import { type AppEnv, errorHandler, problemResponse, requestId, titleFor } from "./problem.ts";
import { providerRoutes } from "./providers.ts";
import { authRoutes, localOnly, requireBrowser, securityHeaders } from "./security.ts";

export interface AppOptions {
	store: Store;
	gateway?: ModelGateway;
	agents?: Agents;
	bus?: EventBus;
	log?: (line: string) => void;
	/** Turns on the Host, Origin and sign-in checks for this port. Tests of the API alone leave it out. */
	security?: { port: number };
	/** The built web interface (`web/dist`). */
	webRoot?: string;
	/** Short commit of the running code, shown as the build number (spec 2.2). */
	build?: string | null;
	/** Replaces the system folder picker; tests use it so they never open a window. */
	pickFolder?: () => Promise<string | null>;
}

const NOT_BUILT = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Jig</title>
<meta name="color-scheme" content="light dark"></head><body>
<p>网页界面还没有构建。在 Jig 的目录运行 npm run build:web，然后刷新这个页面。</p>
<p lang="en">The web interface has not been built yet. In the Jig folder, run npm run build:web, then reload this page.</p>
</body></html>`;

export function createApp(options: AppOptions): Hono<AppEnv> {
	const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
	const { store, gateway, agents, bus } = options;
	const app = new Hono<AppEnv>();
	app.use("*", requestId());
	app.use("*", securityHeaders());
	app.onError(errorHandler(log));
	app.notFound((c) => problemResponse(c, 404, "not-found", titleFor(404), "No such endpoint."));

	if (options.security) {
		app.use("*", localOnly(options.security.port));
		app.use("*", requireBrowser(store, options.security.port));
		app.route("/api", authRoutes(store, options.security.port));
	}
	app.get("/api/health", (c) =>
		c.json({ ok: true, version: VERSION, build: options.build ?? null }),
	);
	app.route(
		"/api",
		api({
			store,
			...(gateway ? { checkModel: (p: string, m: string) => gateway.check(p, m) } : {}),
			...(options.pickFolder ? { pickFolder: options.pickFolder } : {}),
			...(agents ? { onArchived: (id: string) => agents.archived(id) } : {}),
		}),
	);
	if (gateway) app.route("/api", providerRoutes(store, gateway));
	if (agents) app.route("/api", agentRoutes(store, agents, log));
	// The runner's post office, so a released letter or a decision wakes its recipient.
	app.route("/api", mailRoutes(agents?.post ?? new PostOffice(store, log)));
	if (bus) app.route("/api", eventRoutes(store, bus, new DraftCache(bus)));

	const root = options.webRoot;
	if (root && existsSync(join(root, "index.html"))) {
		// Read per request, so a rebuilt interface (npm run watch:web) is served without a restart.
		const index = () => readFileSync(join(root, "index.html"), "utf8");
		app.use("/assets/*", async (c, next) => {
			await next();
			// Built assets have content hashes in their names, so they can be cached for good.
			if (c.res.status === 200) {
				c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
			}
		});
		app.use("*", serveStatic({ root }));
		app.get("*", (c) => {
			if (c.req.path.startsWith("/api/")) return c.notFound();
			c.header("Cache-Control", "no-cache");
			return c.html(index());
		});
	} else {
		app.get("/", (c) => c.html(NOT_BUILT));
	}
	return app;
}
