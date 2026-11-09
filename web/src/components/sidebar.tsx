import { useEffect, useRef, useState } from "react";
import type { Group, Session } from "../../../src/shared/types.ts";
import {
	deleteGroup,
	exportSession,
	openCenter,
	saveSettings,
	selectSession,
	setMainSession,
	toggleArchived,
	updateSession,
} from "../actions.ts";
import { api } from "../api.ts";
import { formatAgo, t, useLang } from "../i18n.ts";
import {
	centerCount,
	setSidebarCollapsed,
	setState,
	useAppState,
	type Workspace,
} from "../state.ts";
import { Snippet } from "./content.tsx";
import { ConfirmDialog, GroupDialog, NewSessionDialog, SessionSettingsDialog } from "./dialogs.tsx";
import {
	CenterIcon,
	ChatIcon,
	CloseIcon,
	CodeIcon,
	CollapseIcon,
	ComposeIcon,
	ExpandIcon,
	FolderIcon,
	GroupPlusIcon,
	JigMark,
	MainIcon,
	PinIcon,
	PlusIcon,
	SearchIcon,
} from "./icons.tsx";
import { SettingsMenu } from "./settings.tsx";
import { Button, describeError, ErrorBox, Menu, useAction } from "./ui.tsx";
import { shortPath, useWorkspaces, WorkspaceDialog } from "./workspaces.tsx";

interface SearchResult {
	sessions: Session[];
	hits: { sessionId: string; entryId: string; seq: number; snippet: string }[];
}

function closeDrawer(): void {
	setState({ drawerOpen: false });
}

/** True on narrow screens, where the sidebar is a drawer instead of a column. */
export function useNarrow(): boolean {
	const query = "(max-width: 760px)";
	const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const list = window.matchMedia(query);
		const change = () => setNarrow(list.matches);
		list.addEventListener("change", change);
		return () => list.removeEventListener("change", change);
	}, []);
	return narrow;
}

/** Re-renders every minute so the times beside sessions stay current. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

/**
 * Renaming in place: the row's name becomes a field. Enter or clicking away saves, Escape cancels.
 * A renamed session keeps its id, so messages to it still arrive (blueprint 7.1).
 */
function InlineRename({
	icon,
	value: initial,
	onSave,
	onDone,
}: {
	icon: React.ReactNode;
	value: string;
	onSave: (name: string) => Promise<unknown>;
	onDone: () => void;
}) {
	useLang();
	const [value, setValue] = useState(initial);
	const input = useRef<HTMLInputElement>(null);
	// Escape closes the field; the blur that follows must not save what was typed.
	const cancelled = useRef(false);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);
	const save = useAction(async () => {
		const name = value.trim();
		if (name && name !== initial) await onSave(name);
		onDone();
	});
	return (
		<div className="session-row session-row-editing">
			<span className="session-icon" aria-hidden="true">
				{icon}
			</span>
			<input
				ref={input}
				className="row-input"
				value={value}
				maxLength={60}
				aria-label={t("rename")}
				aria-invalid={save.error ? "true" : undefined}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						cancelled.current = true;
						onDone();
					}
					if (event.key === "Enter" && !event.nativeEvent.isComposing) {
						event.preventDefault();
						void save.run();
					}
				}}
				onBlur={() => {
					if (!cancelled.current && !save.busy) void save.run();
				}}
			/>
			{save.error !== null && save.error !== undefined && (
				<span className="field-error row-error" role="alert">
					{describeError(save.error)}
				</span>
			)}
		</div>
	);
}

/** A saved workspace: click to start a session there, double-click or the menu to rename. */
function WorkspaceRow({ workspace, all }: { workspace: Workspace; all: Workspace[] }) {
	useLang();
	const [renaming, setRenaming] = useState(false);
	return (
		<div className="session-item">
			{renaming ? (
				<InlineRename
					icon={<FolderIcon />}
					value={workspace.name}
					onSave={(name) =>
						saveSettings({
							workspaces: all.map((w) => (w.id === workspace.id ? { ...w, name } : w)),
						})
					}
					onDone={() => setRenaming(false)}
				/>
			) : (
				<button
					type="button"
					className="session-row"
					title={workspace.path}
					onClick={() => {
						closeDrawer();
						setState({ homeFolder: workspace.path });
						void selectSession(null);
					}}
					onDoubleClick={() => setRenaming(true)}
				>
					<span className="session-icon" aria-hidden="true">
						<FolderIcon />
					</span>
					<span className="session-name">
						{workspace.name}
						<span className="visually-hidden"> · {shortPath(workspace.path)}</span>
					</span>
				</button>
			)}
			{!renaming && (
				<span className="session-row-menu">
					<Menu
						label={`${workspace.name} – ${t("more")}`}
						items={[
							{ label: t("rename"), onSelect: () => setRenaming(true) },
							{
								label: t("removeFromList"),
								onSelect: () =>
									void saveSettings({ workspaces: all.filter((w) => w.id !== workspace.id) }),
							},
						]}
					/>
				</span>
			)}
		</div>
	);
}

