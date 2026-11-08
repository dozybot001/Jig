/**
 * Finding the text an edit replaces. Exact match first; if that finds nothing, a second pass ignores
 * differences models often introduce: trailing spaces, curly quotes, long dashes and special spaces
 * (after pi's edit tool, prior-art 4.2). Either way the match must be unique.
 */

export type MatchResult =
	| { ok: true; start: number; end: number }
	| { ok: false; reason: "not_found" }
	| { ok: false; reason: "ambiguous"; count: number };

const CHAR_MAP: Record<string, string> = {
	"‘": "'",
	"’": "'",
	"‚": "'",
	"‛": "'",
	"“": '"',
	"”": '"',
	"„": '"',
	"‟": '"',
	"‐": "-",
	"‑": "-",
	"‒": "-",
	"–": "-",
	"—": "-",
	"―": "-",
	" ": " ",
	" ": " ",
	" ": " ",
	"　": " ",
};

export function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index >= 0) {
		count++;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/** Normalized text plus, for each of its characters, the index of the original character. */
function normalize(text: string): { text: string; map: number[] } {
	const out: string[] = [];
	const map: number[] = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i] as string;
		if (c === " " || c === "\t") {
			let j = i;
			while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
			// Whitespace at the end of a line is dropped.
			if (j === text.length || text[j] === "\n" || text[j] === "\r") {
				i = j;
				continue;
			}
		}
		out.push(CHAR_MAP[c] ?? (/[ - ]/.test(c) ? " " : c));
		map.push(i);
		i++;
	}
	return { text: out.join(""), map };
}

export function findUnique(content: string, needle: string): MatchResult {
	const exact = countOccurrences(content, needle);
	if (exact === 1) {
		const start = content.indexOf(needle);
		return { ok: true, start, end: start + needle.length };
	}
	if (exact > 1) return { ok: false, reason: "ambiguous", count: exact };

	const hay = normalize(content);
	const pin = normalize(needle).text;
	if (pin.trim().length === 0) return { ok: false, reason: "not_found" };
	const count = countOccurrences(hay.text, pin);
	if (count === 0) return { ok: false, reason: "not_found" };
	if (count > 1) return { ok: false, reason: "ambiguous", count };
	const at = hay.text.indexOf(pin);
	const start = hay.map[at] as number;
	const last = hay.map[at + pin.length - 1] as number;
	return { ok: true, start, end: last + 1 };
}
