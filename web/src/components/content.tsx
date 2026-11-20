import {
	memo,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { openLocalFileLink } from "../actions.ts";
import { t } from "../i18n.ts";
import { getState, useAppState } from "../state.ts";
import { NotesIcon } from "./icons.tsx";

const SAFE_PROTOCOLS = /^(https?:|mailto:)/i;
const YEW_FILE_PREFIX = "yew-file:";

interface ParsedFileLink {
	path: string;
	line?: number;
	column?: number;
}

function decodeSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * Recognizes local file links in Markdown (`file://...`, `/abs/path`, `~/path`, `./rel`, `dir/file.md`),
 * with optional `#L12`, `#L12-L20`, `:12` or `:12:5` line/column anchors. Rejects unknown URI schemes.
 */
export function parseLocalFileHref(raw: string): ParsedFileLink | null {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;
	if (SAFE_PROTOCOLS.test(trimmed)) return null;

	let body = trimmed;
	let line: number | undefined;
	let column: number | undefined;

	const hashIndex = body.indexOf("#");
	if (hashIndex >= 0) {
		const fragment = body.slice(hashIndex + 1);
		body = body.slice(0, hashIndex);
		const match = /^L?(\d+)(?:-L?\d+)?$/i.exec(fragment);
		if (match) line = Number.parseInt(match[1] as string, 10);
	}

	const isFileUrl = /^file:\/\//i.test(body);
	const lineMatch = /:(\d+)(?::(\d+))?$/.exec(body);
	if (lineMatch && lineMatch.index > (isFileUrl ? 7 : 0)) {
		if (line === undefined) line = Number.parseInt(lineMatch[1] as string, 10);
		if (lineMatch[2]) column = Number.parseInt(lineMatch[2], 10);
		body = body.slice(0, lineMatch.index);
	}

	if (!body) return null;
	if (isFileUrl) {
		return {
			path: body,
			...(line !== undefined ? { line } : {}),
			...(column !== undefined ? { column } : {}),
		};
	}

	// Refuse any non-file URI scheme such as javascript:, data:, vbscript:, tel:, etc.
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(body)) return null;
	return {
		path: decodeSafe(body),
		...(line !== undefined ? { line } : {}),
		...(column !== undefined ? { column } : {}),
	};
}

/** Model output is untrusted: no raw HTML; web links open without referrer, local file links route via API. */
function urlTransform(url: string): string {
	const trimmed = url.trim();
	if (SAFE_PROTOCOLS.test(trimmed)) return trimmed;
	if (parseLocalFileHref(trimmed)) return `${YEW_FILE_PREFIX}${encodeURIComponent(trimmed)}`;
	return "";
}

function FileLink({
	raw,
	sessionId,
	children,
}: {
	raw: string;
	sessionId?: string | null;
	children: ReactNode;
}) {
	const opener = useAppState((state) => state.settings?.fileOpener ?? "system");
	const [error, setError] = useState<string | null>(null);
	const parsed = parseLocalFileHref(raw);
	if (!parsed) return <span>{children}</span>;
	const displayPath = parsed.path.replace(/^file:\/\//i, "");
	const location = parsed.line
		? `${decodeSafe(displayPath)}:${parsed.line}${parsed.column ? `:${parsed.column}` : ""}`
		: decodeSafe(displayPath);
	const open = async () => {
		setError(null);
		try {
			await openLocalFileLink(parsed.path, {
				sessionId: sessionId ?? getState().selectedId,
				...(parsed.line !== undefined ? { line: parsed.line } : {}),
				...(parsed.column !== undefined ? { column: parsed.column } : {}),
			});
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : t("openFileFailed");
			setError(message);
			window.setTimeout(() => setError(null), 4000);
		}
	};
	return (
		<span className="file-link-wrap">
			<button
				type="button"
				className="file-link"
				title={t("openFileTooltip", { path: location, app: t(`fileOpener_${opener}`) })}
				onClick={() => void open()}
			>
				<NotesIcon />
				<span>{children}</span>
			</button>
			{error && (
				<span className="file-link-error" role="alert">
					{error}
				</span>
			)}
		</span>
	);
}

const baseComponents: Components = {
	// Remote images are blocked by the page's CSP anyway; show where they point instead.
	img: ({ src, alt }) => (
		<a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">
			{alt || (typeof src === "string" ? src : "")}
		</a>
	),
};

/**
 * Keeps a scroll area at its bottom while content arrives, until the person scrolls up (spec 9.8).
 * Scrolling up with the wheel, a finger or the keyboard stops following at once, before the next update
 * could pull the view back; so does moving the scroll bar up. Reaching the bottom again follows again.
 * A wheel or finger over an inner box that scrolls on its own does not count: it scrolls that box.
 */
export function useStickToBottom(
	ref: RefObject<HTMLElement | null>,
	onChange?: (following: boolean) => void,
): { current: boolean } {
	const following = useRef(true);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		let lastTop = element.scrollTop;
		let touchY: number | null = null;
		const set = (value: boolean) => {
			if (following.current === value) return;
			following.current = value;
			onChange?.(value);
		};
		const innerScrolls = (target: EventTarget | null) => {
			for (
				let node = target as HTMLElement | null;
				node && node !== element;
				node = node.parentElement
			) {
				if (node.scrollHeight > node.clientHeight + 1) {
					const overflow = getComputedStyle(node).overflowY;
					if (overflow === "auto" || overflow === "scroll") return true;
				}
			}
			return false;
		};
		const onScroll = () => {
			if (element.scrollHeight - element.scrollTop - element.clientHeight <= 2) set(true);
			else if (element.scrollTop < lastTop) set(false);
			lastTop = element.scrollTop;
		};
		const onWheel = (event: WheelEvent) => {
			if (event.deltaY < 0 && !innerScrolls(event.target)) set(false);
		};
		const onTouchStart = (event: TouchEvent) => {
			touchY = event.touches[0]?.clientY ?? null;
		};
		const onTouchMove = (event: TouchEvent) => {
			const y = event.touches[0]?.clientY;
			if (y === undefined) return;
			// A finger moving down scrolls the content up.
			if (touchY !== null && y > touchY + 2 && !innerScrolls(event.target)) set(false);
			touchY = y;
		};
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
			if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") set(false);
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		element.addEventListener("wheel", onWheel, { passive: true });
		element.addEventListener("touchstart", onTouchStart, { passive: true });
		element.addEventListener("touchmove", onTouchMove, { passive: true });
		element.addEventListener("keydown", onKey);
		return () => {
			element.removeEventListener("scroll", onScroll);
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("touchstart", onTouchStart);
			element.removeEventListener("touchmove", onTouchMove);
			element.removeEventListener("keydown", onKey);
		};
	}, [ref, onChange]);
	return following;
}

