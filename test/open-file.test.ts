import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { api } from "../src/server/http/api.ts";
import { createApp } from "../src/server/http/app.ts";
import { errorHandler } from "../src/server/http/problem.ts";
import { openFileCommand } from "../src/server/reveal.ts";
import { Store } from "../src/server/store.ts";
import {
	continueMarkdownList,
	hasMarkdownSyntax,
	indentMarkdownList,
} from "../web/src/markdown-edit.ts";

describe("openFileCommand", () => {
	test("builds macOS commands for system, Finder, VS Code, Cursor and Zed with line anchors", () => {
		assert.deepEqual(
			openFileCommand("/Users/test/文档 1.md", { opener: "system", platform: "darwin" }),
			{ command: "open", args: ["/Users/test/文档 1.md"] },
		);
		assert.deepEqual(
			openFileCommand("/Users/test/文档 1.md", { opener: "finder", platform: "darwin" }),
			{ command: "open", args: ["-R", "/Users/test/文档 1.md"] },
		);
		assert.deepEqual(
			openFileCommand("/Users/test/文档 1.md", { opener: "vscode", platform: "darwin" }),
			{ command: "open", args: ["-a", "Visual Studio Code", "/Users/test/文档 1.md"] },
		);
		assert.deepEqual(
			openFileCommand("/Users/test/文档 1.md", {
				opener: "vscode",
				line: 42,
				column: 5,
				platform: "darwin",
			}),
			{ command: "open", args: ["vscode://file/Users/test/%E6%96%87%E6%A1%A3%201.md:42:5"] },
		);
		assert.deepEqual(
			openFileCommand("/Users/test/app.ts", { opener: "zed", line: 10, platform: "darwin" }),
			{ command: "open", args: ["zed://file/Users/test/app.ts:10"] },
		);
		assert.deepEqual(
			openFileCommand("/Users/test/app.ts", { opener: "cursor", platform: "darwin" }),
			{ command: "open", args: ["-a", "Cursor", "/Users/test/app.ts"] },
		);
	});

	test("builds Linux commands for editors and file manager", () => {
		assert.deepEqual(
			openFileCommand("/home/test/app.ts", { opener: "vscode", line: 7, platform: "linux" }),
			{ command: "code", args: ["--goto", "/home/test/app.ts:7"] },
		);
		assert.deepEqual(
			openFileCommand("/home/test/app.ts", {
				opener: "zed",
				line: 7,
				column: 2,
				platform: "linux",
			}),
			{ command: "zed", args: ["/home/test/app.ts:7:2"] },
		);
		assert.deepEqual(
			openFileCommand("/home/test/app.ts", { opener: "finder", platform: "linux", isDir: false }),
			{ command: "xdg-open", args: ["/home/test"] },
		);
	});
});

describe("POST /api/open-file and fileOpener setting", () => {
	test("saves fileOpener setting, resolves relative & file:// paths, and enforces boundaries", async () => {
		const root = mkdtempSync(join(tmpdir(), "yew-open-file-"));
		const yewHome = join(root, ".yew");
		const workspace = join(root, "work");
		const hidden = join(root, "secret");
		mkdirSync(yewHome, { recursive: true });
		mkdirSync(workspace, { recursive: true });
		mkdirSync(hidden, { recursive: true });
		const notePath = join(workspace, "笔记.md");
		const hiddenPath = join(hidden, "private.txt");
		writeFileSync(notePath, "# Note\n", "utf8");
		writeFileSync(hiddenPath, "secret", "utf8");

		const db = openDatabase(":memory:");
		const store = new Store(db, new EventBus());
		const launched: { command: string; args: string[] }[] = [];
		const app = api({
			store,
			yewHome,
			userHome: root,
			platform: "darwin",
			openFile: async (command, args) => {
				launched.push({ command, args });
			},
		});
		app.onError(errorHandler(() => {}));

		try {
			const session = store.createSession({
				name: "Docs",
				kind: "task",
				cwd: workspace,
				provider: "deepseek",
				model: "deepseek-v4-pro",
			});

			// Default fileOpener is system; update it to vscode and add hidden folder.
			const patch = await app.request("/settings", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ fileOpener: "vscode", hiddenFolders: [hidden] }),
			});
			assert.equal(patch.status, 200);
			const saved = (await patch.json()) as { fileOpener: string };
			assert.equal(saved.fileOpener, "vscode");

			// Relative path resolves via session cwd and opens with VS Code at line 12.
			const relRes = await app.request("/open-file", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "笔记.md", line: 12, sessionId: session.id }),
			});
			assert.equal(relRes.status, 204);
			assert.equal(launched.length, 1);
			assert.equal(launched[0]?.command, "open");
			assert.match(launched[0]?.args[0] ?? "", /^vscode:\/\/file\/.*%E7%AC%94%E8%AE%B0\.md:12$/);

			// file:// URL opens cleanly too.
			const urlRes = await app.request("/open-file", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path: pathToFileURL(realpathSync(notePath)).href,
					opener: "finder",
				}),
			});
			assert.equal(urlRes.status, 204);
			assert.deepEqual(launched[1], { command: "open", args: ["-R", realpathSync(notePath)] });

			// Hidden folder is rejected with 403.
			const hiddenRes = await app.request("/open-file", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: hiddenPath }),
			});
			assert.equal(hiddenRes.status, 403);

			// Missing file returns 404.
			const missingRes = await app.request("/open-file", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "missing.md", sessionId: session.id }),
			});
			assert.equal(missingRes.status, 404);
		} finally {
			db.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("blocks paired phones from calling /api/open-file", async () => {
		const db = openDatabase(":memory:");
		const store = new Store(db, new EventBus());
		const app = createApp({ store });
		try {
			const res = await app.request(
				"/api/open-file",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ path: "/tmp/anything.md" }),
				},
				{ device: "phone-1" },
			);
			assert.equal(res.status, 403);
		} finally {
			db.close();
		}
	});
});

describe("markdown composer helpers", () => {
	test("continues ordered, bullet and task lists and clears empty list markers", () => {
		assert.deepEqual(continueMarkdownList("1. 第一条", 6, 6), {
			value: "1. 第一条\n2. ",
			caret: 10,
		});
		assert.deepEqual(continueMarkdownList("1. 第一条\n2. ", 10, 10), {
			value: "1. 第一条\n",
			caret: 7,
		});
		assert.deepEqual(continueMarkdownList("  - item", 8, 8), {
			value: "  - item\n  - ",
			caret: 13,
		});
		assert.deepEqual(continueMarkdownList("- [x] done", 10, 10), {
			value: "- [x] done\n- [ ] ",
			caret: 17,
		});
		assert.equal(continueMarkdownList("plain line", 10, 10), null);
	});

	test("indents and outdents list items without affecting plain text", () => {
		assert.deepEqual(indentMarkdownList("- item", 6, 6, false), {
			value: "  - item",
			caret: 8,
		});
		assert.deepEqual(indentMarkdownList("  - item", 8, 8, true), {
			value: "- item",
			caret: 6,
		});
		assert.equal(indentMarkdownList("plain line", 5, 5, false), null);
	});

	test("detects simple Markdown syntax for preview toggle", () => {
		assert.equal(hasMarkdownSyntax("你好，帮我看一下"), false);
		assert.equal(hasMarkdownSyntax("1. 第一条\n2. 第二条"), true);
		assert.equal(hasMarkdownSyntax("- 待办事项"), true);
		assert.equal(hasMarkdownSyntax("把 `foo` 改成 **bar**"), true);
	});
});
