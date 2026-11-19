import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { Context } from "@earendil-works/pi-ai";
import { toModelMessages } from "../src/server/agent/context.ts";
import { Agents } from "../src/server/agent/runner.ts";
import { guardProfile } from "../src/server/guard.ts";
import { decisionFromPhone } from "../src/server/http/agents.ts";
import { createApp } from "../src/server/http/app.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import { ModelGateway } from "../src/server/model/gateway.ts";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "../src/server/model/testing.ts";
import { PermissionEngine } from "../src/server/permissions/engine.ts";
import {
	classifyGuardMode,
	mustConfirmReason,
	parseShell,
	sshPreview,
} from "../src/server/permissions/shell.ts";
import type { ToolDefinition } from "../src/server/tools/types.ts";
import { newStore, sessionInput, tempDir } from "./helpers/store.ts";

const textOf = (context: Context | undefined) =>
	(context?.messages ?? [])
		.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
		.join("\n");

// biome-ignore lint/suspicious/noExplicitAny: test assertions inspect arbitrary JSON
type Json = any;

describe("phase 3.1: outer guard split & ssh/scp preview", () => {
	test("guardProfile keeps core guard locked in all modes and only relaxes targeted permission", () => {
		const places = ["/Users/tester/.yew", "/Users/tester/Library/WebKit/cn.tenonai.apps.yew"];
		const home = "/Users/tester";

		const def = guardProfile(places, home, "default");
		assert.match(def, /deny file-read\* file-write\*.*\.yew/);
		assert.match(def, /\.gitconfig/);
		assert.match(def, /\.ssh\/config/);
		assert.match(def, /hooks/);
		assert.match(def, /config/);
		assert.match(def, /\(deny lsopen\)/);
		assert.match(def, /\(deny appleevent-send\)/);

		const gitSetup = guardProfile(places, home, "git-setup");
		// Core stays locked: hooks, ~/.gitconfig, ~/.ssh/config, ~/.yew, lsopen, appleevent-send
		assert.match(gitSetup, /deny file-read\* file-write\*.*\.yew/);
		assert.match(gitSetup, /\.gitconfig/);
		assert.match(gitSetup, /\.ssh\/config/);
		assert.match(gitSetup, /hooks/);
		assert.match(gitSetup, /\(deny lsopen\)/);
		assert.match(gitSetup, /\(deny appleevent-send\)/);
		// Workspace .git/config regex is omitted in git-setup mode
		assert.doesNotMatch(gitSetup, /config\(\\\.worktree\)\?/);

		const launchApp = guardProfile(places, home, "launch-app");
		// Only lsopen is relaxed; every file lock and appleevent-send stay locked
		assert.match(launchApp, /deny file-read\* file-write\*.*\.yew/);
		assert.match(launchApp, /\.gitconfig/);
		assert.match(launchApp, /hooks/);
		assert.match(launchApp, /config\(\\\.worktree\)\?/);
		assert.doesNotMatch(launchApp, /\(deny lsopen\)/);
		assert.match(launchApp, /\(deny appleevent-send\)/);
	});

	test("git-setup and launch-app require human decision in all modes and reject compound commands", () => {
		const home = realpathSync(tempDir("yew-p3-home-"));
		const cwd = realpathSync(tempDir("yew-p3-cwd-"));
		const engine = new PermissionEngine(home);
		const { store } = newStore();
		const skipSession = store.createSession({
			...sessionInput("Skip"),
			cwd,
			options: { permissionMode: "skip" },
		});

		for (const cmd of [
			"git init",
			"git clone https://github.com/example/repo.git",
			"git remote add origin https://github.com/example/repo.git",
			"git config --local user.name Test",
		]) {
			assert.equal(classifyGuardMode(cmd), "git-setup", cmd);
			const parsed = parseShell(cmd);
			assert.equal(parsed.understood, true, cmd);
			assert.equal(mustConfirmReason(parsed.segments[0]?.argv ?? []), "git-setup", cmd);
			const verdict = engine.decide({ kind: "command", tool: "shell", command: cmd }, skipSession);
			assert.equal(verdict.effect, "ask", cmd);
			if (verdict.effect === "ask") {
				assert.deepEqual(verdict.request.reasons, ["git-setup"]);
				assert.equal(verdict.request.mustConfirm, true);
				assert.equal(verdict.request.matter, true);
				assert.equal(verdict.request.rememberRules, undefined);
			}
		}

		// Global git config and compound commands never receive git-setup relaxation
		assert.equal(classifyGuardMode("git config --global user.name Evil"), "default");
		assert.equal(classifyGuardMode("git init && rm -rf /tmp/foo"), "default");
		assert.equal(classifyGuardMode("git init; echo hi"), "default");

		// Launch app
		assert.equal(classifyGuardMode("open -a Xcode"), "launch-app");
		const parsedApp = parseShell("open -a Xcode");
		assert.equal(parsedApp.understood, true);
		assert.equal(mustConfirmReason(parsedApp.segments[0]?.argv ?? []), "launch-app");
		assert.equal(classifyGuardMode("open -a Xcode && echo hi"), "default");
		const appVerdict = engine.decide(
			{ kind: "command", tool: "shell", command: "open -a Xcode" },
			skipSession,
		);
		assert.equal(appVerdict.effect, "ask");
		if (appVerdict.effect === "ask") {
			assert.deepEqual(appVerdict.request.reasons, ["launch-app"]);
			assert.equal(appVerdict.request.mustConfirm, true);
			assert.equal(appVerdict.request.matter, true);
		}
	});

	test("sshPreview formats ssh, scp and rsync commands cleanly", () => {
		const ssh = sshPreview('ssh -p 2222 deploy@prod.example.com "systemctl status yew"');
		assert.ok(ssh);
		assert.match(ssh, /SSH/);
		assert.match(ssh, /deploy@prod\.example\.com/);
		assert.match(ssh, /2222/);
		assert.match(ssh, /systemctl status yew/);

		const scp = sshPreview("scp ./dist.tgz deploy@prod.example.com:/srv/app/");
		assert.ok(scp);
		assert.match(scp, /SCP/);
		assert.match(scp, /deploy@prod\.example\.com/);

		const rsync = sshPreview("rsync -avz ./web/ deploy@prod.example.com:/srv/web/");
		assert.ok(rsync);
		assert.match(rsync, /RSYNC/i);
		assert.match(rsync, /deploy@prod\.example\.com/);

		assert.equal(sshPreview("echo hello"), null);
	});

	test("decisionFromPhone honors allow_always on acts-as-you warning only when confirmedWarning is true", () => {
		const warned = { warning: "acts-as-you" };
		assert.equal(decisionFromPhone("allow_always", warned), "allow_once");
		assert.equal(decisionFromPhone("allow_always", warned, false), "allow_once");
		assert.equal(decisionFromPhone("allow_always", warned, true), "allow_always");
		assert.equal(decisionFromPhone("allow_always", {}), "allow_always");
		assert.equal(decisionFromPhone("deny", warned, false), "deny");
	});

	test("mixed tool batch runs contiguous read-only calls concurrently and clears waiting status upon approval", async () => {
		const home = realpathSync(tempDir("yew-batch-home-"));
		const cwd = realpathSync(tempDir("yew-batch-cwd-"));
		const { store, bus } = newStore();
		const faux = fauxProvider();
		faux.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ro_a", {}), fauxToolCall("ro_b", {}), fauxToolCall("mut_c", {})],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("All done."),
		]);
		const gateway = new ModelGateway({
			keys: new MemoryKeyStore({ [faux.provider.id]: "test-key" }),
			version: "0.0.0",
			providers: [faux.provider],
		});

		const order: string[] = [];
		let releaseBarrier!: () => void;
		const bothStarted = new Promise<void>((resolve) => {
			releaseBarrier = resolve;
		});
		let startedReadOnly = 0;
		const onReadOnlyStart = (name: string) => {
			order.push(`start:${name}`);
			startedReadOnly++;
			if (startedReadOnly === 2) releaseBarrier();
		};
		const makeRo = (name: string): ToolDefinition => ({
			name,
			description: name,
			parameters: { type: "object", properties: {}, additionalProperties: false },
			readOnly: true,
			needsFolder: false,
			subject: () => ({ kind: "none" }),
			async run() {
				onReadOnlyStart(name);
				// Only resolves if BOTH ro_a and ro_b entered concurrently!
				await bothStarted;
				order.push(`end:${name}`);
				return { content: [{ type: "text", text: `${name} ok` }] };
			},
		});
		const mutC: ToolDefinition = {
			name: "mut_c",
			description: "mut_c",
			parameters: { type: "object", properties: {}, additionalProperties: false },
			readOnly: false,
			needsFolder: false,
			subject: () => ({ kind: "act", tool: "mut_c", summary: "run mut_c", always: true }),
			async run() {
				order.push("start:mut_c");
				return { content: [{ type: "text", text: "mut_c ok" }] };
			},
		};

		const agents = new Agents({
			store,
			gateway,
			permissions: new PermissionEngine(home),
			home,
			userHome: null,
			version: "0.0.0",
			tools: [makeRo("ro_a"), makeRo("ro_b"), mutC],
		});
		const session = store.createSession({
			...sessionInput("Batch"),
			cwd,
			provider: faux.provider.id,
			model: faux.getModel().id,
		});

		const mutStatuses: string[] = [];
		bus.subscribe((ev) => {
			if (ev.scope !== "session" || ev.sessionId !== session.id) return;
			if (ev.event.type === "toolCall" && ev.event.toolCall.tool === "mut_c") {
				mutStatuses.push(ev.event.toolCall.status);
			}
			if (ev.event.type === "approval" && ev.event.approval.status === "pending") {
				const approvalId = ev.event.approval.id;
				queueMicrotask(() => agents.answer(approvalId, { decision: "allow_once" }));
			}
		});

		agents.send(session.id, "Run all three.");
		await agents.whenIdle(session.id);

		// Both read-only calls ran concurrently and finished before mut_c started.
		assert.ok(order.indexOf("start:ro_a") < order.indexOf("end:ro_b"));
		assert.ok(order.indexOf("start:ro_b") < order.indexOf("end:ro_a"));
		assert.ok(order.indexOf("end:ro_a") < order.indexOf("start:mut_c"));
		assert.ok(order.indexOf("end:ro_b") < order.indexOf("start:mut_c"));
		// mut_c cleared "waiting" back to "pending" immediately upon approval, before running.
		assert.deepEqual(mutStatuses, ["pending", "waiting", "pending", "running", "done"]);
	});
});

