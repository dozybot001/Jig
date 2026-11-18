/**
 * Loads an evaluation's world into a new data folder (docs/sim.md, section 1), the command-line
 * wrapper of loadWorld. The world's sessions under test get the model given here. The ids the world
 * got, by name, key and number, go to standard output as JSON.
 *
 *   node scripts/sim-load.ts <world.json> <data folder> [--model <provider>/<model>] [--skill <file>]
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadWorld } from "../src/sim/world.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { model: { type: "string" }, skill: { type: "string" } },
});
const [worldFile, home] = positionals;
if (!worldFile || !home) {
	process.stderr.write(
		"usage: node scripts/sim-load.ts <world.json> <data folder> [--model <provider>/<model>] [--skill <file>]\n",
	);
	process.exit(2);
}
const [provider, ...model] = (values.model ?? "").split("/");
const loaded = loadWorld(JSON.parse(readFileSync(worldFile, "utf8")), {
	home,
	...(provider && model.length > 0 ? { underTest: { provider, model: model.join("/") } } : {}),
	...(values.skill ? { skill: readFileSync(values.skill, "utf8") } : {}),
});
process.stdout.write(`${JSON.stringify(loaded, null, 2)}\n`);
