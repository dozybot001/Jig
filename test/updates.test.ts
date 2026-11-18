// Versions and updates (blueprint, "版本与更新"): no real npm, registry or restart.
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, mock, test } from "node:test";
import { startedByService } from "../src/cli/service.ts";
import { createApp } from "../src/server/http/app.ts";
import {
	globalPrefix,
	installKind,
	newer,
	npmNextTo,
	type Run,
	type UpdateOptions,
	Updates,
} from "../src/server/updates.ts";
import { newStore, tempDir } from "./helpers/store.ts";

/** A package folder shaped like a global npm install: <prefix>/lib/node_modules/@tenonai/yew. */
function npmInstall(version = "1.7.0") {
	const prefix = realpathSync(tempDir("yew-prefix-"));
	const root = join(prefix, "lib", "node_modules", "@tenonai", "yew");
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@tenonai/yew", version }));
	// The Node.js running Yew Harness, with its npm beside it.
	const node = join(prefix, "node", "bin", "node");
	mkdirSync(join(prefix, "node", "lib", "node_modules", "npm", "bin"), { recursive: true });
	writeFileSync(npmNextTo(node), "");
	return { prefix, root, node };
}

function setup(options: Partial<UpdateOptions> = {}, version = "1.7.0") {
	const made = npmInstall(version);
	const { store } = newStore();
	const runs: { file: string; args: string[] }[] = [];
	const requests: { url: string; agent: string | null }[] = [];
	let latest = "1.8.0";
	let busy = 0;
	let restarts = 0;
	let refreshed = 0;
	const updates = new Updates({
		version: "1.7.0",
		build: null,
		root: made.root,
		node: made.node,
		store,
		busy: () => busy,
		restart: () => {
			restarts += 1;
		},
		refreshApp: async () => {
			refreshed += 1;
		},
		log: () => {},
		fetch: (async (url: URL, init?: RequestInit) => {
			requests.push({
				url: String(url),
				agent: new Headers(init?.headers).get("User-Agent"),
			});
			return Response.json({ name: "@tenonai/yew", version: latest });
		}) as typeof fetch,
		run: async (file, args): Promise<Run> => {
			runs.push({ file, args });
			if (args.includes("config")) return { code: 0, output: "https://registry.npmmirror.com\n" };
			return { code: 0, output: "added 1 package" };
		},
		writable: () => true,
		...options,
	});
	return {
		...made,
		store,
		updates,
		runs,
		requests,
		setLatest: (value: string) => {
			latest = value;
		},
		setBusy: (value: number) => {
			busy = value;
		},
		restarts: () => restarts,
		refreshed: () => refreshed,
	};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("versions", () => {
	test("newer compares x.y.z by number", () => {
		assert.equal(newer("1.8.0", "1.7.0"), true);
		assert.equal(newer("1.10.0", "1.9.9"), true);
		assert.equal(newer("2.0.0", "1.99.99"), true);
		assert.equal(newer("1.7.0", "1.7.0"), false);
		assert.equal(newer("1.6.1", "1.7.0"), false);
		assert.equal(newer("1.8.0-beta.1", "1.7.0"), true);
	});

	test("how it was installed: a checkout, a global npm install, anything else", () => {
		const checkout = realpathSync(tempDir("yew-src-"));
		mkdirSync(join(checkout, ".git"));
		assert.equal(installKind(checkout), "source");
		const { prefix, root } = npmInstall();
		assert.equal(installKind(root), "npm");
		assert.equal(globalPrefix(root), prefix);
		assert.equal(installKind(realpathSync(tempDir("yew-other-"))), "other");
	});

	test("a service older than what is installed asks for a restart", () => {
		const { root, updates } = setup();
		assert.equal(updates.state().restart, false);
		writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.8.0" }));
		const state = updates.state();
		assert.equal(state.restart, true);
		assert.deepEqual(state.installed, { version: "1.8.0", build: null });
	});
});

describe("checking for a new version", () => {
	test("asks the registry the person's npm uses, with only Yew's version as the user agent", async () => {
		const { updates, requests, store } = setup();
		const state = await updates.check();
		assert.deepEqual(requests, [
			{ url: "https://registry.npmmirror.com/@tenonai/yew/latest", agent: "yew/1.7.0" },
		]);
		assert.equal(state.available, true);
		assert.equal(state.latest?.version, "1.8.0");
		assert.equal(state.manual, null);
		assert.equal(
			store.getSetting<{ version: string } | null>("updateLatest", null)?.version,
			"1.8.0",
		);
	});

	test("the same version or an older one is not offered", async () => {
		const { updates, setLatest } = setup();
		setLatest("1.7.0");
		assert.equal((await updates.check()).available, false);
		setLatest("1.6.1");
		assert.equal((await updates.check()).available, false);
	});

	test("a source checkout is not checked", async () => {
		const checkout = realpathSync(tempDir("yew-src-"));
		mkdirSync(join(checkout, ".git"));
		writeFileSync(join(checkout, "package.json"), JSON.stringify({ version: "1.7.0" }));
		const { updates, requests } = setup({ root: checkout });
		const state = await updates.check();
		assert.equal(requests.length, 0);
		assert.equal(state.kind, "source");
		assert.equal(state.latest, null);
	});

	test("an answer without a version is refused and nothing is kept", async () => {
		const { updates, store } = setup({
			fetch: (async () => Response.json({ name: "@tenonai/yew" })) as unknown as typeof fetch,
		});
		await assert.rejects(updates.check(), /did not say which version/);
		assert.equal(store.getSetting("updateLatest", null), null);
	});
});

describe("installing an update", () => {
	test("installs that version with the npm next to Node.js, into the same folder, without scripts", async () => {
		const { updates, runs, node, prefix, refreshed } = setup();
		await updates.check();
		const started = updates.install("1.8.0");
		assert.equal(started.job?.state, "installing");
		await settle();
		const install = runs.find((run) => run.args.includes("install"));
		assert.deepEqual(install, {
			file: node,
			args: [
				npmNextTo(node),
				"install",
				"--global",
				"--prefix",
				prefix,
				"@tenonai/yew@1.8.0",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
			],
		});
		assert.equal(updates.state().job?.state, "installed");
		assert.equal(refreshed(), 1);
	});

	test("only the new version found on npm", async () => {
		const { updates } = setup();
		assert.throws(() => updates.install("1.8.0"), /not the new version found/);
		await updates.check();
		assert.throws(() => updates.install("1.9.0"), /not the new version found/);
		assert.throws(() => updates.install("1.8.0; rm -rf ~"), /must look like/);
	});

	test("where it may not write, it gives the command and does not run npm", async () => {
		const { updates, runs } = setup({ writable: () => false });
		const state = await updates.check();
		assert.equal(state.manual, "npm install --global @tenonai/yew@1.8.0");
		assert.throws(() => updates.install("1.8.0"), /cannot install it here/);
		assert.equal(runs.filter((run) => run.args.includes("install")).length, 0);
	});

	test("an install that fails says so, with npm's output", async () => {
		const { updates } = setup({
			run: async (_file, args) =>
				args.includes("config")
					? { code: 0, output: "https://registry.npmjs.org/" }
					: { code: 1, output: "npm error code EACCES" },
		});
		await updates.check();
		updates.install("1.8.0");
		await settle();
		const job = updates.state().job;
		assert.equal(job?.state, "failed");
		assert.match(job?.output ?? "", /EACCES/);
	});
});

describe("restarting", () => {
	test("waits for the sessions at work, or goes at once when asked", () => {
		mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
		try {
			const { updates, setBusy, restarts } = setup();
			setBusy(2);
			const waiting = updates.restart(false);
			assert.equal(waiting.restarting, false);
			assert.equal(waiting.restartPending, true);
			mock.timers.tick(5000);
			assert.equal(restarts(), 0);
			setBusy(0);
			mock.timers.tick(5000);
			assert.equal(restarts(), 1);

			setBusy(1);
			const now = updates.restart(true);
			assert.equal(now.restarting, true);
			mock.timers.tick(300);
			assert.equal(restarts(), 2);
		} finally {
			mock.timers.reset();
		}
	});

	test("the login service restarts it when it exits with an error; otherwise it starts itself", () => {
		assert.equal(startedByService({ XPC_SERVICE_NAME: "cn.tenonai.apps.yew" }, "darwin"), true);
		assert.equal(
			startedByService({ XPC_SERVICE_NAME: "application.cn.tenonai.apps.yew.desktop.1" }, "darwin"),
			false,
		);
		const unit = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/yew.service\n";
		assert.equal(
			startedByService({}, "linux", () => unit),
			true,
		);
		assert.equal(
			startedByService({}, "linux", () => "0::/user.slice/user-1000.slice/session-2.scope\n"),
			false,
		);
	});
});

describe("the routes", () => {
	test("a phone cannot reach them, and nothing runs", async () => {
		const { updates, runs, store } = setup();
		const app = createApp({ store, log: () => {}, updates });
		for (const [method, path] of [
			["GET", "/api/updates"],
			["POST", "/api/updates/check"],
			["POST", "/api/updates/install"],
			["POST", "/api/updates/restart"],
		] as const) {
			const response = await app.fetch(
				new Request(`http://localhost${path}`, {
					method,
					headers: { "Content-Type": "application/json" },
					...(method === "POST" ? { body: JSON.stringify({ version: "1.8.0", now: true }) } : {}),
				}),
				{ device: "phone-1" },
			);
			assert.equal(response.status, 403, `${method} ${path}`);
			assert.match(((await response.json()) as { type: string }).type, /mac-only$/);
		}
		assert.equal(runs.length, 0);
	});

	test("on the Mac: the state, a check and turning the daily check off", async () => {
		const { updates, store } = setup();
		const app = createApp({ store, log: () => {}, updates });
		const send = async (method: string, path: string, body?: unknown) => {
			const response = await app.fetch(
				new Request(`http://localhost${path}`, {
					method,
					headers: { "Content-Type": "application/json" },
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
			);
			return { status: response.status, body: (await response.json()) as Record<string, unknown> };
		};
		const first = await send("GET", "/api/updates");
		assert.equal(first.status, 200);
		assert.equal(first.body.version, "1.7.0");
		assert.equal(first.body.checks, true);
		const checked = await send("POST", "/api/updates/check");
		assert.equal(checked.body.available, true);
		await send("PATCH", "/api/settings", { updateCheck: false });
		assert.equal((await send("GET", "/api/updates")).body.checks, false);
	});
});
