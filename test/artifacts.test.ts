import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ArtifactStore, saveArtifactTool } from "../src/server/artifacts.ts";
import { exportAll } from "../src/server/data-export.ts";
import { createApp } from "../src/server/http/app.ts";
import type { ToolContext } from "../src/server/tools/types.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

const CHART = JSON.stringify({
	type: "bar",
	title: "每周提交",
	labels: ["一", "二", "三"],
	series: [{ name: "提交", values: [3, 5, 2] }],
});

function setup() {
	const { store, events } = newStore();
	const home = tempDir("jig-home-");
	const artifacts = new ArtifactStore(store, home);
	const session = store.createSession(sessionInput("产品"));
	const app = createApp({ store, artifacts, log: () => {} });
	return { store, events, home, artifacts, session, app };
}

describe("artifacts", () => {
	test("saving under the same name adds a version; every version stays readable", () => {
		const { artifacts, session, home, events } = setup();
		const first = artifacts.save(session.id, {
			name: " 周报 ",
			kind: "markdown",
			content: "# 第一版",
		});
		assert.deepEqual([first.name, first.version, first.size], ["周报", 1, 11]);
		const second = artifacts.save(session.id, {
			name: "周报",
			kind: "markdown",
			content: "# 第二版\n",
		});
		assert.equal(second.id, first.id);
		assert.equal(second.version, 2);
		assert.equal(artifacts.content(first.id, 1).content, "# 第一版");
		assert.equal(artifacts.content(first.id, 2).content, "# 第二版\n");
		assert.deepEqual(
			artifacts.versions(first.id).map((v) => v.version),
			[2, 1],
		);
		assert.deepEqual(readdirSync(join(home, "artifacts", session.id, first.id)).sort(), [
			"v1.md",
			"v2.md",
		]);
		assert.throws(() => artifacts.content(first.id, 3), /not found|No /i);
		// The interface hears about each version.
		assert.equal(
			events.filter((e) => e.scope === "global" && e.event.type === "artifact").length,
			2,
		);
	});

	test("kinds are checked: a name keeps its kind, JSON parses, a chart has matching series", () => {
		const { artifacts, session } = setup();
		artifacts.save(session.id, { name: "数据", kind: "json", content: '{"a":1}' });
		assert.throws(
			() => artifacts.save(session.id, { name: "数据", kind: "html", content: "<p>" }),
			/already a json/,
		);
		assert.throws(
			() => artifacts.save(session.id, { name: "坏", kind: "json", content: "{" }),
			/not valid JSON/,
		);
		assert.throws(
			() => artifacts.save(session.id, { name: "空", kind: "markdown", content: "" }),
			/empty/,
		);
		assert.throws(
			() =>
				artifacts.save(session.id, {
					name: "大",
					kind: "markdown",
					content: "x".repeat(2 * 1024 * 1024 + 1),
				}),
			/at most 2 MB/,
		);
		assert.equal(
			artifacts.save(session.id, { name: "图", kind: "chart", content: CHART }).kind,
			"chart",
		);
		for (const bad of [
			{ type: "pie", labels: ["a"], series: [{ name: "s", values: [1] }] },
			{ type: "bar", labels: [], series: [{ name: "s", values: [] }] },
			{ type: "line", labels: ["a", "b"], series: [{ name: "s", values: [1] }] },
			{ type: "line", labels: ["a"], series: [{ name: "s", values: ["1"] }] },
		]) {
			assert.throws(() =>
				artifacts.save(session.id, { name: "坏图", kind: "chart", content: JSON.stringify(bad) }),
			);
		}
	});

	test("save_artifact saves for the calling session and tells the model what went wrong", async () => {
		const { artifacts, session } = setup();
		const tool = saveArtifactTool(artifacts);
		const ctx = { session } as ToolContext;
		const saved = await tool.run({ name: "方案", kind: "html", content: "<h1>方案</h1>" }, ctx);
		assert.match(
			saved.content[0]?.type === "text" ? saved.content[0].text : "",
			/Saved "方案" as version 1/,
		);
		assert.equal(saved.detail?.kind, "html");
		assert.equal(artifacts.list({ sessionId: session.id, limit: 10 }).length, 1);
		const refused = await tool.run({ name: "方案", kind: "json", content: "{}" }, ctx);
		assert.equal(refused.isError, true);
		const unknown = await tool.run({ name: "x", kind: "pdf", content: "x" }, ctx);
		assert.equal(unknown.isError, true);
		assert.deepEqual(tool.subject({}, session), { kind: "none" });
	});

	test("the API lists, reads and deletes; an HTML artifact is served shut in", async () => {
		const { artifacts, session, app, home } = setup();
		const page = artifacts.save(session.id, {
			name: "页面",
			kind: "html",
			content: "<script>fetch('/api/sessions')</script>",
		});
		const note = artifacts.save(session.id, { name: "笔记", kind: "markdown", content: "# 笔记" });
		const list = (await (await app.request(`/api/artifacts?session=${session.id}`)).json()) as {
			items: { id: string }[];
		};
		assert.deepEqual(list.items.map((a) => a.id).sort(), [page.id, note.id].sort());
		const one = (await (await app.request(`/api/artifacts/${page.id}`)).json()) as {
			versions: unknown[];
		};
		assert.equal(one.versions.length, 1);
		const raw = await app.request(`/api/artifacts/${note.id}/versions/1`);
		assert.equal(raw.headers.get("Content-Type"), "text/plain; charset=utf-8");
		assert.equal(await raw.text(), "# 笔记");

		const view = await app.request(`/artifact-view/${page.id}/1`);
		assert.equal(view.status, 200);
		const csp = view.headers.get("Content-Security-Policy") ?? "";
		// Its own origin, no requests of any kind, framed by Jig's page only.
		assert.match(csp, /^sandbox allow-scripts;/);
		assert.equal(csp.includes("allow-same-origin"), false);
		assert.match(csp, /default-src 'none'/);
		assert.match(csp, /frame-ancestors 'self'/);
		assert.equal(csp.includes("connect-src"), false);
		assert.equal((await app.request(`/artifact-view/${note.id}/1`)).status, 400);
		assert.equal((await app.request(`/artifact-view/${page.id}/9`)).status, 404);
		// Jig's own pages keep their policy.
		const api = await app.request("/api/health");
		assert.match(api.headers.get("Content-Security-Policy") ?? "", /default-src 'self'/);

		// A phone looks at artifacts but does not delete them.
		const asPhone = await app.fetch(
			new Request(`http://jig.internal/api/artifacts/${note.id}`, { method: "DELETE" }),
			{
				device: "d1",
			},
		);
		assert.equal(asPhone.status, 403);
		assert.equal(
			(await app.request(`/api/artifacts/${note.id}`, { method: "DELETE" })).status,
			204,
		);
		assert.equal((await app.request(`/api/artifacts/${note.id}`)).status, 404);
		assert.equal(existsSync(join(home, "artifacts", session.id, note.id)), false);
	});

	test("the export carries every version; deleting a session takes its artifacts along", () => {
		const { store, artifacts, session, home } = setup();
		const report = artifacts.save(session.id, { name: "周报", kind: "markdown", content: "一" });
		artifacts.save(session.id, { name: "周报", kind: "markdown", content: "二" });
		const out = tempDir("jig-export-");
		const counts = exportAll(store, out, Date.now(), home);
		assert.equal(counts.artifacts, 1);
		assert.equal(readFileSync(join(out, "artifacts", "产品", "周报", "v2.md"), "utf8"), "二");
		assert.equal(
			JSON.parse(readFileSync(join(out, "artifacts", "产品", "周报", "artifact.json"), "utf8"))
				.version,
			2,
		);

		store.updateSession(session.id, { archived: true });
		store.deleteArchivedSessions();
		assert.throws(() => artifacts.get(report.id));
		artifacts.forgetSessions([session.id]);
		assert.equal(existsSync(join(home, "artifacts", session.id)), false);
	});
});
