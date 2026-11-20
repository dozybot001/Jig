import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { loadInstructions } from "../src/server/agent/prompt.ts";
import { createApp } from "../src/server/http/app.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import { BUILTIN_SKILLS_DIR, findSkills, frontMatter, skillTool } from "../src/server/skills.ts";
import type { ToolContext } from "../src/server/tools/types.ts";
import type { Session } from "../src/shared/types.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

const real = (prefix: string) => realpathSync(tempDir(prefix));

function skill(folder: string, dir: string, source: string) {
	mkdirSync(join(folder, dir), { recursive: true });
	writeFileSync(join(folder, dir, "SKILL.md"), source);
}

function homes() {
	const yewHome = real("yew-home-");
	const userHome = real("yew-user-");
	const cwd = real("yew-cwd-");
	return { yewHome, userHome, cwd };
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

	test("skills come from Yew's folder, the person's and the project's; the project's wins", () => {
		const { yewHome, userHome, cwd } = homes();
		skill(join(yewHome, "skills"), "release", "---\nname: release\ndescription: Yew's own\n---\nA");
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
		skill(join(cwd, ".yew", "skills"), "bad name", "---\nname: not a name!\n---\nE");
		mkdirSync(join(yewHome, "skills", "empty"), { recursive: true });
		const found = findSkills(cwd, yewHome, userHome, [], null);
		assert.deepEqual(
			found.map((s) => [s.name, s.description]),
			[
				["pdf", "PDF work"],
				["release", "The project's"],
			],
		);
		// Without the person's home folder nothing outside Yew's folder and the project is read.
		assert.deepEqual(
			findSkills(null, yewHome, null, [], null).map((s) => s.description),
			["Yew's own"],
		);
	});

	test("official built-in skills load by default, ship in package.json, and are overridden by user skills", async () => {
		const { yewHome, userHome, cwd } = homes();
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			files: string[];
		};
		assert.ok(pkg.files.includes("skills-builtin"), "package.json must bundle skills-builtin");

		const defaults = findSkills(null, yewHome, null);
		const md = defaults.find((s) => s.name === "markdown-writing");
		assert.ok(md, "markdown-writing should be loaded from BUILTIN_SKILLS_DIR");
		assert.equal(md.id, "builtin:markdown-writing");
		assert.equal(md.builtin, true);
		assert.ok(md.dir.startsWith(realpathSync(BUILTIN_SKILLS_DIR)));

		// The skill tool reads the bundled markdown-writing skill cleanly.
		const tool = skillTool(yewHome, null);
		const read = await tool.run({ name: "markdown-writing" }, {
			session: { cwd: null } as Session,
		} as ToolContext);
		const out = read.content.map((b) => (b.type === "text" ? b.text : "")).join("");
		assert.match(out, /Markdown Writing Standards/);
		assert.equal(out.includes("description:"), false);

		// Disabling by stable ID hides the built-in skill.
		assert.equal(
			findSkills(null, yewHome, null, ["builtin:markdown-writing"]).some(
				(s) => s.name === "markdown-writing",
			),
			false,
		);

		// A user/workspace skill with the same name overrides the built-in one.
		skill(
			join(cwd, ".yew", "skills"),
			"markdown-writing",
			"---\nname: markdown-writing\ndescription: Custom team Markdown guide\n---\nTeam rules",
		);
		const overridden = findSkills(cwd, yewHome, userHome).find(
			(s) => s.name === "markdown-writing",
		);
		assert.equal(overridden?.description, "Custom team Markdown guide");
		assert.equal(overridden?.builtin, undefined);
	});

	test("the skill tool gives the instructions without the front matter, and the folder", async () => {
		const { yewHome, userHome, cwd } = homes();
		skill(
			join(userHome, ".claude", "skills"),
			"pdf",
			"---\nname: pdf\ndescription: PDF work\n---\n# PDF\nRun scripts/fill.py",
		);
		const tool = skillTool(yewHome, userHome, () => [], null);
		const session = { cwd } as Session;
		assert.equal(tool.offered?.(session, { canPostCards: false, canOrganize: false }), true);
		assert.equal(
			skillTool(yewHome, null, () => [], null).offered?.(session, {
				canPostCards: false,
				canOrganize: false,
			}),
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
	test("without a file of Yew's own, the person's global file is read; with one, only Yew's", () => {
		const { yewHome, userHome } = homes();
		mkdirSync(join(userHome, ".claude"));
		writeFileSync(join(userHome, ".claude", "CLAUDE.md"), "用简体中文。");
		assert.deepEqual(
			loadInstructions(null, yewHome, { userHome, builtinSkillsDir: null }).map((f) => f.content),
			["用简体中文。"],
		);
		assert.deepEqual(loadInstructions(null, yewHome, { builtinSkillsDir: null }), []);
		writeFileSync(join(yewHome, "AGENTS.md"), "Yew 的说明。");
		assert.deepEqual(
			loadInstructions(null, yewHome, { userHome, builtinSkillsDir: null }).map((f) => f.content),
			["Yew 的说明。"],
		);
	});

	test("memory folders are named with their index; skills are listed by name", () => {
		const { yewHome, userHome, cwd } = homes();
		const memory = real("yew-memory-");
		writeFileSync(join(memory, "index.md"), "- 部署规范见 server-deployment.md");
		skill(
			join(yewHome, "skills"),
			"release",
			"---\nname: release\ndescription: Cut a release\n---\nA",
		);
		const files = loadInstructions(cwd, yewHome, {
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
		const { yewHome, cwd } = homes();
		const memory = real("yew-memory-");
		const engine = new PermissionEngine(yewHome);
		const { store } = newStore();
		const session = store.createSession({
			...sessionInput("s"),
			cwd,
			// Yew's read-only helpers are asked before reading outside the working folder.
			options: { readerOnly: true },
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
		const memory = real("yew-memory-");
		const saved = (await (await patch({ memoryDirs: [memory, memory] })).json()) as {
			memoryDirs: string[];
		};
		assert.deepEqual(saved.memoryDirs, [memory]);
		assert.equal((await patch({ memoryDirs: [join(memory, "missing")] })).status, 400);
		assert.equal((await patch({ memoryDirs: ["relative"] })).status, 400);
	});

	test("folders kept from sessions: absolute or ~, may not exist yet, never the root or the home folder", async () => {
		const { store } = newStore();
		const app = createApp({ store, log: () => {} });
		const patch = (body: unknown) =>
			app.request("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		const memory = real("yew-memory-");
		const saved = (await (
			await patch({ hiddenFolders: [join(memory, ".private"), `${join(memory, ".private")} `] })
		).json()) as { hiddenFolders: string[] };
		assert.deepEqual(saved.hiddenFolders, [join(memory, ".private")]);
		const home = (await (await patch({ hiddenFolders: ["~/.yew-test-hidden"] })).json()) as {
			hiddenFolders: string[];
		};
		assert.deepEqual(home.hiddenFolders, [join(homedir(), ".yew-test-hidden")]);
		for (const bad of ["/", "~", "relative"]) {
			assert.equal((await patch({ hiddenFolders: [bad] })).status, 400, bad);
		}
	});
});
