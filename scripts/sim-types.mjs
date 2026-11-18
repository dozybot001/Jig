// The type declarations of `@tenonai/yew/sim` (docs/sim.md): tsc writes them for everything the entry
// reaches into build/sim-types; only the sim module's own go into the package, beside its JavaScript,
// with their imports pointing at the .js files that are there.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const from = "build/sim-types/sim";
const to = "dist/sim";
for (const name of readdirSync(from)) {
	if (!name.endsWith(".d.ts")) continue;
	const text = readFileSync(join(from, name), "utf8").replace(/(from "\.\/[\w-]+)\.ts"/g, '$1.js"');
	writeFileSync(join(to, name), text);
}
rmSync("build/sim-types", { recursive: true, force: true });
