import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { loadInstructions } from "../src/server/agent/prompt.ts";
import { createApp } from "../src/server/http/app.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import { findSkills, frontMatter, skillTool } from "../src/server/skills.ts";
import type { ToolContext } from "../src/server/tools/types.ts";
import type { Session } from "../src/shared/types.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

const real = (prefix: string) => realpathSync(tempDir(prefix));

function skill(folder: string, dir: string, source: string) {
	mkdirSync(join(folder, dir), { recursive: true });
	writeFileSync(join(folder, dir, "SKILL.md"), source);
}

function homes() {
	const jigHome = real("jig-home-");
	const userHome = real("jig-user-");
	const cwd = real("jig-cwd-");
	return { jigHome, userHome, cwd };
}

describe("skills", () => {
	test("front matter gives the name and description, quoted or folded", () => {
		assert.deepEqual(frontMatter('---\nname: pdf\ndescription: "Work with PDF files"\n---\nBody'), {
			name: "pdf",
			description: "Work with PDF files",
		});
		assert.equal(
			frontMatter("---\nname: x\ndescription: >\n  First line\n  second line\nlicense: MIT\n---\n")
				.description,
			"First line second line",
		);
		assert.deepEqual(frontMatter("No front matter"), {});
	});

	test("skills come from Jig's folder, the person's and the project's; the project's wins", () => {
		const { jigHome, userHome, cwd } = homes();
		skill(join(jigHome, "skills"), "release", "---\nname: release\ndescription: Jig's own\n---\nA");
		skill(
			join(userHome, ".claude", "skills"),
			"pdf",
			"---\nname: pdf\ndescription: PDF work\n---\nB",
		);
		skill(join(userHome, ".claude", "skills"), "release", "---\ndescription: The person's\n---\nC");
		skill(
			join(cwd, ".claude", "skills"),
			"release",
			"---\nname: release\ndescription: The project's\n---\nD",
		);
		skill(join(cwd, ".jig", "skills"), "bad name", "---\nname: not a name!\n---\nE");
		mkdirSync(join(jigHome, "skills", "empty"), { recursive: true });
		const found = findSkills(cwd, jigHome, userHome);
		assert.deepEqual(
			found.map((s) => [s.name, s.description]),
			[
				["pdf", "PDF work"],
				["release", "The project's"],
			],
		);
		// Without the person's home folder nothing outside Jig's folder and the project is read.
		assert.deepEqual(
			findSkills(null, jigHome, null).map((s) => s.description),
			["Jig's own"],
		);
	});

	test("the skill tool gives the instructions without the front matter, and the folder", async () => {
		const { jigHome, userHome, cwd } = homes();
		skill(
			join(userHome, ".claude", "skills"),
			"pdf",
			"---\nname: pdf\ndescription: PDF work\n---\n# PDF\nRun scripts/fill.py",
		);
		const tool = skillTool(jigHome, userHome);
		const session = { cwd } as Session;
		assert.equal(tool.offered?.(session, { canPostCards: false, canOrganize: false }), true);
		assert.equal(
			skillTool(jigHome, null).offered?.(session, { canPostCards: false, canOrganize: false }),
			false,
		);
		const run = async (name: string) => {
			const result = await tool.run({ name }, { session } as ToolContext);
			return {
				result,
				text: result.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
			};
		};
		const { text } = await run("pdf");
		assert.match(text, /^Skill "pdf" \(folder: .*\.claude\/skills\/pdf\)/);
		assert.match(text, /# PDF\nRun scripts\/fill\.py$/);
		assert.equal(text.includes("description: PDF work"), false);
		const missing = await run("nope");
		assert.equal(missing.result.isError, true);
		assert.match(missing.text, /Skills: pdf\./);
	});
});

describe("instructions, memory folders and what may be read", () => {
	test("without a file of Jig's own, the person's global file is read; with one, only Jig's", () => {
		const { jigHome, userHome } = homes();
		mkdirSync(join(userHome, ".claude"));
		writeFileSync(join(userHome, ".claude", "CLAUDE.md"), "用简体中文。");
		assert.deepEqual(
			loadInstructions(null, jigHome, { userHome }).map((f) => f.content),
			["用简体中文。"],
		);
		assert.deepEqual(loadInstructions(null, jigHome), []);
		writeFileSync(join(jigHome, "AGENTS.md"), "Jig 的说明。");
		assert.deepEqual(
			loadInstructions(null, jigHome, { userHome }).map((f) => f.content),
			["Jig 的说明。"],
		);
	});

	test("memory folders are named with their index; skills are listed by name", () => {
		const { jigHome, userHome, cwd } = homes();
		const memory = real("jig-memory-");
		writeFileSync(join(memory, "index.md"), "- 部署规范见 server-deployment.md");
		skill(
			join(jigHome, "skills"),
			"release",
			"---\nname: release\ndescription: Cut a release\n---\nA",
		);
		const files = loadInstructions(cwd, jigHome, {
			userHome,
			memoryDirs: [memory, join(memory, "gone")],
		});
		assert.deepEqual(
			files.map((f) => f.path),
			["memory folders", join(memory, "index.md"), "skills"],
		);
		assert.ok(files[0]?.content.includes(`- ${memory}`));
		assert.equal(files[0]?.content.includes("gone"), false);
		assert.match(files[2]?.content ?? "", /- release: Cut a release/);
	});

	test("a memory folder is read without asking; writing there still asks", () => {
		const { jigHome, cwd } = homes();
		const memory = real("jig-memory-");
		const engine = new PermissionEngine(jigHome);
		const { store } = newStore();
		const session = store.createSession({
			...sessionInput("s"),
			cwd,
			options: { permissionMode: "manual" },
		});
		const read = {
			kind: "read" as const,
			tool: "read",
			paths: [join(memory, "a.md")],
			summary: "a.md",
		};
		assert.equal(engine.decide(read, session).effect, "ask");
		engine.readRoots = () => [memory];
		assert.equal(engine.decide(read, session).effect, "allow");
		const write = {
			kind: "write" as const,
			tool: "write",
			paths: [join(memory, "a.md")],
			summary: "a.md",
		};
		assert.equal(engine.decide(write, session).effect, "ask");
	});

	test("the settings take existing folders only", async () => {
		const { store } = newStore();
		const app = createApp({ store, log: () => {} });
		const patch = (body: unknown) =>
			app.request("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		const memory = real("jig-memory-");
		const saved = (await (await patch({ memoryDirs: [memory, memory] })).json()) as {
			memoryDirs: string[];
		};
		assert.deepEqual(saved.memoryDirs, [memory]);
		assert.equal((await patch({ memoryDirs: [join(memory, "missing")] })).status, 400);
		assert.equal((await patch({ memoryDirs: ["relative"] })).status, 400);
	});
});
