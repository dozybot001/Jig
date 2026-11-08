import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	base: "/",
	plugins: [react()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		// The CSP allows only same-origin scripts and styles, so nothing may be inlined.
		assetsInlineLimit: 0,
		modulePreload: { polyfill: false },
		sourcemap: false,
	},
});
