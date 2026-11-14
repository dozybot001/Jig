import { readFileSync } from "node:fs";

// Read at run time rather than imported, so the compiled package finds it the same way the sources
// do: two folders up from this file, in both layouts.
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
	version: string;
};

export const NAME = "jig";
export const VERSION: string = pkg.version;
export const PUBLISHER = "Tenon AI";
export const WEBSITE = "https://tenonai.cn/";
