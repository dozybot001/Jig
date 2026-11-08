import { useEffect, useRef, useState } from "react";
import type { Group, Session } from "../../../src/shared/types.ts";
import {
	deleteGroup,
	openSettings,
	selectSession,
	toggleArchived,
	updateSession,
} from "../actions.ts";
import { api } from "../api.ts";
import { formatAgo, t, useLang } from "../i18n.ts";
import { useAppState } from "../state.ts";
import { Snippet } from "./content.tsx";
import { ConfirmDialog, GroupDialog, NewSessionDialog, SessionSettingsDialog } from "./dialogs.tsx";
import {
	ChatIcon,
	CodeIcon,
	ComposeIcon,
	FolderPlusIcon,
	GearIcon,
	JigMark,
	PinIcon,
	SearchIcon,
} from "./icons.tsx";
import { Button, describeError, Menu, useAction } from "./ui.tsx";

interface SearchResult {
	sessions: Session[];
	hits: { sessionId: string; entryId: string; seq: number; snippet: string }[];
}

function closeDrawer(): void {
	document.querySelector(".app")?.classList.remove("sidebar-open");
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
 * The session keeps its id, so messages to it still arrive (blueprint 7.1).
 */
function RenameRow({ session, onDone }: { session: Session; onDone: () => void }) {
	useLang();
	const [value, setValue] = useState(session.name);
	const input = useRef<HTMLInputElement>(null);
	// Escape closes the field; the blur that follows must not save what was typed.
	const cancelled = useRef(false);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);
	const save = useAction(async () => {
		const name = value.trim();
		if (name && name !== session.name) await updateSession(session.id, { name });
		onDone();
	});
	return (
		<div className="session-row session-row-editing">
			<span className="session-icon" aria-hidden="true">
				{session.cwd ? <CodeIcon /> : <ChatIcon />}
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

function SessionRow({
	session,
	selected,
	groups,
	now,
}: {
	session: Session;
	selected: boolean;
	groups: Group[];
	now: number;
}) {
	useLang();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
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
		<div className="session-item">
			{renaming ? (
				<RenameRow session={session} onDone={() => setRenaming(false)} />
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
					{/* Chat or code (with a folder), with the status as a dot on the icon's corner. */}
					<span className="session-icon" aria-hidden="true">
						{session.cwd ? <CodeIcon /> : <ChatIcon />}
						<span className={`dot dot-${session.status}`} />
					</span>
					<span className="session-name">
						{session.name}
						<span className="visually-hidden">
							{" "}
							· {session.cwd ? t("mode_code") : t("mode_chat")} · {t(`status_${session.status}`)}
							{session.pinned ? ` · ${t("pinned")}` : ""}
							{session.unread > 0 ? ` · ${t("unread", { n: session.unread })}` : ""}
						</span>
					</span>
					{session.pinned && <PinIcon />}
					{session.unread > 0 ? (
						<span className="badge" aria-hidden="true">
							{session.unread}
						</span>
					) : (
						<span className="session-time" aria-hidden="true">
							{formatAgo(session.lastActivityAt, now)}
						</span>
					)}
				</button>
			)}
			<span className="session-row-menu">
				<Menu
					label={`${session.name} – ${t("more")}`}
					items={[
						{
							label: session.pinned ? t("unpin") : t("pin"),
							onSelect: () => void updateSession(session.id, { pinned: !session.pinned }),
						},
						{ label: t("rename"), onSelect: () => setRenaming(true) },
						{ label: t("sessionSettings"), onSelect: () => setSettingsOpen(true) },
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
			{settingsOpen && (
				<SessionSettingsDialog session={session} onClose={() => setSettingsOpen(false)} />
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

export function Sidebar() {
	useLang();
	const sessions = useAppState((state) => state.sessions);
	const groups = useAppState((state) => state.groups);
	const selectedId = useAppState((state) => state.selectedId);
	const view = useAppState((state) => state.view);
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
	const current = view === "session" ? selectedId : null;
	const row = (session: Session) => (
		<SessionRow
			key={session.id}
			session={session}
			selected={session.id === current}
			groups={groups}
			now={now}
		/>
	);

	return (
		<nav className="sidebar" aria-label={t("sessions")}>
			<div className="sidebar-top">
				{/* The expanded sidebar carries the full lockup (spec 1.6); its name includes Tenon (1.7). */}
				<span className="lockup" role="img" aria-label={t("lockupName")}>
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
				</span>
				<Button
					variant="icon"
					aria-label={t("newGroup")}
					title={t("newGroup")}
					onClick={() => setDialog({ kind: "group" })}
				>
					<FolderPlusIcon />
				</Button>
			</div>
			<div className="sidebar-nav">
				<button
					type="button"
					className="nav-row"
					onClick={() => {
						closeDrawer();
						void selectSession(null);
					}}
				>
					<ComposeIcon />
					{t("newSession")}
				</button>
				<Search />
			</div>
			<div className="sidebar-list">
				{active.length === 0 && <p className="sidebar-empty">{t("emptySidebar")}</p>}
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
						{byGroup(group.id).map(row)}
					</section>
				))}
				{byGroup(null).length > 0 && (
					<section aria-label={groups.length > 0 ? t("ungrouped") : t("sessions")}>
						<div className="group-heading">
							<span>{groups.length > 0 ? t("ungrouped") : t("sessions")}</span>
						</div>
						{byGroup(null).map(row)}
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
						{showArchived && archived.map(row)}
					</>
				)}
			</div>
			<div className="sidebar-bottom">
				<button
					type="button"
					className="nav-row"
					aria-current={view === "settings" ? "page" : undefined}
					onClick={() => {
						closeDrawer();
						openSettings();
					}}
				>
					<GearIcon />
					{t("settings")}
				</button>
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
