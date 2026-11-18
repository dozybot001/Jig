/**
 * A computer to record the phone apps against, for App Review and demos: a throwaway Yew with two
 * sessions, a small website project, and the scripted stand-in model (scripts/demo-model.ts) in
 * place of a real one. When it is up, the Website session waits for approval to delete a draft
 * page and the Docs session waits for an answer, so the phone has something to act on at once.
 *
 * Nothing touches ~/.yew, the system keychain or a real model: the data folder is <folder>/home,
 * keys are kept in memory, Yew's own browser and computer control are left out. Phone access goes
 * through the default relay, as it does for a person, so a real phone can pair with it.
 *
 *   node scripts/review-demo.ts <folder> [port]
 *
 * It prints a sign-in link for the web interface; pair the phone from Settings → Add phone there.
 * Stop it with Ctrl-C. Run it again with a new folder for a fresh start.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/server/db/database.ts";
import { EventBus } from "../src/server/events.ts";
import { Store } from "../src/server/store.ts";
import { DEFAULT_RELAY_URL } from "../src/shared/types.ts";
import { startDemoModel } from "./demo-model.ts";

const [folderArg, portArg] = process.argv.slice(2);
if (!folderArg) {
	process.stderr.write("usage: node scripts/review-demo.ts <folder> [port]\n");
	process.exit(2);
}
const folder = resolve(folderArg);
const port = Number(portArg ?? 4790);
const MODEL_PORT = 8798;
const root = fileURLToPath(new URL("..", import.meta.url));
const home = join(folder, "home");
const site = join(folder, "website");
const log = (line: string) => process.stderr.write(`${line}\n`);

// A small project for the Website session: a page, a draft to clean up, three passing tests.
for (const dir of [home, join(site, "drafts"), join(site, "test")])
	mkdirSync(dir, { recursive: true });
const files: Record<string, string> = {
	"package.json": `${JSON.stringify({ name: "website", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
	"index.html": "<!doctype html>\n<title>Example Studio</title>\n<h1>Example Studio</h1>\n",
	"contact.html":
		'<!doctype html>\n<title>Contact</title>\n<a href="mailto:hello@example.com">hello@example.com</a>\n',
	"drafts/old-home.html": "<!doctype html>\n<title>Old home page</title>\n",
	"test/pages.test.js": [
		'import assert from "node:assert/strict";',
		'import { readFileSync } from "node:fs";',
		'import { test } from "node:test";',
		'const page = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");',
		'test("the home page has a title", () => assert.match(page("index.html"), /<title>/));',
		'test("the contact page links an address", () => assert.match(page("contact.html"), /mailto:/));',
		'test("pages declare a doctype", () => assert.match(page("index.html"), /^<!doctype html>/));',
		"",
	].join("\n"),
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(site, name), content);
const git = (...args: string[]) => execFileSync("git", args, { cwd: site, stdio: "ignore" });
git("init", "-q", "-b", "main");
git("add", ".");
git("-c", "user.name=Demo", "-c", "user.email=demo@example.com", "commit", "-q", "-m", "Website");

await startDemoModel(MODEL_PORT);

// Seed the data folder before Yew opens it.
const db = openDatabase(join(home, "yew.db"));
const store = new Store(db, new EventBus());
store.saveCustomProvider({
	id: "demo",
	name: "Demo model (local)",
	baseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`,
	keyRequired: false,
	models: [{ id: "demo-1", name: "Demo model", contextWindow: 128_000, maxTokens: 8000 }],
});
store.setSetting("defaultModel", { provider: "demo", model: "demo-1", thinking: "off" });
store.setSetting("remote", { enabled: true, relayUrl: DEFAULT_RELAY_URL });
for (const [name, cwd] of [
	["Website", site],
	["Docs", null],
] as const) {
	if (store.findSessionByName(name)) continue;
	store.createSession({
		name,
		kind: "standing",
		provider: "demo",
		model: "demo-1",
		cwd,
		thinking: "off",
		options: { permissionMode: "default" },
	});
}
db.close();

const env = {
	...process.env,
	YEW_HOME: home,
	YEW_KEYCHAIN: "off",
	YEW_MCP_BUILTIN: "off",
	NO_COLOR: "1",
};
const yew = (...args: string[]) =>
	execFileSync(process.execPath, [join(root, "bin/yew.js"), ...args], { env, stdio: "ignore" });
const serve = spawn(process.execPath, [join(root, "bin/yew.js"), "serve", "--port", String(port)], {
	env,
	stdio: ["ignore", "pipe", "inherit"],
});
let started = false;
serve.stdout.setEncoding("utf8");
serve.stdout.on("data", (text: string) => {
	const link = /http:\/\/127\.0\.0\.1:\d+\/#t=\S+/.exec(text)?.[0];
	if (!link || started) return;
	started = true;
	// Work for the phone to act on: an approval and a question.
	yew(
		"send",
		"--kind",
		"request",
		"Website",
		"Please clean up the drafts folder before the release.",
	);
	yew("send", "--kind", "request", "Docs", "Please write the release notes for the next version.");
	log(`Yew is up. Sign in here, then open Settings → Add phone to pair:\n${link}`);
});
const stop = () => {
	serve.kill("SIGTERM");
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
serve.on("exit", (code) => {
	log(`yew serve ended (${code})`);
	process.exit(code ?? 0);
});
