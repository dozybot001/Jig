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
