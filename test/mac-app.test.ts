import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const sources = fileURLToPath(new URL("../macos/Yew/", import.meta.url));
// The program is built with Xcode's compiler on macOS (scripts/mac-app.mjs); elsewhere there is none.
const swift =
	process.platform === "darwin" &&
	spawnSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" }).status === 0;

describe("the Mac app", () => {
	test("its Swift compiles in Swift 6 mode for macOS 13", {
		skip: !swift && "needs macOS with swiftc",
	}, () => {
		const files = readdirSync(sources)
			.filter((name) => name.endsWith(".swift"))
			.map((name) => `${sources}${name}`);
		assert.ok(files.length > 0);
		const result = spawnSync(
			"xcrun",
			["swiftc", "-typecheck", "-swift-version", "6", "-target", "arm64-apple-macos13.0", ...files],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
	});
});