describe("phase 3.2: in-place context renew", () => {
	test("renewNow summarizes carry-over brief, preserves full history & open requests, and resets model window", async () => {
		const home = realpathSync(tempDir("yew-p3-renew-home-"));
		const cwd = realpathSync(tempDir("yew-p3-renew-cwd-"));
		const { store } = newStore();
		const faux = fauxProvider();
		faux.setResponses([
			(ctx) => {
				if (textOf(ctx).includes("carry-over brief")) {
					return fauxAssistantMessage("- Active goal: ship v1.9\n- Pending: review PR #42");
				}
				return fauxAssistantMessage("Understood, working on v1.9.");
			},
			(ctx) => {
				if (textOf(ctx).includes("fresh context")) {
					return fauxAssistantMessage("- Active goal: ship v1.9\n- Pending: review PR #42");
				}
				return fauxAssistantMessage("Carry-over brief: keep working on v1.9.");
			},
		]);
		const gateway = new ModelGateway({
			keys: new MemoryKeyStore({ [faux.provider.id]: "test-key" }),
			version: "0.0.0",
			providers: [faux.provider],
		});
		const model = faux.getModel().id;
		const agents = new Agents({
			store,
			gateway,
			permissions: new PermissionEngine(home),
			home,
			userHome: null,
			version: "0.0.0",
		});
		const app = createApp({ store, gateway, agents, data: { home } });

		const other = store.createSession({
			...sessionInput("OPS"),
			cwd,
			provider: faux.provider.id,
			model,
		});
		const session = store.createSession({
			...sessionInput("MAIN"),
			cwd,
			provider: faux.provider.id,
			model,
		});
		agents.send(session.id, "Let's plan the v1.9 release in detail.");
		await agents.whenIdle(session.id);

		// Add an open incoming request from OPS so renew must restate it after the boundary
		agents.post.mail.addLetter({
			fromKind: "session",
			fromSession: other.id,
			fromName: other.name,
			toSession: session.id,
			kind: "request",
			summary: "Confirm deploy window",
			body: "Confirm deploy window for tonight",
			status: "delivered",
		});

		const beforeAllCount = store.allEntries(session.id).length;
		const res = await app.request(`/api/sessions/${session.id}/renew`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ summarize: true }),
		});
		assert.equal(res.status, 200);
		const body = (await res.json()) as Json;
		assert.equal(body.status, "done");

		// Full history is still preserved in allEntries()
		const all = store.allEntries(session.id);
		assert.ok(all.length > beforeAllCount);
		assert.ok(all.some((e) => e.role === "compaction" && e.compaction.kind === "renew"));
		assert.ok(all.some((e) => e.role === "notice" && e.notice.kind === "renewed"));

		// Active model context drops the original user/assistant turns, keeps brief + open request note
		const ctxEntries = store.contextEntries(session.id);
		assert.equal(ctxEntries[0]?.role, "compaction");
		assert.ok(
			ctxEntries.some(
				(e) => e.role === "system" && e.message.content.includes("Confirm deploy window"),
			),
		);
		assert.ok(!ctxEntries.some((e) => e.role === "assistant"));

		const modelMsgs = toModelMessages(ctxEntries);
		assert.ok(
			modelMsgs.some(
				(m) =>
					m.role === "user" &&
					typeof m.content === "string" &&
					m.content.includes("Context renewed by the person"),
			),
		);

		// Clean renew (summarize: false) clears summary without calling the model
		const cleanOutcome = await agents.renewNow(session.id, false);
		assert.equal(cleanOutcome, "done");
		const cleanCtx = store.contextEntries(session.id);
		assert.equal(cleanCtx[0]?.role, "compaction");
		if (cleanCtx[0]?.role === "compaction") {
			assert.equal(cleanCtx[0].compaction.summary, "");
			assert.equal(cleanCtx[0].compaction.kind, "renew");
		}
		// Empty renew compaction is skipped by toModelMessages
		const cleanModelMsgs = toModelMessages(cleanCtx);
		assert.ok(
			!cleanModelMsgs.some(
				(m) =>
					m.role === "user" &&
					typeof m.content === "string" &&
					m.content.includes("Context renewed by the person"),
			),
		);
	});
});

