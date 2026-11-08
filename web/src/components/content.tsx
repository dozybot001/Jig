import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "../i18n.ts";

const SAFE_PROTOCOLS = /^(https?:|mailto:)/i;

/** Model output is untrusted: no raw HTML, only http(s) and mailto links, opened without referrer (M1 plan, section 10). */
function urlTransform(url: string): string {
	return SAFE_PROTOCOLS.test(url.trim()) ? url : "";
}

const components: Components = {
	a: ({ href, children }) =>
		href ? (
			<a href={href} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		) : (
			<span>{children}</span>
		),
	// Remote images are blocked by the page's CSP anyway; show where they point instead.
	img: ({ src, alt }) => (
		<a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">
			{alt || (typeof src === "string" ? src : "")}
		</a>
	),
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
	return (
		<div className="markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				urlTransform={urlTransform}
				components={components}
				skipHtml
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});

/**
 * A scrolling block of code or output. It has no focusable content, so it takes focus itself and has a
 * name, letting keyboard and screen-reader users scroll it (spec 18.6).
 */
export function ScrollBlock({
	label,
	className,
	children,
}: {
	label: string;
	className: string;
	children: ReactNode;
}) {
	return (
		// A named group, not a region: many output blocks would otherwise flood the landmark list.
		// biome-ignore lint/a11y/useSemanticElements: <pre> keeps whitespace; a fieldset would not
		// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area without focusable content must be focusable (spec 18.6)
		<pre className={className} role="group" aria-label={label} tabIndex={0}>
			{children}
		</pre>
	);
}

export function Diff({ patch }: { patch: string }) {
	const lines = patch
		.split("\n")
		.filter((line) => !line.startsWith("Index:") && !line.startsWith("====="));
	return (
		<ScrollBlock className="diff" label={t("diff")}>
			{lines.map((line, index) => {
				const kind = line.startsWith("@@")
					? "hunk"
					: line.startsWith("+") && !line.startsWith("+++")
						? "add"
						: line.startsWith("-") && !line.startsWith("---")
							? "del"
							: "";
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static and ordered
					<div key={index} className={kind}>
						{line || " "}
					</div>
				);
			})}
		</ScrollBlock>
	);
}

/** Highlights the U+0002 … U+0003 markers that search snippets carry. */
export function Snippet({ text }: { text: string }) {
	const START = String.fromCharCode(2);
	const END = String.fromCharCode(3);
	const parts: { mark: boolean; text: string; key: string }[] = [];
	let rest = text;
	while (rest.length > 0) {
		const open = rest.indexOf(START);
		const close = open >= 0 ? rest.indexOf(END, open) : -1;
		if (open < 0 || close < 0) {
			parts.push({ mark: false, text: rest, key: `p${parts.length}` });
			break;
		}
		if (open > 0) parts.push({ mark: false, text: rest.slice(0, open), key: `p${parts.length}` });
		parts.push({ mark: true, text: rest.slice(open + 1, close), key: `p${parts.length}` });
		rest = rest.slice(close + 1);
	}
	return (
		<span>
			{parts.map((part) =>
				part.mark ? (
					<mark key={part.key}>{part.text}</mark>
				) : (
					<span key={part.key}>{part.text}</span>
				),
			)}
		</span>
	);
}
