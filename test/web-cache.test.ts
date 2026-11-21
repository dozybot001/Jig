import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createApp } from "../src/server/http/app.ts";
import { newStore, tempDir } from "./helpers/store.ts";

describe("the interface's files", () => {
	test("the page is checked on every load; hashed assets are kept for good", async () => {
		const { store } = newStore();
		const webRoot = tempDir("yew-web-");
		mkdirSync(join(webRoot, "assets"));
		writeFileSync(join(webRoot, "index.html"), '<script src="/assets/index-abc.js"></script>');
		writeFileSync(join(webRoot, "assets", "index-abc.js"), "1");
		const app = createApp({ store, webRoot, log: () => {} });
		for (const path of ["/", "/index.html", "/sessions/abc"]) {
			const page = await app.request(path);
			assert.equal(page.status, 200, path);
			assert.equal(page.headers.get("Cache-Control"), "no-cache", path);
		}
		const asset = await app.request("/assets/index-abc.js");
		assert.equal(asset.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
	});
});
