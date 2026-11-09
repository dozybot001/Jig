import { useEffect, useId, useRef, useState } from "react";
import type { Approval, Card, Letter } from "../../../src/shared/types.ts";
import {
	closePanel,
	decideCard,
	loadLetters,
	openPanel,
	refuseLetter,
	releaseLetter,
	selectSession,
} from "../actions.ts";
import { formatAgo, type MessageKey, t, useLang } from "../i18n.ts";
import { centerCount, useAppState } from "../state.ts";
import { Markdown } from "./content.tsx";
import { CloseIcon, DecisionIcon, MailIcon } from "./icons.tsx";
import { PermissionCard, QuestionCard } from "./transcript.tsx";
import { Button, ErrorBox, useAction } from "./ui.tsx";

/** A session's current name; letters and cards keep ids, so a renamed session shows its new name. */
function useSessionName(id: string | null): string | null {
	return useAppState((state) => (id ? (state.sessions[id]?.name ?? null) : null));
}

function SessionLink({ id, fallback }: { id: string | null; fallback?: string }) {
	const name = useSessionName(id);
	if (!id || !name) return <span>{fallback ?? ""}</span>;
	return (
		<button
			type="button"
			className="link-button"
			onClick={() => {
				closePanel();
				void selectSession(id);
			}}
		>
			{name}
		</button>
	);
}

function SenderLink({ letter }: { letter: Letter }) {
	useLang();
	if (letter.fromKind === "cli") return <span>{t("fromCli")}</span>;
	if (letter.fromKind === "person") return <span>{t("you")}</span>;
	return <SessionLink id={letter.fromSession} fallback={letter.fromName} />;
}

/** Cards with a deadline first, by deadline; then the oldest first. */
function byDeadline(a: Card, b: Card): number {
	if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline) || a.number - b.number;
	if (a.deadline) return -1;
	if (b.deadline) return 1;
	return a.number - b.number;
}

/**
 * A decision card (blueprint 6.4): the six points, the options with the recommended one chosen, and a
 * note. Sending records the decision as the person's and returns it to the sessions that asked.
 */
function DecisionCard({ card }: { card: Card }) {
	useLang();
	const [choice, setChoice] = useState<number | null>(card.recommended);
	const [note, setNote] = useState("");
	const names = useAppState((state) => state.sessions);
	const titleId = useId();
	const noteId = useId();
	const send = useAction(() => decideCard(card.id, choice, note.trim() || null));
	const hasOptions = card.options.length > 0;
	const ready = choice !== null || note.trim().length > 0;
	const involved = card.sessions
		.map((id) => names[id]?.name)
		.filter((name): name is string => Boolean(name));
	return (
		<section className="card decision-card" aria-labelledby={titleId}>
			<div className="decision-meta">
				<span>#{card.number}</span>
				{card.requestedBy && (
					<span>{t("cardFrom", { name: names[card.requestedBy]?.name ?? "" })}</span>
				)}
				{card.createdBy && card.createdBy !== card.requestedBy && (
					<span>{t("cardPostedBy", { name: names[card.createdBy]?.name ?? "" })}</span>
				)}
				{card.deadline && (
					<span className="decision-deadline">{t("cardDeadline", { d: card.deadline })}</span>
				)}
			</div>
			<h3 id={titleId}>{card.title}</h3>
			{card.context && (
				<div className="decision-context">
					<Markdown text={card.context} />
				</div>
			)}
			{hasOptions && (
				<fieldset className="decision-options">
					<legend className="visually-hidden">{t("cardOptions")}</legend>
					{card.options.map((option, index) => (
						<label
							// biome-ignore lint/suspicious/noArrayIndexKey: a card's options never change order, and labels may repeat
							key={index}
							className="decision-option"
							data-checked={choice === index ? "true" : undefined}
						>
							<input
								type="radio"
								className="visually-hidden"
								name={`card-${card.id}`}
								checked={choice === index}
								onChange={() => setChoice(index)}
							/>
							<span className="decision-radio" aria-hidden="true" />
							<span className="decision-option-text">
								<span className="decision-option-label">
									{option.label}
									{index === card.recommended && <span className="tag">{t("recommended")}</span>}
								</span>
								{option.detail && <span className="hint">{option.detail}</span>}
							</span>
						</label>
					))}
				</fieldset>
			)}
			<dl className="decision-facts">
				<div>
					<dt>{t("cardReversible")}</dt>
					<dd>{card.reversible}</dd>
				</div>
				<div>
					<dt>{t("cardAfter")}</dt>
					<dd>{card.after}</dd>
				</div>
				{involved.length > 0 && (
					<div>
						<dt>{t("cardInvolves")}</dt>
						<dd>{involved.join(t("listSeparator"))}</dd>
					</div>
				)}
			</dl>
			<label className="visually-hidden" htmlFor={noteId}>
				{t("cardNote")}
			</label>
			<textarea
				id={noteId}
				className="textarea"
				rows={1}
				placeholder={hasOptions ? t("notePlaceholder") : t("answerRequired")}
				value={note}
				onChange={(event) => setNote(event.target.value)}
			/>
			<div className="request-actions">
				<Button
					variant="primary"
					busy={send.busy}
					disabled={!ready}
					onClick={() => void send.run()}
				>
					{t("send")}
				</Button>
			</div>
			<ErrorBox error={send.error} />
		</section>
	);
}