describe("phase 3.3: composer /files and /skills endpoints", () => {
	test("GET /sessions/:id/files lists cwd and extraDirs while hiding .git, node_modules and hiddenFolders", async () => {
		const home = realpathSync(tempDir("yew-p3-files-home-"));
		const cwd = realpathSync(tempDir("yew-p3-files-cwd-"));
		const extra = realpathSync(tempDir("yew-p3-files-extra-"));
		const hidden = join(cwd, "private-secret");
		mkdirSync(join(cwd, "src"), { recursive: true });
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(join(cwd, "node_modules", "pkg"), { recursive: true });
		mkdirSync(hidden, { recursive: true });
		writeFileSync(join(cwd, "src", "guard.ts"), "export const x = 1;\n");
		writeFileSync(join(cwd, "README.md"), "# Hello\n");
		writeFileSync(join(cwd, ".git", "HEAD"), "ref: refs/heads/main\n");
		writeFileSync(join(cwd, "node_modules", "pkg", "index.js"), "");
		writeFileSync(join(hidden, "secret.txt"), "top secret\n");
		writeFileSync(join(extra, "ops-playbook.md"), "# Ops\n");

		const { store } = newStore();
		store.setSetting("hiddenFolders", [hidden]);
		const session = store.createSession({
			...sessionInput("Files"),
			cwd,
			options: { extraDirs: [{ path: extra, access: "read" }] },
		});
		const app = createApp({ store, data: { home } });

		const allRes = await app.request(`/api/sessions/${session.id}/files?limit=30`);
		assert.equal(allRes.status, 200);
		const allBody = (await allRes.json()) as {
			items: { path: string; label: string; root: string }[];
		};
		const paths = allBody.items.map((i) => i.path);
		assert.ok(paths.includes("src/guard.ts"));
		assert.ok(paths.includes("README.md"));
		assert.ok(paths.includes(join(extra, "ops-playbook.md")));
		assert.ok(!paths.some((p) => p.includes(".git")));
		assert.ok(!paths.some((p) => p.includes("node_modules")));
		assert.ok(!paths.some((p) => p.includes("secret.txt")));

		const filteredRes = await app.request(`/api/sessions/${session.id}/files?q=guard`);
		assert.equal(filteredRes.status, 200);
		const filtered = (await filteredRes.json()) as {
			items: { path: string; label: string; root: string }[];
		};
		assert.equal(filtered.items[0]?.path, "src/guard.ts");
	});

	test("GET /sessions/:id/skills returns enabled skills for the session and omits disabled ones", async () => {
		const home = realpathSync(tempDir("yew-p3-skills-home-"));
		const cwd = realpathSync(tempDir("yew-p3-skills-cwd-"));
		const skillA = join(home, "skills", "deploy-check");
		const skillB = join(cwd, ".yew", "skills", "release-notes");
		mkdirSync(skillA, { recursive: true });
		mkdirSync(skillB, { recursive: true });
		writeFileSync(
			join(skillA, "SKILL.md"),
			"---\nname: deploy-check\ndescription: Verify deploy steps\n---\nCheck everything.\n",
		);
		writeFileSync(
			join(skillB, "SKILL.md"),
			"---\nname: release-notes\ndescription: Draft changelog\n---\nWrite notes.\n",
		);

		const { store } = newStore();
		const session = store.createSession({ ...sessionInput("Skills"), cwd });
		const app = createApp({
			store,
			data: { home },
			skills: { home, userHome: null },
		});

		const res1 = await app.request(`/api/sessions/${session.id}/skills`);
		assert.equal(res1.status, 200);
		const body1 = (await res1.json()) as { items: { name: string; description: string }[] };
		assert.deepEqual(
			body1.items.map((s) => s.name),
			["deploy-check", "release-notes"],
		);

		store.setSetting("disabledSkills", [realpathSync(skillA)]);
		const res2 = await app.request(`/api/sessions/${session.id}/skills`);
		assert.equal(res2.status, 200);
		const body2 = (await res2.json()) as { items: { name: string; description: string }[] };
		assert.deepEqual(
			body2.items.map((s) => s.name),
			["release-notes"],
		);
	});
});