/** Workspaces first in the sidebar, as Claude lists projects above recent work. */
function Workspaces() {
	useLang();
	const workspaces = useWorkspaces();
	const [creating, setCreating] = useState(false);
	return (
		<section aria-label={t("workspaces")}>
			<div className="group-heading">
				<span>{t("workspaces")}</span>
				<Button
					variant="icon"
					className="heading-add"
					aria-label={t("newWorkspace")}
					title={t("newWorkspace")}
					onClick={() => setCreating(true)}
				>
					<PlusIcon />
				</Button>
			</div>
			{workspaces.length === 0 ? (
				<p className="empty-box">{t("noWorkspaces")}</p>
			) : (
				workspaces.map((workspace) => (
					<WorkspaceRow key={workspace.id} workspace={workspace} all={workspaces} />
				))
			)}
			{creating && (
				<WorkspaceDialog
					onClose={() => setCreating(false)}
					onCreated={(path) => {
						closeDrawer();
						setState({ homeFolder: path });
						void selectSession(null);
					}}
				/>
			)}
		</section>
	);
}

function SessionRow({
	session,
	selected,
	groups,
	now,
	depth = 0,
}: {
	session: Session;
	selected: boolean;
	groups: Group[];
	now: number;
	/** Sessions opened by another are listed under it, indented (blueprint section 8). */
	depth?: number;
}) {
	useLang();
	const isMain = useAppState((state) => state.settings?.mainSessionId === session.id);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const download = useAction(() => exportSession(session));
	const moves = [
		...groups
			.filter((group) => group.id !== session.groupId)
			.map((group) => ({
				label: t("moveTo", { name: group.name }),
				onSelect: () => void updateSession(session.id, { groupId: group.id }),
			})),
		...(session.groupId
			? [
					{
						label: t("removeFromGroup"),
						onSelect: () => void updateSession(session.id, { groupId: null }),
					},
				]
			: []),
	];
	return (
		<div
			className="session-item"
			style={depth > 0 ? ({ "--depth": Math.min(depth, 3) } as React.CSSProperties) : undefined}
			data-child={depth > 0 ? "true" : undefined}
		>
			{renaming ? (
				<InlineRename
					icon={session.cwd ? <CodeIcon /> : <ChatIcon />}
					value={session.name}
					onSave={(name) => updateSession(session.id, { name })}
					onDone={() => setRenaming(false)}
				/>
			) : (
				<button
					type="button"
					className="session-row"
					aria-current={selected ? "true" : undefined}
					onClick={() => {
						closeDrawer();
						void selectSession(session.id);
					}}
					onDoubleClick={() => setRenaming(true)}
				>
					{/* Chat or code (with a workspace). */}
					<span className="session-icon" aria-hidden="true">
						{session.cwd ? <CodeIcon /> : <ChatIcon />}
					</span>
					<span className="session-name">
						{session.name}
						<span className="visually-hidden">
							{" "}
							· {session.cwd ? t("mode_code") : t("mode_chat")} · {t(`status_${session.status}`)}
							{isMain ? ` · ${t("mainConversation")}` : ""}
							{session.pinned ? ` · ${t("pinned")}` : ""}
							{session.unread > 0 ? ` · ${t("unread", { n: session.unread })}` : ""}
						</span>
					</span>
					{session.pinned && <PinIcon />}
					{/* On the right: unread count, else a small status dot while it is busy, else the time. */}
					{session.unread > 0 ? (
						<span className="badge" aria-hidden="true">
							{session.unread}
						</span>
					) : session.status !== "idle" ? (
						<span className={`dot row-dot dot-${session.status}`} aria-hidden="true" />
					) : (
						<span className="session-time" aria-hidden="true">
							{formatAgo(session.lastActivityAt, now)}
						</span>
					)}
				</button>
			)}
			{/* While renaming, the field takes the whole row and the menu steps aside. */}
			{!renaming && (
				<span className="session-row-menu">
					<Menu
						label={`${session.name} – ${t("more")}`}
						items={[
							{
								label: session.pinned ? t("unpin") : t("pin"),
								onSelect: () => void updateSession(session.id, { pinned: !session.pinned }),
							},
							{ label: t("rename"), onSelect: () => setRenaming(true) },
							...(session.archivedAt === null
								? [
										{
											label: isMain ? t("unsetMain") : t("setMain"),
											onSelect: () => void setMainSession(isMain ? null : session.id),
										},
									]
								: []),
							{ label: t("sessionSettings"), onSelect: () => setSettingsOpen(true) },
							{ label: t("exportMarkdown"), onSelect: () => void download.run() },
							...moves,
							session.archivedAt
								? {
										label: t("unarchive"),
										onSelect: () => void updateSession(session.id, { archived: false }),
									}
								: {
										label: t("archive"),
										onSelect: () => void updateSession(session.id, { archived: true }),
									},
						]}
					/>
				</span>
			)}
			{settingsOpen && (
				<SessionSettingsDialog session={session} onClose={() => setSettingsOpen(false)} />
			)}
			{download.busy && (
				<p className="hint row-error" role="status">
					{t("exporting")}
				</p>
			)}
			{download.error !== null && (
				<div className="row-error">
					<ErrorBox error={download.error} />
				</div>
			)}
		</div>
	);
}

