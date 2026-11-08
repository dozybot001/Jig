import {
	ArrowUp,
	ChevronRight,
	Code,
	FileText,
	Folder,
	Info,
	ListPlus,
	Menu,
	MessageCircle,
	Minimize2,
	Pin,
	Play,
	Plus,
	Search,
	Settings,
	Square,
	X,
} from "lucide-react";

/**
 * Jig's icons come from one set, Lucide (ISC licence): rounded line icons drawn on the same grid, so
 * every screen looks alike. 16 px with a 1.75 stroke; decorative, since the buttons carry the names.
 */
const props = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

export const PlusIcon = () => <Plus {...props} />;
export const FolderIcon = () => <Folder {...props} />;
/** New group: groups are lists of sessions, not folders. */
export const GroupPlusIcon = () => <ListPlus {...props} />;
export const GearIcon = () => <Settings {...props} />;
export const MenuIcon = () => <Menu {...props} />;
export const CodeIcon = () => <Code {...props} />;
export const NotesIcon = () => <FileText {...props} />;
export const ChatIcon = () => <MessageCircle {...props} />;
export const ArrowUpIcon = () => <ArrowUp {...props} strokeWidth={2} />;
export const StopIcon = () => <Square {...props} fill="currentColor" />;
export const SearchIcon = () => <Search {...props} />;
export const ChevronIcon = () => <ChevronRight {...props} size={14} className="chevron" />;
export const PinIcon = () => <Pin {...props} size={13} className="pin-icon" />;
/** Make the context smaller. */
export const CompactIcon = () => <Minimize2 {...props} />;
export const PlayIcon = () => <Play {...props} />;
export const InfoIcon = () => <Info {...props} />;
export const CloseIcon = () => <X {...props} />;

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
