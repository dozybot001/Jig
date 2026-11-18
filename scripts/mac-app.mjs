// Builds the Mac app's program (macos/Yew) into dist/mac/Yew, one file for Apple silicon and Intel;
// `yew app install` puts it in ~/Applications/Yew.app. Runs as part of `npm run build`, so the
// package built for `npm publish` carries it.
//
//   npm run build:mac
//
// Only on a Mac with Xcode or its command line tools. Elsewhere it says so and builds nothing, and
// `yew app install` from that package makes the plain launcher that opens the browser instead.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = join(root, "macos", "Yew");
const work = join(root, "build", "mac");
const out = join(root, "dist", "mac");

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		console.error(
			`mac app: ${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`,
		);
		process.exit(1);
	}
	return result.stdout.trim();
}

if (process.platform !== "darwin") {
	console.error("mac app: skipped, it is built on macOS");
	process.exit(0);
}
if (spawnSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" }).status !== 0) {
	console.error("mac app: skipped, swiftc was not found (install Xcode or its command line tools)");
	process.exit(0);
}

const files = readdirSync(sources)
	.filter((name) => name.endsWith(".swift"))
	.map((name) => join(sources, name));
const sdk = run("xcrun", ["--show-sdk-path", "--sdk", "macosx"]);
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
const slices = ["arm64", "x86_64"].map((arch) => {
	const slice = join(work, `Yew-${arch}`);
	run("xcrun", [
		"swiftc",
		"-O",
		"-swift-version",
		"6",
		"-target",
		`${arch}-apple-macos13.0`,
		"-sdk",
		sdk,
		...files,
		"-o",
		slice,
	]);
	return slice;
});
run("xcrun", ["lipo", "-create", "-output", join(out, "Yew"), ...slices]);
console.error(`mac app: built ${join("dist", "mac", "Yew")} (arm64, x86_64)`);