/**
 * A block with a fixed maximum height that scrolls inside instead of growing the page (spec 9.5–9.7):
 * thinking, long messages, letters, code and tool output. The limit is invisible until it is reached;
 * then the block fades out at the bottom while more lies below, and it can take focus so keyboard and
 * screen-reader users can scroll it (spec 18.6). With `follow`, it stays at its bottom while the text
 * streams in, until the person scrolls up inside it.
 */
export function Capped({
	as = "div",
	className,
	label,
	follow = false,
	focusable = "overflow",
	id,
	hidden,
	children,
}: {
	as?: "div" | "pre" | "ol";
	className?: string;
	label: string;
	follow?: boolean;
	/** "always" for blocks that are usually long, such as tool output. */
	focusable?: "always" | "overflow";
	id?: string;
	hidden?: boolean;
	children: ReactNode;
}) {
	const ref = useRef<HTMLElement>(null);
	const [fit, setFit] = useState({ overflow: false, more: false });
	const following = useStickToBottom(ref);
	const measure = useCallback(() => {
		const element = ref.current;
		if (!element) return;
		const overflow = element.scrollHeight > element.clientHeight + 1;
		const more = overflow && element.scrollHeight - element.scrollTop - element.clientHeight > 1;
		setFit((current) =>
			current.overflow === overflow && current.more === more ? current : { overflow, more },
		);
	}, []);
	// Re-measure only when content or follow mode changes, not on unrelated parent renders.
	// biome-ignore lint/correctness/useExhaustiveDependencies: children drives overflow height
	useLayoutEffect(() => {
		const element = ref.current;
		if (element && follow && following.current) element.scrollTop = element.scrollHeight;
		measure();
	}, [children, follow, measure]);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			element.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [measure]);
	const Tag = as;
	const scrollable = focusable === "always" || fit.overflow;
	return (
		<Tag
			ref={ref as never}
			id={id}
			hidden={hidden}
			className={className}
			data-more={fit.more ? "true" : undefined}
			// A named group, not a region: many blocks would otherwise flood the landmark list.
			role={scrollable ? "group" : undefined}
			aria-label={scrollable ? label : undefined}
			// A scroll area without focusable content must be focusable (spec 18.6).
			tabIndex={scrollable ? 0 : undefined}
		>
			{children}
		</Tag>
	);
}

/** A scrolling block of code or output; see Capped. */
export function ScrollBlock({
	label,
	className,
	follow = false,
	children,
}: {
	label: string;
	className: string;
	follow?: boolean;
	children: ReactNode;
}) {
	return (
		<Capped as="pre" className={className} label={label} follow={follow} focusable="always">
			{children}
		</Capped>
	);
}

/**
 * Markdown from the model or another session. Code blocks keep a fixed height and scroll inside; in a
 * reply that is still streaming they follow the newest line.
 */
/** Letters are plain text first (blueprint 7.1): their single line breaks stay line breaks. */
const PLAIN_PLUGINS = [remarkGfm];
const LETTER_PLUGINS = [remarkGfm, remarkBreaks];

export const Markdown = memo(function Markdown({
	text,
	live = false,
	breaks = false,
	sessionId,
}: {
	text: string;
	live?: boolean;
	breaks?: boolean;
	sessionId?: string | null;
}) {
	const components = useMemo<Components>(
		() => ({
			...baseComponents,
			a: ({ href, children }) => {
				if (!href) return <span>{children}</span>;
				if (href.startsWith(YEW_FILE_PREFIX)) {
					return (
						<FileLink
							raw={decodeURIComponent(href.slice(YEW_FILE_PREFIX.length))}
							sessionId={sessionId}
						>
							{children}
						</FileLink>
					);
				}
				return (
					<a href={href} target="_blank" rel="noopener noreferrer">
						{children}
					</a>
				);
			},
			pre: ({ children }) => (
				<Capped as="pre" label={t("codeBlock")} follow={live}>
					{children}
				</Capped>
			),
		}),
		[live, sessionId],
	);
	return (
		<div className="markdown">
			<ReactMarkdown
				remarkPlugins={breaks ? LETTER_PLUGINS : PLAIN_PLUGINS}
				urlTransform={urlTransform}
				components={components}
				skipHtml
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});

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
