import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/store.ts";

const main = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

describe("yew serve", () => {
	test("starts on 127.0.0.1, signs in with the printed link, and stops cleanly", async () => {
		const home = tempDir("yew-serve-");
		const port = await freePort();
		const child = spawn(process.execPath, [main, "serve", "--port", String(port)], {
			// The servers Yew sets up by itself are fetched with npx: not in a test.
			env: {
				...process.env,
				YEW_HOME: home,
				NO_COLOR: "1",
				YEW_MCP_BUILTIN: "off",
				YEW_KEYCHAIN: "off",
				// The sandbox has its own tests; this one is about starting and stopping.
				YEW_SANDBOX: "off",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		const link = await new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`no link printed: ${stdout}`)), 15_000);
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
				const match = /http:\/\/127\.0\.0\.1:\d+\/#t=([\w-]+)/.exec(stdout);
				if (match?.[1]) {
					clearTimeout(timer);
					resolve(match[1]);
				}
			});
			child.on("exit", () => reject(new Error(`exited early: ${stdout}`)));
		});
		const base = `http://127.0.0.1:${port}`;
		try {
			assert.ok(existsSync(join(home, "serve.json")));
			assert.equal((await fetch(`${base}/api/sessions`)).status, 401);
			const exchange = await fetch(`${base}/api/auth/exchange`, {
				method: "POST",
				headers: { Origin: base, "Content-Type": "application/json" },
				body: JSON.stringify({ token: link }),
			});
			assert.equal(exchange.status, 204);
			const cookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0] as string;
			const sessions = await fetch(`${base}/api/sessions`, { headers: { Cookie: cookie } });
			assert.equal(sessions.status, 200);
			// An open event stream must not keep the service from stopping.
			const stream = await fetch(`${base}/api/events`, { headers: { Cookie: cookie } });
			assert.equal(stream.status, 200);
		} finally {
			const exited = new Promise<number | null>((resolve) =>
				child.on("exit", (code) => resolve(code)),
			);
			child.kill("SIGTERM");
			assert.equal(await exited, 0);
		}
		assert.equal(existsSync(join(home, "serve.json")), false);
	});
});
