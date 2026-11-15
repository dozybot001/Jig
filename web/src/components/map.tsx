import { useEffect, useId, useState } from "react";
import type { Group, LetterFlow, Session } from "../../../src/shared/types.ts";
import { loadMap, selectSession } from "../actions.ts";
import { t, useLang } from "../i18n.ts";
import {
	flowPath,
	HEAD_H,
	layoutMap,
	type MapNode,
	NODE_H,
	NODE_W,
	type OutlineItem,
	openedPath,
	outline,
	pickFlows,
} from "../map-layout.ts";
import { blockedSessions } from "../progress.ts";
import { useAppState } from "../state.ts";
import { ChatIcon, CodeIcon } from "./icons.tsx";
import { SidebarToggle } from "./session.tsx";
import { Button, ErrorBox } from "./ui.tsx";

/** The picture draws letter lines for this many pairs; the list under it names them all. */
const FLOW_LIMIT = 16;

/** The statuses a dot stands for, in the order the caption explains them. */
const DOTS = ["working", "waiting", "error", "needs_review"] as const;

/** What a session shows as its status: its own, or "waiting for you" while a card of its own waits. */
function shownStatus(session: Session, blocked: ReadonlySet<string>): Session["status"] {
	return session.status === "idle" && blocked.has(session.id) ? "waiting" : session.status;
}

/** A session in words: its name, then team, kind, status, the main conversation and who opened it. */
function useDescribe(sessions: Record<string, Session>, groups: Group[], mainId: string | null) {
	const blocked = useAppState((state) => state.center);
	const waiting = blockedSessions(Object.values(blocked.approvals), Object.values(blocked.cards));
	const facts = (session: Session): string[] => {
		const team = groups.find((group) => group.id === session.groupId)?.name;
		const opener = session.parentId ? sessions[session.parentId] : undefined;
		return [
			...(session.id === mainId ? [t("mainConversation")] : []),
			team ?? t("mapColumn_none"),
			session.cwd ? t("mode_code") : t("mode_chat"),
			t(`status_${shownStatus(session, waiting)}`),
			...(opener && opener.archivedAt === null ? [t("openedBy", { name: opener.name })] : []),
		];
	};
	return { facts, waiting };
}

function OutlineList({
	items,
	sessions,
	facts,
	label,
}: {
	items: OutlineItem[];
	sessions: Record<string, Session>;
	facts: (session: Session) => string[];
	label?: string;
}) {
	return (
		<ul className="map-list" aria-label={label}>
			{items.map((item) => {
				const session = sessions[item.id];
				if (!session) return null;
				return (
					<li key={item.id}>
						<button
							type="button"
							className="link-button"
							onClick={() => void selectSession(session.id)}
						>
							{session.name}
						</button>
						<span className="hint">
							{t("hintSeparator")}
							{facts(session).join(t("hintSeparator"))}
						</span>
						{item.children.length > 0 && (
							<OutlineList items={item.children} sessions={sessions} facts={facts} />
						)}
					</li>
				);
			})}
		</ul>
	);
}

/**
 * All sessions in one picture (blueprint 6.9, item 26): who opened whom, where the letters of the last
 * 24 hours went, and what each session is doing. A page of its own, like usage. The lines are a
 * picture; every session on it is a button, and the list under it says the same in words.
 */
