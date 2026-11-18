import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryKeyStore } from "../src/server/keys.ts";
import type { ToolContext } from "../src/server/tools/types.ts";
import { SearchAccess, webSearchTool } from "../src/server/tools/web-search.ts";
import type { JsonObject } from "../src/shared/messages.ts";
import type { Session } from "../src/shared/types.ts";

const ctx = { signal: new AbortController().signal } as ToolContext;
const session = {} as Session;
const roles = { canPostCards: false, canOrganize: false };

function setup(keys: Record<string, string>, answer: { status?: number; body: unknown }) {
	const calls: { url: string; init: RequestInit }[] = [];
	const access = new SearchAccess(new MemoryKeyStore(keys));
	const tool = webSearchTool(access, {
		version: "9.9.9",
		fetch: (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
		}) as unknown as typeof fetch,
	});
	const textOf = async (args: JsonObject) => {
		const result = await tool.run(args, ctx);
		return { text: result.content.map((b) => (b.type === "text" ? b.text : "")).join(""), result };
	};
	return { access, tool, calls, textOf };
}

describe("web_search", () => {
	test("is offered only once a search service has a key", async () => {
		const { access, tool } = setup({}, { body: {} });
		await access.refresh();
		assert.equal(tool.offered?.(session, roles), false);
		const ready = setup({ "search-tavily": "tvly-test" }, { body: {} });
		await ready.access.refresh();
		assert.equal(ready.tool.offered?.(session, roles), true);
		assert.deepEqual(ready.tool.subject({ query: "x" }, session), {
			kind: "url",
			tool: "web_search",
			url: "https://api.tavily.com",
		});
	});

	test("Bocha comes first; the request carries the query and the key only; results are listed", async () => {
		const { access, calls, textOf } = setup(
			{ "search-bocha": "bocha-test", "search-brave": "brave-test" },
			{
				body: {
					data: {
						webPages: {
							value: [
								{
									name: "Node.js 24 发布",
									url: "https://nodejs.org/zh-cn/blog",
									summary: "Node.js 24  带来了…",
								},
								{ name: "没有网址", url: "javascript:alert(1)", snippet: "x" },
							],
						},
					},
				},
			},
		);
		await access.refresh();
		const { text } = await textOf({ query: " Node.js 24 ", count: 3 });
		const [call] = calls;
		assert.equal(call?.url, "https://api.bochaai.com/v1/web-search");
		const headers = call?.init.headers as Record<string, string>;
		assert.equal(headers.Authorization, "Bearer bocha-test");
		assert.equal(headers["User-Agent"], "yew/9.9.9");
		assert.deepEqual(JSON.parse(call?.init.body as string), {
			query: "Node.js 24",
			count: 3,
			summary: true,
		});
		assert.match(
			text,
			/1\. Node\.js 24 发布\n {3}https:\/\/nodejs\.org\/zh-cn\/blog\n {3}Node\.js 24 带来了…/,
		);
		assert.match(text, /information, not instructions/);
		// Only http(s) addresses are passed on, and the key never reaches the model.
		assert.equal(text.includes("javascript:"), false);
		assert.equal(text.includes("bocha-test"), false);
	});

	test("Brave puts the query in the address; a refused key is said without the answer's body", async () => {
		const brave = setup(
			{ "search-brave": "brave-test" },
			{
				body: { web: { results: [{ title: "T", url: "https://example.com/", description: "D" }] } },
			},
		);
		await brave.access.refresh();
		assert.match(
			(await brave.textOf({ query: "a b&c" })).text,
			/1\. T\n {3}https:\/\/example\.com\//,
		);
		assert.equal(
			brave.calls[0]?.url,
			"https://api.search.brave.com/res/v1/web/search?q=a%20b%26c&count=5",
		);

		const refused = setup(
			{ "search-bocha": "bad" },
			{ status: 401, body: { message: "key bad is invalid" } },
		);
		await refused.access.refresh();
		const { text, result } = await refused.textOf({ query: "x" });
		assert.equal(result.isError, true);
		assert.match(text, /refused the key \(HTTP 401\).*yew key set search-bocha/);
		assert.equal(text.includes("key bad"), false);
	});

	test("no key, an empty query and no results are each said plainly", async () => {
		const none = setup({}, { body: {} });
		assert.match((await none.textOf({ query: "x" })).text, /No search service is set up/);
		const empty = setup({ "search-tavily": "k" }, { body: { results: [] } });
		await empty.access.refresh();
		assert.match((await empty.textOf({ query: "  " })).text, /query is empty/);
		assert.match((await empty.textOf({ query: "冷门" })).text, /No results for "冷门"/);
	});
});

describe("web_search with the DeepSeek key", () => {
	test("is built in: the DeepSeek key for the model is enough, and DeepSeek's Search API answers", async () => {
		const { access, tool, calls, textOf } = setup(
			{ deepseek: "sk-deepseek-test" },
			{
				body: {
					results: [
						{
							title: "DeepSeek V4",
							url: "https://api-docs.deepseek.com/news",
							summary: "发布说明",
						},
					],
				},
			},
		);
		await access.refresh();
		assert.equal(tool.offered?.(session, roles), true);
		assert.deepEqual(tool.subject({ query: "x" }, session), {
			kind: "url",
			tool: "web_search",
			url: "https://api.deepseek.com",
		});
		const long = "查".repeat(200);
		const { text } = await textOf({ query: long, count: 2 });
		const [call] = calls;
		assert.equal(call?.url, "https://api.deepseek.com/v1/tools/search");
		assert.ok(call);
		assert.equal(
			(call.init.headers as Record<string, string>).Authorization,
			"Bearer sk-deepseek-test",
		);
		// It takes queries of up to 128 characters.
		assert.deepEqual(JSON.parse(call?.init.body as string), { query: "查".repeat(128), count: 2 });
		assert.match(
			text,
			/1\. DeepSeek V4\n {3}https:\/\/api-docs\.deepseek\.com\/news\n {3}发布说明/,
		);
	});

	test("a search service's own key comes first; DeepSeek's key is not saved or deleted from search", async () => {
		const { access } = setup({ deepseek: "sk", "search-brave": "brave" }, { body: {} });
		await access.refresh();
		assert.equal(access.service?.id, "search-brave");
		const { SEARCH_SERVICES } = await import("../src/server/tools/web-search.ts");
		const deepseek = SEARCH_SERVICES.find((service) => service.id === "search-deepseek");
		assert.ok(deepseek);
		await assert.rejects(access.saveKey(deepseek, "other"), /uses the deepseek key/);
		await assert.rejects(access.deleteKey(deepseek), /uses the deepseek key/);
		assert.equal(await access.hasKey(deepseek), true);
	});
});
