import { useId, useState } from "react";
import { bodyAfterSummary, plainLine } from "../../../src/shared/messages.ts";
import type { Approval, Card, Letter } from "../../../src/shared/types.ts";
import {
	decideCard,
	loadDecisions,
	loadLetters,
	openCenter,
	refuseLetter,
	releaseLetter,
	selectSession,
} from "../actions.ts";
import { formatAgo, type MessageKey, t, useLang } from "../i18n.ts";
import { type CenterTab, centerCount, useAppState } from "../state.ts";
import { Capped, Markdown } from "./content.tsx";
import { ChevronIcon, DecisionIcon, MailIcon } from "./icons.tsx";
import { SidebarToggle } from "./session.tsx";
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
		<button type="button" className="link-button" onClick={() => void selectSession(id)}>
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
				<Capped className="decision-context" label={card.title}>
					<Markdown text={card.context} />
				</Capped>
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
			<p className="letter-summary">{plainLine(letter.summary) || letter.summary}</p>
			{letter.body && (
				<Capped className="letter-body" label={letter.summary}>
					<Markdown text={letter.body} breaks />
				</Capped>
			)}
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

/** One decision in the record: what was asked, what you chose and your note, marked as yours. */
function DecisionRecord({ card, now }: { card: Card; now: number }) {
	useLang();
	const chosen = card.choice === null ? null : card.options[card.choice]?.label;
	return (
		<li className="letter-row decision-record">
			<div className="letter-row-head">
				<span className="recent-head">
					<DecisionIcon />#{card.number}
				</span>
				<span className="tag">{t("byYou")}</span>
				{card.requestedBy && <SessionLink id={card.requestedBy} />}
				<span className="session-time">{formatAgo(card.decidedAt ?? card.updatedAt, now)}</span>
			</div>
			<p className="letter-summary">{card.title}</p>
			<p className="letter-note">
				{chosen ? t("decidedChoice", { c: chosen }) : t("noteOnly")}
				{card.note ? ` · ${card.note}` : ""}
			</p>
		</li>
	);
}

function DecisionList() {
	useLang();
	const decisions = useAppState((state) => state.decisions);
	const more = useAction(() => loadDecisions(true));
	const now = Date.now();
	if (!decisions.loaded) return <p className="hint">{t("loading")}</p>;
	if (decisions.items.length === 0) return <p className="empty-box">{t("decisionsEmpty")}</p>;
	return (
		<>
			<ul className="letter-list">
				{decisions.items.map((card) => (
					<DecisionRecord key={card.id} card={card} now={now} />
				))}
			</ul>
			{decisions.nextCursor && (
				<Button busy={more.busy} onClick={() => void more.run()}>
					{t("loadMore")}
				</Button>
			)}
			<ErrorBox error={more.error} />
		</>
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
		</>
	);
}

/** Who a letter is from, as plain text for the one-line row. */
function useSenderName(letter: Letter): string {
	const name = useSessionName(letter.fromSession);
	if (letter.fromKind === "cli") return t("fromCli");
	if (letter.fromKind === "person") return t("you");
	return name ?? letter.fromName;
}

/**
 * One letter on one line: who wrote to whom, the kind, the summary and when. Only a letter that did not
 * get through (held, refused, dropped) shows its state on the line. Clicking the line unfolds the letter
 * under it, in the same card: the full summary and the body at a fixed height that scrolls inside, then
 * links to both sessions with every state and its reason.
 */
function LetterRow({ letter, now }: { letter: Letter; now: number }) {
	useLang();
	const [open, setOpen] = useState(false);
	const panel = useId();
	const from = useSenderName(letter);
	const to = useSessionName(letter.toSession) ?? "";
	const summary = plainLine(letter.summary) || letter.summary;
	const body = bodyAfterSummary(letter.body, letter.summary);
	const failed = ["held", "refused", "dropped"].includes(letter.status);
	const reason =
		letter.statusReason && failed ? t(`letterReason_${letter.statusReason}` as MessageKey) : null;
	const status = (
		<span className={`letter-status letter-status-${letter.status}`}>
			{t(`letterStatus_${letter.status}`)}
		</span>
	);
	return (
		<li className="letter-item" data-open={open}>
			<button
				type="button"
				className="letter-line"
				aria-expanded={open}
				aria-controls={panel}
				onClick={() => setOpen((value) => !value)}
			>
				<span className="letter-line-route">
					{from} → {to}
				</span>
				<span className="tag">{t(`letterKind_${letter.kind}`)}</span>
				<span className="letter-line-summary">{summary}</span>
				<span className="letter-line-meta">
					{failed && status}
					<span className="session-time">{formatAgo(letter.createdAt, now)}</span>
				</span>
				<ChevronIcon />
			</button>
			{open && (
				<div className="letter-panel" id={panel}>
					<Capped className="letter-content" label={summary}>
						<p className="letter-summary">{summary}</p>
						{body && <Markdown text={body} breaks />}
					</Capped>
					<div className="letter-row-head">
						<span>
							<SenderLink letter={letter} /> → <SessionLink id={letter.toSession} />
						</span>
						{letter.auto && <span>{t("sentByJig")}</span>}
						{status}
						{reason && <span>{reason}</span>}
					</div>
				</div>
			)}
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
			<ul className="letter-list letter-lines">
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

const TABS: CenterTab[] = ["pending", "decided", "letters"];

/**
 * The approval center, a page of its own in place of the session (blueprint section 8). In a session
 * you work on one thing; here you clear what every session is waiting for, then go back.
 */
export function CenterPage() {
	useLang();
	const tab = useAppState((state) => state.centerTab);
	const count = useAppState((state) => centerCount(state.center));
	const id = useId();
	const label: Record<CenterTab, string> = {
		pending: t("tabPending"),
		decided: t("tabDecided"),
		letters: t("tabLetters"),
	};
	// Arrow keys move between tabs, as in any tab list (WAI-ARIA).
	const onKeyDown = (event: React.KeyboardEvent) => {
		const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] as CenterTab;
		openCenter(next);
		document.getElementById(`${id}-${next}`)?.focus();
	};
	return (
		<main className="main center-main">
			<header className="session-header">
				<SidebarToggle />
				<div className="session-title">
					<h1>{t("approvalCenter")}</h1>
					<span className="session-meta">
						{count > 0 ? t("approvalCount", { n: count }) : t("centerEmpty")}
					</span>
				</div>
			</header>
			<div
				className="center-body"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area must be reachable by keyboard (spec 18.6)
				tabIndex={0}
			>
				<div className="center-inner">
					<div className="panel-tabs" role="tablist" aria-label={t("approvalCenter")}>
						{TABS.map((name) => (
							<button
								key={name}
								id={`${id}-${name}`}
								type="button"
								role="tab"
								className="panel-tab"
								aria-selected={tab === name}
								aria-controls={`${id}-panel`}
								tabIndex={tab === name ? 0 : -1}
								onKeyDown={onKeyDown}
								onClick={() => openCenter(name)}
							>
								{label[name]}
								{name === "pending" && count > 0 ? <span className="badge">{count}</span> : null}
							</button>
						))}
					</div>
					<div
						id={`${id}-panel`}
						className="center-panel"
						role="tabpanel"
						aria-labelledby={`${id}-${tab}`}
					>
						{tab === "pending" ? (
							<CenterList />
						) : tab === "decided" ? (
							<DecisionList />
						) : (
							<LetterList />
						)}
					</div>
				</div>
			</div>
		</main>
	);
}
