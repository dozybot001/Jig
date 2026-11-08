/** Line icons drawn for Jig; 16 px, stroke in the current text colour. Decorative: buttons carry the name. */

const base = {
	viewBox: "0 0 16 16",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
};

export function PlusIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M8 3v10M3 8h10" />
		</svg>
	);
}

export function FolderPlusIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
			<path d="M8 7v4M6 9h4" />
		</svg>
	);
}

export function GearIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<circle cx="8" cy="8" r="2" />
			<path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
		</svg>
	);
}

export function MenuIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
		</svg>
	);
}

export function CodeIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
		</svg>
	);
}

export function NotesIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M4 2h6l3 3v9H4z" />
			<path d="M10 2v3h3M6 8h4M6 11h4" />
		</svg>
	);
}

export function ChatIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
		</svg>
	);
}

export function ArrowUpIcon() {
	return (
		<svg {...base} strokeWidth={1.8} aria-hidden="true">
			<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
		</svg>
	);
}

export function StopIcon() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
		</svg>
	);
}

export function ComposeIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M13.5 8.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" />
			<path d="M11.8 2.2a1.2 1.2 0 0 1 1.7 1.7L8.5 9l-2 .5.5-2z" />
		</svg>
	);
}

export function SearchIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<circle cx="7" cy="7" r="4.5" />
			<path d="m10.5 10.5 3 3" />
		</svg>
	);
}

export function ChevronIcon() {
	return (
		<svg {...base} className="chevron" aria-hidden="true">
			<path d="m6 4 4 4-4 4" />
		</svg>
	);
}

/**
 * Jig's mark: three parallel strokes forming a J. Drawn in the text colour, so it is ink on light
 * themes and reversed on dark ones (spec 1.5). Decorative: the lockup around it carries the name.
 */
export function JigMark({ className, size }: { className?: string; size: number }) {
	return (
		<svg className={className} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
			<g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round">
				<path d="M54 8V34A22 22 0 0 1 10 34" />
				<path d="M45 8V34A13 13 0 0 1 19 34" />
				<path d="M36 8V34A4 4 0 0 1 28 34" />
			</g>
		</svg>
	);
}

export function PinIcon() {
	return (
		<svg {...base} className="pin-icon" aria-hidden="true">
			<path d="M9.5 2.5 13.5 6.5 10.8 7.8 8.2 10.4 8 13 3 8l2.6-.2 2.6-2.6z" />
			<path d="M5.5 10.5 2.5 13.5" />
		</svg>
	);
}

/** Two arrows pointing inward: make the context smaller. */
export function CompactIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M3 6h3V3M13 6h-3V3M3 10h3v3M13 10h-3v3" />
		</svg>
	);
}

export function PlayIcon() {
	return (
		<svg {...base} aria-hidden="true">
			<path d="M5 3.5v9l7-4.5z" />
		</svg>
	);
}
