// The outer guard (guard.ts; the security group, 11-18): commands that do not run in the system
// sandbox are still kept out of Yew's data folder and the Mac app's web storage. The normal flow
// only; whether it can be got around is the security group's to test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
	guardedArgs,
	guardKind,
	guardProfile,
	resolved,
	startGuard,
	stopGuard,
} from "../src/server/guard.ts";
import { findProgram } from "../src/server/sandbox.ts";
import { tempDir } from "./helpers/store.ts";

afterEach(() => stopGuard());

describe("the guard", () => {
	test("the macOS profile allows everything but the places, which it quotes", () => {
		const profile = guardProfile(["/Users/me/.yew", '/odd/"name"']);
		assert.match(profile, /^\(version 1\)\n\(allow default\)\n/);
		assert.match(
			profile,
			/\(deny file-read\* file-write\* \(subpath "\/Users\/me\/\.yew"\) \(subpath "\/odd\/\\"name\\""\)\)$/,
		);
	});

	test("Linux lays an empty folder over each folder and binds the rest as it is", () => {
		const data = tempDir("yew-data-");
		const args = guardedArgs("/bin/sh", "ls", {
			kind: "linux",
			program: "/usr/bin/bwrap",
			places: [data, "/nowhere/file"],
		});
		assert.deepEqual(args, {
			file: "/usr/bin/bwrap",
			args: ["--dev-bind", "/", "/", "--tmpfs", data, "--", "/bin/sh", "-lc", "ls"],
		});
	});

	test("without a guard there is nothing to run in", () => {
		assert.equal(guardedArgs("/bin/sh", "ls"), null);
		assert.equal(startGuard(["/tmp/x"], () => null, "win32").kind, "none");
	});

	const runs =
		process.platform === "darwin" || (process.platform === "linux" && findProgram("bwrap"));
	test("a command in it cannot read the data folder, and writes elsewhere as before", {
		skip: runs ? false : "no sandbox-exec or bubblewrap here",
	}, () => {
		const data = tempDir("yew-data-");
		writeFileSync(join(data, "yew.db"), "the decisions");
		const work = tempDir("yew-work-");
		mkdirSync(join(work, "out"));
		const started = startGuard([data], (name) => findProgram(name));
		if (started.kind === "none") {
			// A Linux machine where bubblewrap cannot make a namespace: no guard, and why.
			assert.ok(started.problem);
			return;
		}
		assert.equal(guardKind(), started.kind);
		const read = guardedArgs("/bin/sh", `cat '${join(resolved(data), "yew.db")}'`);
		assert.ok(read);
		const denied = spawnSync(read.file, read.args, { encoding: "utf8" });
		assert.notEqual(denied.status, 0);
		assert.doesNotMatch(denied.stdout, /the decisions/);
		const write = guardedArgs("/bin/sh", `echo done > '${join(work, "out", "a.txt")}'`);
		assert.ok(write);
		assert.equal(spawnSync(write.file, write.args).status, 0);
		assert.equal(readFileSync(join(work, "out", "a.txt"), "utf8"), "done\n");
	});
});
