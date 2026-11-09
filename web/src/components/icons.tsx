import {
	Archive,
	ArrowUp,
	Ban,
	Check,
	CheckCheck,
	ChevronRight,
	Circle,
	CircleCheck,
	CircleDot,
	Clock,
	Code,
	Copy,
	Database,
	Download,
	FileText,
	Folder,
	FolderPlus,
	Inbox,
	Info,
	KeyRound,
	Languages,
	ListTodo,
	Mail,
	Menu,
	MessageCircle,
	MessageCircleQuestion,
	MessagesSquare,
	Minimize2,
	PanelLeftClose,
	PanelLeftOpen,
	PencilLine,
	Pin,
	Play,
	Plus,
	Search,
	Send,
	Settings,
	ShieldAlert,
	SlidersHorizontal,
	Smartphone,
	Square,
	SquarePen,
	Stamp,
	SunMoon,
	UserRoundPlus,
	Users,
	X,
} from "lucide-react";

/**
 * Jig's icons come from one set, Lucide (ISC licence): rounded line icons drawn on the same grid, so
 * every screen looks alike. 16 px with a 1.75 stroke; decorative, since the buttons carry the names.
 */
const props = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

export const PlusIcon = () => <Plus {...props} />;
export const FolderIcon = () => <Folder {...props} />;
export const GearIcon = () => <Settings {...props} />;
export const MenuIcon = () => <Menu {...props} />;
export const CodeIcon = () => <Code {...props} />;
export const NotesIcon = () => <FileText {...props} />;
export const ChatIcon = () => <MessageCircle {...props} />;
export const ArrowUpIcon = () => <ArrowUp {...props} strokeWidth={2} />;
export const StopIcon = () => <Square {...props} fill="currentColor" />;
export const SearchIcon = () => <Search {...props} />;
export const ChevronIcon = () => <ChevronRight {...props} size={14} className="chevron" />;
/** Marks a menu item that opens a submenu. */
export const SubmenuIcon = () => <ChevronRight {...props} size={14} className="menu-arrow" />;
export const PinIcon = () => <Pin {...props} size={13} className="pin-icon" />;
/** Make the context smaller. */
export const CompactIcon = () => <Minimize2 {...props} />;
export const PlayIcon = () => <Play {...props} />;
export const InfoIcon = () => <Info {...props} />;
export const CloseIcon = () => <X {...props} />;
export const ComposeIcon = () => <SquarePen {...props} />;
export const KeyIcon = () => <KeyRound {...props} />;
export const ShieldIcon = () => <ShieldAlert {...props} />;
export const QuestionIcon = () => <MessageCircleQuestion {...props} />;
export const SlidersIcon = () => <SlidersHorizontal {...props} />;
export const PhoneIcon = () => <Smartphone {...props} />;
export const MailIcon = () => <Mail {...props} />;
/** The approval center: everything waiting for the person. */
export const CenterIcon = () => <Inbox {...props} />;
/** Scheduled tasks: letters Jig sends at set times. */
export const ScheduleIcon = () => <Clock {...props} />;
/** The main conversation, where the person usually works. */
export const MainIcon = () => <MessagesSquare {...props} />;
/** A team in the person's organization. */
export const TeamIcon = () => <Users {...props} />;
/** New team, new workspace and new session look different where they stand side by side (the rail). */
export const NewTeamIcon = () => <UserRoundPlus {...props} />;
export const NewWorkspaceIcon = () => <FolderPlus {...props} />;
/** Actions on cards: send an answer or decision, allow, allow always, refuse. */
export const SendIcon = () => <Send {...props} />;
export const CheckIcon = () => <Check {...props} />;
export const CheckAllIcon = () => <CheckCheck {...props} />;
export const RefuseIcon = () => <Ban {...props} />;
export const ThemeIcon = () => <SunMoon {...props} />;
export const LanguageIcon = () => <Languages {...props} />;
/** Jig's data on this computer. */
export const DataIcon = () => <Database {...props} />;
/** The session menu: pin, rename, copy, export, archive. */
export const MenuPinIcon = () => <Pin {...props} />;
export const RenameIcon = () => <PencilLine {...props} />;
export const CopyIcon = () => <Copy {...props} />;
export const ExportIcon = () => <Download {...props} />;
export const ArchiveIcon = () => <Archive {...props} />;
/** A decision the person made. */
export const DecisionIcon = () => <Stamp {...props} />;
export const CollapseIcon = () => <PanelLeftClose {...props} />;
export const ExpandIcon = () => <PanelLeftOpen {...props} />;
export const TodoIcon = () => <ListTodo {...props} />;
/** Task states in the task list: to do, under way, done. */
export const TodoPendingIcon = () => <Circle {...props} size={14} />;
export const TodoActiveIcon = () => <CircleDot {...props} size={14} />;
export const TodoDoneIcon = () => <CircleCheck {...props} size={14} />;

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