/** A letter held for the person: who wrote to whom, why it waits, and release or refuse. */
function HeldLetter({ letter }: { letter: Letter }) {
	useLang();
	const release = useAction(() => releaseLetter(letter.id));
	const refuse = useAction(() => refuseLetter(letter.id));
	return (
		<section className="card request-card" aria-label={letter.summary}>
			<div className="request-head">
				<MailIcon />
				<h3>
					<SenderLink letter={letter} /> → <SessionLink id={letter.toSession} />
				</h3>
			</div>
			<p className="letter-summary">{letter.summary}</p>
			{letter.body && <div className="letter-body">{letter.body}</div>}
			<p className="hint">
				{t(`letterReason_${letter.statusReason ?? "hold-policy"}` as MessageKey)}
			</p>
			<div className="request-actions">
				<Button variant="primary" busy={release.busy} onClick={() => void release.run()}>
					{t("release")}
				</Button>
				<Button variant="danger" busy={refuse.busy} onClick={() => void refuse.run()}>
					{t("refuse")}
				</Button>
			</div>
			<ErrorBox error={release.error ?? refuse.error} />
		</section>
	);
}

/** An approval or question from any session, with a link to the session it stops. */
function PendingApproval({ approval }: { approval: Approval }) {
	return (
		<div className="center-item">
			<SessionLink id={approval.sessionId} />
			{approval.kind === "permission" ? (
				<PermissionCard approval={approval} />
			) : (
				<QuestionCard approval={approval} />
			)}
		</div>
	);
}

function RecentDecision({ card }: { card: Card }) {
	useLang();
	const now = Date.now();
	const chosen = card.choice === null ? null : card.options[card.choice]?.label;
	return (
		<li className="recent-decision">
			<span className="recent-head">
				<DecisionIcon />#{card.number} {card.title}
			</span>
			<span className="hint">
				{chosen ? t("decidedChoice", { c: chosen }) : t("noteOnly")}
				{card.note ? ` · ${card.note}` : ""} · {t("byYou")} ·{" "}
				{formatAgo(card.decidedAt ?? card.updatedAt, now)}
			</span>
		</li>
	);
}

function CenterList() {
	useLang();
	const center = useAppState((state) => state.center);
	const approvals = Object.values(center.approvals).sort((a, b) => a.createdAt - b.createdAt);
	const cards = Object.values(center.cards).sort(byDeadline);
	const held = Object.values(center.held).sort((a, b) => a.createdAt - b.createdAt);
	return (
		<>
			{approvals.length + cards.length + held.length === 0 && (
				<p className="empty-box">{t("centerEmpty")}</p>
			)}
			{approvals.length > 0 && (
				<section className="center-section" aria-label={t("waitingApprovals")}>
					<h2>{t("waitingApprovals")}</h2>
					{approvals.map((approval) => (
						<PendingApproval key={approval.id} approval={approval} />
					))}
				</section>
			)}
			{cards.length > 0 && (
				<section className="center-section" aria-label={t("decisionsToMake")}>
					<h2>{t("decisionsToMake")}</h2>
					{cards.map((card) => (
						<DecisionCard key={card.id} card={card} />
					))}
				</section>
			)}
			{held.length > 0 && (
				<section className="center-section" aria-label={t("heldLetters")}>
					<h2>{t("heldLetters")}</h2>
					{held.map((letter) => (
						<HeldLetter key={letter.id} letter={letter} />
					))}
				</section>
			)}
			{center.decided.length > 0 && (
				<details className="center-section recent-decisions">
					<summary>
						<h2>{t("recentDecisions")}</h2>
					</summary>
					<ul>
						{center.decided.map((card) => (
							<RecentDecision key={card.id} card={card} />
						))}
					</ul>
				</details>
			)}
		</>
	);
}