/** Pinned first, then the most recently active. */
function sortSessions(list: Session[]): Session[] {
	return [...list].sort(
		(a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt - a.lastActivityAt,
	);
}

/**
 * A list with each session's children right under it, oldest child first, so a task stays next to the
 * session that handed it out. A child whose parent is not in the list stands on its own.
 */
function nest(list: Session[]): { session: Session; depth: number }[] {
	const ids = new Set(list.map((session) => session.id));
	const children = new Map<string, Session[]>();
	for (const session of list) {
		if (session.parentId && ids.has(session.parentId)) {
			children.set(session.parentId, [...(children.get(session.parentId) ?? []), session]);
		}
	}
	const out: { session: Session; depth: number }[] = [];
	const visit = (session: Session, depth: number) => {
		out.push({ session, depth });
		const kids = (children.get(session.id) ?? []).sort((a, b) => a.createdAt - b.createdAt);
		for (const child of kids) visit(child, depth + 1);
	};
	for (const session of list) {
		if (!session.parentId || !ids.has(session.parentId)) visit(session, 0);
	}
	return out;
}

/** The two fixed entries at the top: the main conversation and the approval center (M2 plan, 10). */
function FixedEntries() {
	useLang();
	const mainId = useAppState((state) => state.settings?.mainSessionId ?? null);
	const mainName = useAppState((state) => (mainId ? (state.sessions[mainId]?.name ?? null) : null));
	const selected = useAppState((state) => (state.page ? null : state.selectedId));
	const count = useAppState((state) => centerCount(state.center));
	const open = useAppState((state) => state.page === "center");
	return (
		<>
			{mainId && mainName && (
				<button
					type="button"
					className="nav-row"
					aria-current={selected === mainId ? "page" : undefined}
					onClick={() => {
						closeDrawer();
						void selectSession(mainId);
					}}
				>
					<MainIcon />
					<span className="nav-label">{t("mainConversation")}</span>
					<span className="nav-detail">{mainName}</span>
				</button>
			)}
			<button
				type="button"
				className="nav-row"
				aria-current={open ? "page" : undefined}
				onClick={() => openCenter("pending")}
			>
				<CenterIcon />
				<span className="nav-label">{t("approvalCenter")}</span>
				{count > 0 && (
					<>
						<span className="badge" aria-hidden="true">
							{count}
						</span>
						<span className="visually-hidden">{t("approvalCount", { n: count })}</span>
					</>
				)}
			</button>
		</>
	);
}

function Search() {
	useLang();
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<SearchResult | null>(null);
	const sessions = useAppState((state) => state.sessions);
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const q = query.trim();
		if (!q) {
			setResult(null);
			return;
		}
		const timer = setTimeout(() => {
			void api<SearchResult>("GET", `/api/search?q=${encodeURIComponent(q)}&limit=20`).then(
				setResult,
				() => setResult(null),
			);
		}, 200);
		return () => clearTimeout(timer);
	}, [query]);
	useEffect(() => {
		const onDown = (event: MouseEvent) => {
			if (!box.current?.contains(event.target as Node)) setResult(null);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, []);
	const open = (id: string) => {
		setQuery("");
		setResult(null);
		closeDrawer();
		void selectSession(id);
	};
	return (
		<div className="sidebar-search" ref={box}>
			<div className="search-field">
				<SearchIcon />
				<input
					className="input"
					type="search"
					placeholder={t("search")}
					aria-label={t("search")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => event.key === "Escape" && setQuery("")}
				/>
			</div>
			{result && (
				<section className="search-results" aria-label={t("searchResults")}>
					{result.sessions.length === 0 && result.hits.length === 0 && (
						<p className="hint">{t("noResults")}</p>
					)}
					{result.sessions.map((session) => (
						<button
							key={session.id}
							type="button"
							className="search-hit"
							onClick={() => open(session.id)}
						>
							<strong>{session.name}</strong>
						</button>
					))}
					{result.hits.map((hit) => (
						<button
							key={hit.entryId}
							type="button"
							className="search-hit"
							onClick={() => open(hit.sessionId)}
						>
							<span className="hint">{sessions[hit.sessionId]?.name ?? ""}</span>
							<br />
							<Snippet text={hit.snippet} />
						</button>
					))}
				</section>
			)}
		</div>
	);
}

/**
 * The folded sidebar on wide screens, as in ChatGPT and Yew: Jig's graphic on top (it turns into the
 * open button under the pointer), then the main actions as icons, settings at the bottom (spec 1.6:
 * a collapsed navigation shows the product graphic only).
 */
export function SidebarRail() {
	useLang();
	const [creatingGroup, setCreatingGroup] = useState(false);
	const mainId = useAppState((state) => state.settings?.mainSessionId ?? null);
	const hasMain = useAppState((state) => (mainId ? Boolean(state.sessions[mainId]) : false));
	const count = useAppState((state) => centerCount(state.center));
	const onCenter = useAppState((state) => state.page === "center");
	return (
		<nav className="rail" aria-label={t("sessions")}>
			<button
				type="button"
				className="rail-brand"
				aria-label={t("expandSidebar")}
				title={t("expandSidebar")}
				onClick={() => setSidebarCollapsed(false)}
			>
				<span className="rail-mark">
					<JigMark size={22} />
				</span>
				<span className="rail-open">
					<ExpandIcon />
				</span>
			</button>
			{mainId && hasMain && (
				<Button
					variant="icon"
					aria-label={t("mainConversation")}
					title={t("mainConversation")}
					onClick={() => void selectSession(mainId)}
				>
					<MainIcon />
				</Button>
			)}
			<Button
				variant="icon"
				className="rail-center"
				aria-label={
					count > 0
						? `${t("approvalCenter")} · ${t("approvalCount", { n: count })}`
						: t("approvalCenter")
				}
				title={t("approvalCenter")}
				aria-current={onCenter ? "page" : undefined}
				onClick={() => openCenter("pending")}
			>
				<CenterIcon />
				{count > 0 && (
					<span className="rail-badge" aria-hidden="true">
						{count}
					</span>
				)}
			</Button>
			<Button
				variant="icon"
				aria-label={t("newSession")}
				title={t("newSession")}
				onClick={() => void selectSession(null)}
			>
				<ComposeIcon />
			</Button>
			<Button
				variant="icon"
				aria-label={t("newGroup")}
				title={t("newGroup")}
				onClick={() => setCreatingGroup(true)}
			>
				<GroupPlusIcon />
			</Button>
			<Button
				variant="icon"
				aria-label={t("search")}
				title={t("search")}
				onClick={() => {
					setSidebarCollapsed(false);
					requestAnimationFrame(() =>
						document.querySelector<HTMLInputElement>(".sidebar-search input")?.focus(),
					);
				}}
			>
				<SearchIcon />
			</Button>
			<span className="rail-spacer" />
			<SettingsMenu variant="icon" />
			{creatingGroup && <GroupDialog onClose={() => setCreatingGroup(false)} />}
		</nav>
	);
}

export function Sidebar() {
	useLang();
	const narrow = useNarrow();
	const sessions = useAppState((state) => state.sessions);
	const groups = useAppState((state) => state.groups);
	// On the approval center page no session is the current one.
	const selectedId = useAppState((state) => (state.page ? null : state.selectedId));
	const showArchived = useAppState((state) => state.showArchived);
	const hasArchived = useAppState((state) => state.hasArchived);
	const now = useNow();
	const [dialog, setDialog] = useState<
		| { kind: "session"; groupId: string | null }
		| { kind: "group"; group?: Group }
		| { kind: "deleteGroup"; group: Group }
		| null
	>(null);

	const all = Object.values(sessions);
	const active = all.filter((s) => s.archivedAt === null);
	const archived = sortSessions(all.filter((s) => s.archivedAt !== null));
	const byGroup = (groupId: string | null) =>
		sortSessions(active.filter((s) => s.groupId === groupId));
	const current = selectedId;
	const row = (session: Session, depth = 0) => (
		<SessionRow
			key={session.id}
			session={session}
			selected={session.id === current}
			groups={groups}
			now={now}
			depth={depth}
		/>
	);
	const rows = (list: Session[]) => nest(list).map(({ session, depth }) => row(session, depth));

	return (
		<nav className="sidebar" aria-label={t("sessions")}>
			<div className="sidebar-top">
				{/* The expanded sidebar carries the full lockup (spec 1.6); its name includes Tenon (1.7). */}
				<button
					type="button"
					className="lockup lockup-button"
					aria-label={`${t("lockupName")}，${t("goHome")}`}
					title={t("goHome")}
					onClick={() => {
						closeDrawer();
						void selectSession(null);
					}}
				>
					<JigMark className="lockup-mark" size={22} />
					<span className="lockup-word">
						<span className="wordmark">Jig</span>
						<img
							className="lockup-tenon"
							src="/icons/tenon-mark.svg"
							alt=""
							width={14}
							height={14}
						/>
					</span>
				</button>
				{narrow ? (
					<Button
						variant="icon"
						aria-label={t("closeSidebar")}
						title={t("closeSidebar")}
						onClick={closeDrawer}
					>
						<CloseIcon />
					</Button>
				) : (
					<Button
						variant="icon"
						aria-label={t("collapseSidebar")}
						title={t("collapseSidebar")}
						onClick={() => setSidebarCollapsed(true)}
					>
						<CollapseIcon />
					</Button>
				)}
			</div>
			<div className="sidebar-nav">
				<FixedEntries />
				<button type="button" className="nav-row" onClick={() => setDialog({ kind: "group" })}>
					<GroupPlusIcon />
					{t("newGroup")}
				</button>
				<Search />
			</div>
			<div className="sidebar-list">
				<Workspaces />
				{groups.map((group) => (
					<section key={group.id} aria-label={group.name}>
						<div className="group-heading">
							<span>{group.name}</span>
							<Menu
								label={`${group.name} – ${t("more")}`}
								items={[
									{
										label: t("newSession"),
										onSelect: () => setDialog({ kind: "session", groupId: group.id }),
									},
									{ label: t("renameGroup"), onSelect: () => setDialog({ kind: "group", group }) },
									{
										label: t("deleteGroup"),
										danger: true,
										onSelect: () => setDialog({ kind: "deleteGroup", group }),
									},
								]}
							/>
						</div>
						{byGroup(group.id).length === 0 ? (
							<p className="empty-box">{t("emptyGroup")}</p>
						) : (
							rows(byGroup(group.id))
						)}
					</section>
				))}
				{(byGroup(null).length > 0 || groups.length === 0) && (
					<section aria-label={groups.length > 0 ? t("ungrouped") : t("sessions")}>
						<div className="group-heading">
							<span>{groups.length > 0 ? t("ungrouped") : t("sessions")}</span>
							<Button
								variant="icon"
								className="heading-add"
								aria-label={t("newSession")}
								title={t("newSession")}
								onClick={() => {
									closeDrawer();
									void selectSession(null);
								}}
							>
								<PlusIcon />
							</Button>
						</div>
						{byGroup(null).length === 0 ? (
							<p className="empty-box">{t("emptySidebar")}</p>
						) : (
							rows(byGroup(null))
						)}
					</section>
				)}
				{hasArchived && (
					<>
						<Button
							variant="ghost"
							className="archived-toggle"
							onClick={() => void toggleArchived(!showArchived)}
						>
							{showArchived ? t("hideArchived") : t("showArchived")}
						</Button>
						{showArchived && archived.map((session) => row(session))}
					</>
				)}
			</div>
			<div className="sidebar-bottom">
				<SettingsMenu variant="row" />
			</div>
			{dialog?.kind === "session" && (
				<NewSessionDialog groupId={dialog.groupId} onClose={() => setDialog(null)} />
			)}
			{dialog?.kind === "group" && (
				<GroupDialog
					{...(dialog.group ? { group: dialog.group } : {})}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog?.kind === "deleteGroup" && (
				<ConfirmDialog
					title={t("deleteGroup")}
					body={t("deleteGroupBody")}
					confirmLabel={t("delete")}
					onConfirm={() => deleteGroup(dialog.group.id)}
					onClose={() => setDialog(null)}
				/>
			)}
		</nav>
	);
}
