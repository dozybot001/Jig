import { Hono } from "hono";
import { invalid, notFound } from "../errors.ts";
import type { CustomProviderConfig, ModelGateway } from "../model/gateway.ts";
import type { Store } from "../store.ts";
import {
	type Fields,
	optArray,
	optBoolean,
	optNumber,
	optString,
	pageParams,
	readJson,
	reqString,
} from "./input.ts";
import type { AppEnv } from "./problem.ts";

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function parseCustomProvider(id: string, fields: Fields): CustomProviderConfig {
	if (!PROVIDER_ID.test(id)) {
		throw invalid("The provider id uses lowercase letters, digits and dashes, up to 40.", "id");
	}
	const name = reqString(fields, "name", 60).trim();
	if (!name) throw invalid("The name cannot be empty.", "name");
	const baseUrl = reqString(fields, "baseUrl", 2000);
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw invalid("The base URL is not a valid URL.", "baseUrl");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw invalid("The base URL must start with http:// or https://.", "baseUrl");
	}
	const models = optArray(fields, "models") ?? [];
	if (models.length === 0 || models.length > 100) {
		throw invalid("Add between 1 and 100 models.", "models");
	}
	return {
		id,
		name,
		baseUrl: baseUrl.replace(/\/+$/, ""),
		keyRequired: optBoolean(fields, "keyRequired") ?? true,
		models: models.map((item, index) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) {
				throw invalid(`Model ${index + 1} must be an object.`, "models");
			}
			const model = item as Fields;
			const contextWindow = optNumber(model, "contextWindow");
			const maxTokens = optNumber(model, "maxTokens");
			if (!contextWindow || !Number.isInteger(contextWindow) || contextWindow < 1000) {
				throw invalid(
					`Model ${index + 1} needs a context window of at least 1000 tokens.`,
					"models",
				);
			}
			if (!maxTokens || !Number.isInteger(maxTokens) || maxTokens > contextWindow) {
				throw invalid(
					`Model ${index + 1} needs a maximum output no larger than its context window.`,
					"models",
				);
			}
			const modelName = optString(model, "name", 100);
			const reasoning = optBoolean(model, "reasoning");
			const images = optBoolean(model, "images");
			return {
				id: reqString(model, "id", 200),
				...(modelName ? { name: modelName } : {}),
				contextWindow,
				maxTokens,
				...(reasoning !== undefined ? { reasoning } : {}),
				input: images ? (["text", "image"] as const).slice() : ["text"],
			};
		}),
	};
}

/** Model providers, their models, and their API keys. Keys are written to the keychain and never read back. */
export function providerRoutes(store: Store, gateway: ModelGateway): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/providers", async (c) => {
		const providers = gateway.providers();
		const items = await Promise.all(
			providers.map(async (provider) => ({
				...provider,
				hasKey: await gateway.hasKey(provider.id),
				modelCount: gateway.models(provider.id).length,
			})),
		);
		return c.json({ items, nextCursor: null });
	});

	app.get("/providers/:id/models", (c) => {
		const id = c.req.param("id");
		if (!gateway.provider(id)) throw notFound("Provider", id);
		const { limit, cursor } = pageParams(c, 500);
		const all = gateway.models(id);
		const start = cursor ? all.findIndex((model) => model.id === cursor) + 1 : 0;
		const items = all.slice(start, start + limit);
		const more = start + limit < all.length;
		return c.json({ items, nextCursor: more ? (items.at(-1)?.id ?? null) : null });
	});

	app.put("/providers/:id/key", async (c) => {
		const id = c.req.param("id");
		if (!gateway.provider(id)) throw notFound("Provider", id);
		const fields = await readJson(c);
		const key = reqString(fields, "key", 4096).trim();
		if (!key) throw invalid("The key cannot be empty.", "key");
		await gateway.saveKey(id, key);
		return c.body(null, 204);
	});

	app.delete("/providers/:id/key", async (c) => {
		const id = c.req.param("id");
		if (!gateway.provider(id)) throw notFound("Provider", id);
		await gateway.deleteKey(id);
		return c.body(null, 204);
	});

	app.put("/providers/:id", async (c) => {
		const id = c.req.param("id");
		const existing = gateway.provider(id);
		if (existing && !existing.custom) throw invalid(`${id} is a built-in provider.`, "id");
		const config = parseCustomProvider(id, await readJson(c));
		const others = store.listCustomProviders().filter((provider) => provider.id !== id);
		gateway.setCustomProviders([...others, config]);
		store.saveCustomProvider(config);
		return c.json(gateway.provider(id), existing ? 200 : 201);
	});

	app.delete("/providers/:id", async (c) => {
		const id = c.req.param("id");
		const existing = gateway.provider(id);
		if (!existing?.custom) throw notFound("Custom provider", id);
		store.deleteCustomProvider(id);
		gateway.setCustomProviders(store.listCustomProviders());
		await gateway.deleteKey(id);
		return c.body(null, 204);
	});

	return app;
}