function LetterRow({ letter, now }: { letter: Letter; now: number }) {
	useLang();
	const reason =
		letter.statusReason && (letter.status === "refused" || letter.status === "dropped")
			? t(`letterReason_${letter.statusReason}` as MessageKey)
			: null;
	return (
		<li className="letter-row">
			<div className="letter-row-head">
				<span className="letter-route">
					<SenderLink letter={letter} /> → <SessionLink id={letter.toSession} />
				</span>
				<span className="tag">{t(`letterKind_${letter.kind}`)}</span>
				<span className={`letter-status letter-status-${letter.status}`}>
					{t(`letterStatus_${letter.status}`)}
				</span>
				<span className="session-time">{formatAgo(letter.createdAt, now)}</span>
			</div>
			{letter.body ? (
				<details className="letter-details">
					<summary>{letter.summary}</summary>
					<div className="letter-body">{letter.body}</div>
				</details>
			) : (
				<p className="letter-summary">{letter.summary}</p>
			)}
			{reason && <p className="hint">{reason}</p>}
		</li>
	);
}

function LetterList() {
	useLang();
	const letters = useAppState((state) => state.letters);
	const more = useAction(() => loadLetters(true));
	const now = Date.now();
	if (!letters.loaded) return <p className="hint">{t("loading")}</p>;
	if (letters.items.length === 0) return <p className="empty-box">{t("lettersEmpty")}</p>;
	return (
		<>
			<ul className="letter-list">
				{letters.items.map((letter) => (
					<LetterRow key={letter.id} letter={letter} now={now} />
				))}
			</ul>
			{letters.nextCursor && (
				<Button busy={more.busy} onClick={() => void more.run()}>
					{t("loadMore")}
				</Button>
			)}
			<ErrorBox error={more.error} />
		</>
	);
}

/**
 * The right-hand drawer over the conversation (M2 plan, section 10): the approval center and all
 * letters. It does not replace the conversation; Escape or the close button puts it away.
 */
export function SidePanel() {
	useLang();
	const panel = useAppState((state) => state.panel);
	const count = useAppState((state) => centerCount(state.center));
	const titleId = useId();
	const tabs = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!panel) return;
		tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !document.querySelector("dialog[open]")) closePanel();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [panel]);
	if (!panel) return null;
	const tab = (id: "center" | "letters", label: string, badge?: number) => (
		<button
			type="button"
			role="tab"
			className="panel-tab"
			aria-selected={panel === id}
			aria-controls={`${titleId}-body`}
			onClick={() => openPanel(id)}
		>
			{label}
			{badge ? <span className="badge">{badge}</span> : null}
		</button>
	);
	return (
		<aside className="side-panel" aria-labelledby={titleId}>
			<header className="side-panel-head">
				<h2 id={titleId} className="visually-hidden">
					{panel === "center" ? t("approvalCenter") : t("tabLetters")}
				</h2>
				<div className="panel-tabs" role="tablist" ref={tabs}>
					{tab("center", t("tabApprovals"), count)}
					{tab("letters", t("tabLetters"))}
				</div>
				<Button variant="icon" aria-label={t("close")} title={t("close")} onClick={closePanel}>
					<CloseIcon />
				</Button>
			</header>
			<div
				id={`${titleId}-body`}
				className="side-panel-body"
				role="tabpanel"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area must be reachable by keyboard (spec 18.6)
				tabIndex={0}
			>
				{panel === "center" ? <CenterList /> : <LetterList />}
			</div>
		</aside>
	);
}
