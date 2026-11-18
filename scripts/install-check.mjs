// The release check for what a person installs (product standard 15.1.2; the security group, 11-18).
// npm applies `overrides` in this repository only, so the audit of its lock file says nothing about a
// global install. This packs Yew as `npm publish` does, installs the package globally into a
// throwaway prefix, and checks what got installed: the system sandbox gets the zod the lock file
// pins (the package carries sandbox-runtime and its dependencies, bundled, for that), and no high or
// critical advisory remains among the production dependencies.
//
//   npm run audit:install
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		console.error(`install-check: ${command} ${args.join(" ")} failed\n${result.stderr}`);
		process.exit(1);
	}
	return result.stdout;
}

const work = mkdtempSync(join(tmpdir(), "yew-install-check-"));
try {
	const tarball = run("npm", ["pack", "--pack-destination", work, "--silent"], root)
		.trim()
		.split("\n")
		.pop();
	const prefix = join(work, "prefix");
	run(
		"npm",
		["install", "-g", "--prefix", prefix, join(work, tarball), "--no-audit", "--no-fund"],
		work,
	);
	const installed = join(prefix, "lib", "node_modules", "@tenonai", "yew");

	const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
	const pinned = lock.packages["node_modules/zod"]?.version;
	const sandbox = createRequire(
		join(installed, "node_modules", "@anthropic-ai", "sandbox-runtime", "package.json"),
	);
	const got = JSON.parse(readFileSync(sandbox.resolve("zod/package.json"), "utf8")).version;
	if (got !== pinned) {
		console.error(`install-check: the sandbox gets zod ${got}; the lock file pins ${pinned}`);
		process.exit(1);
	}

	// npm audit needs a lock file: one written from what was installed, bundled packages included.
	run(
		"npm",
		["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
		installed,
	);
	const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
		cwd: installed,
		encoding: "utf8",
	});
	const report = JSON.parse(audit.stdout || "{}");
	if (!report.metadata) {
		console.error(`install-check: npm audit gave no report\n${audit.stderr}`);
		process.exit(1);
	}
	const severe = Object.entries(report.vulnerabilities ?? {}).filter(([, entry]) =>
		["high", "critical"].includes(entry.severity),
	);
	if (severe.length > 0) {
		for (const [name, entry] of severe) console.error(`install-check: ${entry.severity}: ${name}`);
		process.exit(1);
	}
	console.log(
		`install-check: ${tarball} installs; the sandbox gets zod ${got}; no high or critical advisory in what was installed`,
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}
