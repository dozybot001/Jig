import type { Session } from "../../../src/shared/types.ts";
import { formatClock, formatElapsed, t, useLang } from "../i18n.ts";
import { SUMMARY_KINDS, type Tally, tally, turnProgress, waitingOn } from "../progress.ts";
import { type TranscriptState, useAppState } from "../state.ts";
import { useNow } from "./ui.tsx";

/** "读取 6 个文件，运行 4 条命令，编辑 2 处": tool calls counted by kind; empty when there are none. */
export function tallyText({ counts, others }: Tally): string {
	const parts = SUMMARY_KINDS.filter((kind) => counts[kind]).map((kind) => {
		const n = counts[kind] ?? 0;
		return t(n === 1 ? `sum_${kind}_one` : `sum_${kind}`, { n });
	});
	if (others > 0) parts.push(t(others === 1 ? "sum_other_one" : "sum_other", { n: others }));
	// "Read 1 file, ran 2 commands": only the first part keeps its capital (Chinese has none).
	return parts
		.map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)))
		.join(t("listSeparator"));
}

/**
 * One line under the session's name (blueprint 6.9, item 27). While the session works: what this
 * turn has done so far, counted like the folded steps in the conversation, and how long it has taken.
 * While it waits for the person: what it waits for and for how long. Nothing when it is idle. The line
 * sits in the header's own height, so the conversation does not move when it comes and goes.
 *
 * The words are a live region and change only when a count or the state does. The ticking time is
 * kept out of it; in its place a screen reader hears when the turn or the wait began.
 */
export function ProgressLine({
	session,
	transcript,
}: {
	session: Session;
	transcript: TranscriptState | null;
}) {
	useLang();
	const cards = useAppState((state) => state.center.cards);
	const approvals = useAppState((state) => state.center.approvals);
	const waiting = waitingOn(session.id, Object.values(approvals), Object.values(cards));
	const working = session.status === "working";
	const turn = working && transcript ? turnProgress(transcript.entries, transcript.draft) : null;
	// A session that works on while a card of its own waits shows its work; the card is in the center.
	const wait = working ? null : waiting;
	const since = wait ? wait.since : (turn?.startedAt ?? null);
	const now = useNow(since === null ? 0 : 1000);
	let text = "";
	let spoken = "";
	let hint = "";
	if (wait) {
		text =
			wait.count > 1
				? t("progressWaitingMany", { n: wait.count })
				: t(`progressWaiting_${wait.kind}`);
		spoken = t("progressSince", { time: formatClock(wait.since) });
	} else if (working && transcript?.retry) {
		// The request failed in a way that may pass; Jig waits and asks again by itself.
		const { attempt, of, seconds } = transcript.retry;
		text = t("progressRetrying", { n: attempt, of, s: seconds });
		hint = transcript.retry.text;
	} else if (turn) {
		text = tallyText(tally(turn.tools)) || t("status_working");
		if (turn.startedAt !== null)
			spoken = t("progressStarted", { time: formatClock(turn.startedAt) });
	}
	const shown = wait ? "waiting" : "working";
	return (
		<div className="progress-line">
			{text && <span className={`dot row-dot dot-${shown}`} aria-hidden="true" />}
			{/* Always in the page, so a screen reader hears the words when they appear. */}
			<span className="progress-text" role="status" title={hint || undefined}>
				{text}
				{spoken && <span className="visually-hidden"> · {spoken}</span>}
			</span>
			{text && since !== null && (
				<span className="progress-time" aria-hidden="true">
					{t(wait ? "progressWaited" : "progressSpent", {
						t: formatElapsed(Math.max(0, now - since)),
					})}
				</span>
			)}
		</div>
	);
}
