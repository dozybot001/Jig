import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keyCommand } from "../src/cli/key.ts";
import { run } from "../src/cli/run.ts";
import { MemoryKeyStore } from "../src/server/keys.ts";
import type { ProviderInfo } from "../src/server/model/gateway.ts";
import { fakeIo } from "./helpers/io.ts";

const providers: ProviderInfo[] = [
	{ id: "deepseek", name: "DeepSeek", region: "cn", baseUrl: "", keyRequired: true, custom: false },
	{ id: "openai", name: "OpenAI", region: "global", baseUrl: "", keyRequired: true, custom: false },
];

function setup(initial: Record<string, string> = {}) {
	const keys = new MemoryKeyStore(initial);
	const commands = [keyCommand(() => ({ keys, providers }))];
	return {
		keys,
		exec: (argv: string[], io: ReturnType<typeof fakeIo>["io"]) => run(argv, io, commands),
	};
}

describe("jig key", () => {
	test("set reads the key from piped stdin, never from arguments", async () => {
		const { keys, exec } = setup();
		const { io, stdout } = fakeIo({ stdin: ["sk-test-123\n"] });
		assert.equal(await exec(["key", "set", "deepseek"], io), 0);
		assert.equal(await keys.get("deepseek"), "sk-test-123");
		assert.match(stdout.text(), /Saved the API key for DeepSeek/);
		assert.ok(!stdout.text().includes("sk-test-123"));
	});

	test("set with empty input saves nothing", async () => {
		const { keys, exec } = setup();
		const { io } = fakeIo({ stdin: ["\n"] });
		assert.equal(await exec(["key", "set", "deepseek"], io), 1);
		assert.equal(await keys.get("deepseek"), null);
	});

	test("unknown providers and stray arguments are usage errors", async () => {
		const { exec } = setup();
		for (const argv of [
			["key", "set", "nope"],
			["key", "set"],
			["key", "set", "deepseek", "sk-in-args"],
			["key", "frobnicate"],
		]) {
			const { io, stderr } = fakeIo();
			assert.equal(await exec(argv, io), 2, argv.join(" "));
			assert.match(stderr.text(), /^jig: /);
		}
	});

	test("delete needs a terminal or --yes", async () => {
		const { keys, exec } = setup({ deepseek: "sk" });
		const refused = fakeIo();
		assert.equal(await exec(["key", "delete", "deepseek"], refused.io), 2);
		assert.equal(await keys.get("deepseek"), "sk");
		const forced = fakeIo();
		assert.equal(await exec(["key", "delete", "deepseek", "--yes"], forced.io), 0);
		assert.equal(await keys.get("deepseek"), null);
		const asked = fakeIo({ tty: true, stdin: ["n\n"] });
		await keys.set("deepseek", "sk");
		assert.equal(await exec(["key", "delete", "deepseek"], asked.io), 1);
		assert.equal(await keys.get("deepseek"), "sk");
	});

	test("list shows which providers have a key, as text or JSON", async () => {
		const { exec } = setup({ deepseek: "sk" });
		const text = fakeIo();
		assert.equal(await exec(["key", "list"], text.io), 0);
		assert.match(text.stdout.text(), /^deepseek {2}key saved {2}DeepSeek$/m);
		assert.match(text.stdout.text(), /^openai {4}no key {2}OpenAI$/m);
		const json = fakeIo();
		assert.equal(await exec(["key", "list", "--json"], json.io), 0);
		assert.deepEqual(JSON.parse(json.stdout.text()), [
			{ id: "deepseek", name: "DeepSeek", region: "cn", hasKey: true },
			{ id: "openai", name: "OpenAI", region: "global", hasKey: false },
		]);
	});

	test("the top-level help lists the key command", async () => {
		const { exec } = setup();
		const { io, stdout } = fakeIo();
		await exec(["--help"], io);
		assert.match(stdout.text(), /key {2}Manage API keys for model providers/);
	});
});