export function MapPage() {
	useLang();
	const all = useAppState((state) => state.sessions);
	const groups = useAppState((state) => state.groups);
	const mainId = useAppState((state) => state.settings?.mainSessionId ?? null);
	// Every letter that is sent or changes state moves this, and the lines are read again.
	const tick = useAppState((state) => state.letterTick);
	const [flows, setFlows] = useState<LetterFlow[] | null>(null);
	const [error, setError] = useState<unknown>(null);
	const [tries, setTries] = useState(0);
	// The session under the pointer or with the focus: its letter lines stay, the others fade.
	const [active, setActive] = useState<string | null>(null);
	const marker = useId();
	const lettersHeading = useId();
	const { facts, waiting } = useDescribe(all, groups, mainId);
	const live = Object.values(all).filter((session) => session.archivedAt === null);
	// A session that is archived or restored takes its letters off the map or brings them back.
	const count = live.length;

	// biome-ignore lint/correctness/useExhaustiveDependencies: tick, count and tries are what make it read again
	useEffect(() => {
		let current = true;
		loadMap()
			.then((result) => {
				if (!current) return;
				setFlows(result.letters);
				setError(null);
			})
			.catch((failure) => current && setError(failure));
		return () => {
			current = false;
		};
	}, [tick, count, tries]);

	const layout = layoutMap(live, groups, mainId);
	const at = new Map(layout.nodes.map((node) => [node.id, node]));
	const onMap = new Set(at.keys());
	const { drawn, hidden } = pickFlows(flows ?? [], onMap, FLOW_LIMIT);
	const listed = (flows ?? []).filter((flow) => onMap.has(flow.from) && onMap.has(flow.to));
	const between = (flow: LetterFlow): [MapNode, MapNode] | null => {
		const from = at.get(flow.from);
		const to = at.get(flow.to);
		return from && to ? [from, to] : null;
	};
	return (
		<main className="main center-main">
			<header className="session-header">
				<SidebarToggle />
				<div className="session-title">
					<h1>{t("map")}</h1>
				</div>
			</header>
			<div
				className="center-body"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area must be reachable by keyboard (spec 18.6)
				tabIndex={0}
			>
				<div className="map-page">
					{error ? (
						<>
							<ErrorBox error={error} />
							<div>
								<Button onClick={() => setTries((n) => n + 1)}>{t("retry")}</Button>
							</div>
						</>
					) : null}
					{live.length === 0 ? (
						<p className="empty-box">{t("mapEmpty")}</p>
					) : (
						<>
							<div className="map-caption">
								<p className="hint">
									{t("mapCaption")}
									{hidden > 0 ? ` ${t("mapCapped", { n: FLOW_LIMIT, m: hidden })}` : ""}
								</p>
								<ul className="map-legend hint">
									{DOTS.map((status) => (
										<li key={status}>
											<span className={`dot row-dot dot-${status}`} aria-hidden="true" />
											{t(`status_${status}`)}
										</li>
									))}
								</ul>
							</div>
							{/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and a legend; the group only names the scroll area */}
							<div
								className="map-scroll"
								role="group"
								aria-label={t("mapPicture")}
								// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area must be reachable by keyboard (spec 18.6)
								tabIndex={0}
							>
								<div className="map-canvas" style={{ width: layout.width, height: layout.height }}>
									<svg
										className="map-lines"
										width={layout.width}
										height={layout.height}
										aria-hidden="true"
									>
										<defs>
											<marker
												id={marker}
												markerWidth="7"
												markerHeight="7"
												refX="6.5"
												refY="3.5"
												orient="auto"
												markerUnits="userSpaceOnUse"
											>
												<path className="map-arrow" d="M0 0.5L7 3.5L0 6.5Z" />
											</marker>
										</defs>
										{layout.nodes.map((node) => {
											const parent = node.parentId ? at.get(node.parentId) : undefined;
											return parent ? (
												<path key={node.id} className="map-opened" d={openedPath(parent, node)} />
											) : null;
										})}
										{drawn.map((flow) => {
											const ends = between(flow);
											if (!ends) return null;
											const path = flowPath(ends[0], ends[1], layout.nodes);
											const faded = active !== null && flow.from !== active && flow.to !== active;
											return (
												<g
													key={`${flow.from}>${flow.to}`}
													className={faded ? "map-faded" : undefined}
												>
													<path className="map-flow" d={path.d} markerEnd={`url(#${marker})`} />
													{flow.count > 1 && (
														<text
															className="chart-tick map-flow-count"
															x={path.labelX}
															y={path.labelY + 4}
															textAnchor="middle"
														>
															{flow.count}
														</text>
													)}
												</g>
											);
										})}
									</svg>
									{layout.columns.map((column) => (
										<span
											key={`${column.kind}:${column.groupId ?? ""}`}
											className="map-head"
											style={{ left: column.x, top: column.y, width: column.width, height: HEAD_H }}
										>
											{column.kind === "team"
												? (groups.find((group) => group.id === column.groupId)?.name ?? "")
												: t(`mapColumn_${column.kind}`)}
										</span>
									))}
									{layout.nodes.map((node) => {
										const session = all[node.id];
										if (!session) return null;
										const status = shownStatus(session, waiting);
										const words = [session.name, ...facts(session)].join(t("hintSeparator"));
										return (
											<button
												key={node.id}
												type="button"
												className="map-node"
												data-main={session.id === mainId ? "true" : undefined}
												style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
												aria-label={words}
												title={words}
												onClick={() => void selectSession(session.id)}
												onPointerEnter={() => setActive(session.id)}
												onPointerLeave={() => setActive(null)}
												onFocus={() => setActive(session.id)}
												onBlur={() => setActive(null)}
											>
												<span className="session-icon" aria-hidden="true">
													{session.cwd ? <CodeIcon /> : <ChatIcon />}
												</span>
												<span className="map-node-name">{session.name}</span>
												{status !== "idle" && (
													<span className={`dot row-dot dot-${status}`} aria-hidden="true" />
												)}
											</button>
										);
									})}
								</div>
							</div>
							<details className="map-outline">
								<summary>{t("mapOutline")}</summary>
								<h2>{t("mapOutlineSessions")}</h2>
								<OutlineList
									items={outline(live, mainId)}
									sessions={all}
									facts={facts}
									label={t("mapOutlineSessions")}
								/>
								<h2 id={lettersHeading}>{t("mapOutlineLetters")}</h2>
								{listed.length === 0 ? (
									<p className="hint">{flows ? t("mapNoLetters") : t("loading")}</p>
								) : (
									<ul className="map-list" aria-labelledby={lettersHeading}>
										{listed.map((flow) => (
											<li key={`${flow.from}>${flow.to}`}>
												{t("mapFlow", {
													from: all[flow.from]?.name ?? "",
													to: all[flow.to]?.name ?? "",
													n: flow.count,
												})}
											</li>
										))}
									</ul>
								)}
							</details>
						</>
					)}
				</div>
			</div>
		</main>
	);
}
