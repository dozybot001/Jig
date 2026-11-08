import { useEffect, useRef, useState } from "react";
import type { Group, Session } from "../../../src/shared/types.ts";
import { deleteGroup, selectSession, toggleArchived, updateSession } from "../actions.ts";
import { api } from "../api.ts";
import { t, useLang } from "../i18n.ts";
import { useAppState } from "../state.ts";
import { Snippet } from "./content.tsx";
import { ConfirmDialog, GroupDialog, NewSessionDialog, SettingsDialog } from "./dialogs.tsx";
import { Button, Menu, Select } from "./ui.tsx";

interface SearchResult {
	sessions: Session[];
	hits: { sessionId: string; entryId: string; seq: number; snippet: string }[];
}

function SessionRow({
	session,
	selected,
	groups,
}: {
	session: Session;
	selected: boolean;
	groups: Group[];
}) {
	useLang();
	const [moving, setMoving] = useState(false);
	const statusLabel = t(`status_${session.status}`);
	return (
		<div style={{ position: "relative" }}>
			<button
				type="button"
				className="session-row"
				aria-current={selected ? "true" : undefined}
				onClick={() => {
					document.querySelector(".app")?.classList.remove("sidebar-open");
					void selectSession(session.id);
				}}
			>
				<span className={`dot dot-${session.status}`} aria-hidden="true" />
				<span className="session-name">
					{session.pinned ? "📌 " : ""}
					{session.name}
					<span className="visually-hidden">
						{" "}
						· {statusLabel}
						{session.unread > 0 ? ` · ${t("unread", { n: session.unread })}` : ""}
					</span>
				</span>
				{session.unread > 0 ? (
					<span className="badge" aria-hidden="true">
						{session.unread}
					</span>
				) : (
					<span />
				)}
				<span style={{ width: 32 }} />
			</button>
			<span style={{ position: "absolute", right: 4, top: 3 }}>
				<Menu
					label={`${session.name} – ${t("more")}`}
					items={[
						{
							label: session.pinned ? t("unpin") : t("pin"),
							onSelect: () => void updateSession(session.id, { pinned: !session.pinned }),
						},
						{ label: t("moveToGroup"), onSelect: () => setMoving(true) },
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
			{moving && (
				<div className="field" style={{ padding: "4px 8px" }}>
					<Select
						label={t("moveToGroup")}
						value={session.groupId ?? ""}
						options={[
							{ value: "", label: t("noGroup") },
							...groups.map((g) => ({ value: g.id, label: g.name })),
						]}
						onChange={(value) => {
							setMoving(false);
							void updateSession(session.id, { groupId: value || null });
						}}
					/>
				</div>
			)}
		</div>
	);
}

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
		void selectSession(id);
	};
	return (
		<div className="sidebar-search" ref={box}>
			<input
				className="input"
				type="search"
				placeholder={t("search")}
				aria-label={t("search")}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => event.key === "Escape" && setQuery("")}
			/>
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
	const showArchived = useAppState((state) => state.showArchived);
	const [dialog, setDialog] = useState<
		| { kind: "session"; groupId?: string | null }
		| { kind: "group"; group?: Group }
		| { kind: "deleteGroup"; group: Group }
		| { kind: "settings" }
		| null
	>(null);

	const all = Object.values(sessions);
	const active = all.filter((s) => s.archivedAt === null);
	const archived = sortSessions(all.filter((s) => s.archivedAt !== null));
	const byGroup = (groupId: string | null) =>
		sortSessions(active.filter((s) => s.groupId === groupId));

	return (
		<nav className="sidebar" aria-label={t("sessions")}>
			<div className="sidebar-top">
				<span className="lockup" role="img" aria-label={t("lockupName")}>
					<span className="wordmark">Jig</span>
					<img className="lockup-tenon" src="/icons/tenon-mark.svg" alt="" width={14} height={14} />
				</span>
				<div className="request-actions">
					<Button
						variant="icon"
						aria-label={t("newGroup")}
						title={t("newGroup")}
						onClick={() => setDialog({ kind: "group" })}
					>
						<span aria-hidden="true">▤</span>
					</Button>
					<Button
						variant="icon"
						aria-label={t("newSession")}
						title={t("newSession")}
						onClick={() => setDialog({ kind: "session" })}
					>
						<span aria-hidden="true">＋</span>
					</Button>
				</div>
			</div>
			<Search />
			<div className="sidebar-list">
				{active.length === 0 && (
					<div className="field" style={{ padding: 8 }}>
						<span className="hint">{t("emptySidebar")}</span>
						<Button variant="primary" onClick={() => setDialog({ kind: "session" })}>
							{t("newSession")}
						</Button>
					</div>
				)}
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
						{byGroup(group.id).map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								selected={session.id === selectedId}
								groups={groups}
							/>
						))}
					</section>
				))}
				{byGroup(null).length > 0 && (
					<section aria-label={t("ungrouped")}>
						{groups.length > 0 && (
							<div className="group-heading">
								<span>{t("ungrouped")}</span>
							</div>
						)}
						{byGroup(null).map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								selected={session.id === selectedId}
								groups={groups}
							/>
						))}
					</section>
				)}
				<div className="group-heading">
					<Button variant="ghost" onClick={() => void toggleArchived(!showArchived)}>
						{showArchived ? t("hideArchived") : t("showArchived")}
					</Button>
				</div>
				{showArchived &&
					archived.map((session) => (
						<SessionRow
							key={session.id}
							session={session}
							selected={session.id === selectedId}
							groups={groups}
						/>
					))}
			</div>
			<div className="sidebar-bottom">
				<Button
					variant="ghost"
					onClick={() => setDialog({ kind: "settings" })}
					style={{ width: "100%", justifyContent: "flex-start" }}
				>
					<span aria-hidden="true">⚙</span> {t("settings")}
				</Button>
			</div>
			{dialog?.kind === "session" && (
				<NewSessionDialog groupId={dialog.groupId ?? null} onClose={() => setDialog(null)} />
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
			{dialog?.kind === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
		</nav>
	);
}
