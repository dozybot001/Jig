#!/usr/bin/env node
// Starts Yew. In a source checkout it runs the TypeScript sources directly (Node.js strips the types);
// in the published package only the compiled files exist, and those run.
import { existsSync } from "node:fs";

const source = new URL("../src/cli/main.ts", import.meta.url);
await import(
	existsSync(source) ? source.href : new URL("../dist/cli/main.js", import.meta.url).href
);
