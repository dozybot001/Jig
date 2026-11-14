import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Lists the packages that end up inside the built interface, each with its license text, in
 * THIRD-PARTY-NOTICES.txt beside the bundle: the built files carry other people's code, and their
 * licenses ask for the notice to travel with it.
 */
function notices(): Plugin {
	return {
		name: "jig-notices",
		generateBundle(_, bundle) {
			const folders = new Set<string>();
			for (const chunk of Object.values(bundle)) {
				if (chunk.type !== "chunk") continue;
				for (const id of chunk.moduleIds) {
					const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(id.replace(/^\0/, ""));
					if (match?.[1]) folders.add(match[1]);
				}
			}
			const entries = [...folders]
				.map((folder) => {
					const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
						name: string;
						version: string;
						license?: string;
					};
					const file = existsSync(folder)
						? readdirSync(folder).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name))
						: undefined;
					return {
						...pkg,
						text: file
							? readFileSync(join(folder, file), "utf8").trim()
							: "(no license file in the package)",
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name));
			this.emitFile({
				type: "asset",
				fileName: "THIRD-PARTY-NOTICES.txt",
				source: `Jig's web interface is built from these packages. Each stays under its own license.\n\n${entries
					.map(
						(entry) =>
							`${"=".repeat(72)}\n${entry.name} ${entry.version} (${entry.license ?? "see below"})\n${"=".repeat(72)}\n${entry.text}\n`,
					)
					.join("\n")}`,
			});
		},
	};
}

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	base: "/",
	plugins: [react(), notices()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		// The CSP allows only same-origin scripts and styles, so nothing may be inlined.
		assetsInlineLimit: 0,
		modulePreload: { polyfill: false },
		sourcemap: false,
	},
});
