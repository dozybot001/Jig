// Writes THIRD-PARTY-NOTICES.md: the packages Jig needs at run time (npm installs them beside Jig;
// they are not inside Jig's package), with version and license, from the lock file. Packages built
// into the web interface are listed with their license texts in web/dist/THIRD-PARTY-NOTICES.txt,
// which the web build writes. Run by `npm run build`.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const rows = Object.entries(lock.packages)
	.filter(([path, entry]) => path.startsWith("node_modules/") && !entry.dev)
	.map(([path, entry]) => {
		const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
		let license = entry.license;
		if (!license) {
			try {
				license = JSON.parse(readFileSync(new URL(`${path}/package.json`, root), "utf8")).license;
			} catch {
				license = undefined;
			}
		}
		return {
			name,
			version: entry.version,
			license: typeof license === "string" ? license : "see the package",
		};
	})
	.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const unique = rows.filter(
	(row, i) => i === 0 || row.name !== rows[i - 1].name || row.version !== rows[i - 1].version,
);
const counts = new Map();
for (const row of unique) counts.set(row.license, (counts.get(row.license) ?? 0) + 1);
const summary = [...counts].sort((a, b) => b[1] - a[1]).map(([license, n]) => `${license} ${n}`);

writeFileSync(
	new URL("THIRD-PARTY-NOTICES.md", root),
	`# Third-party notices

Jig is published under the MIT license. It depends on the packages below, which npm installs
beside it; each stays under its own license, found in that package's folder. This list is
generated from \`package-lock.json\` by \`scripts/notices.mjs\`.

The web interface is built from further packages; they are listed with their license texts in
\`web/dist/THIRD-PARTY-NOTICES.txt\`.

${unique.length} packages: ${summary.join(", ")}.

| Package | Version | License |
| --- | --- | --- |
${unique.map((row) => `| ${row.name} | ${row.version} | ${row.license} |`).join("\n")}
`,
);
console.error(`THIRD-PARTY-NOTICES.md: ${unique.length} packages`);
