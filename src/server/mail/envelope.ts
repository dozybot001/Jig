import type { DecisionRef, LetterRef } from "../../shared/messages.ts";
import { type Card, type Letter, permissionModeOf, type Session } from "../../shared/types.ts";

/** Attribute values stay on one line and cannot close the tag they sit in. */
const attr = (value: string) => value.replace(/["\n\r<>]/g, " ");

/**
 * Text written by a session or a script cannot open or close Jig's own tags: `<letter`, `</letter`,
 * `<decision` and `</decision` are written with `&lt;`, so a letter cannot carry a fake decision of the
 * person. Only what the model reads changes; the interface shows the text as written.
 */
export function neutralize(text: string): string {
	return text.replace(/<(\/?)(letter|decision)\b/gi, "&lt;$1$2");
}

function senderLabel(letter: Letter): string {
	if (letter.fromKind === "cli") return "the command line (jig send)";
	if (letter.fromKind === "person") return "the person";
	if (letter.fromKind === "jig")
		return `the scheduled task '${letter.fromName}' (set up by the person)`;
	return letter.fromName;
}

/** The scheduled task a letter belongs to, by id and name. */
export type ScheduleRef = { id: string; name: string };

/** The decision as Jig recorded it, for a session to rely on. */
export function decisionRef(card: Card): DecisionRef {
	return {
		number: card.number,
		title: card.title,
		choice: card.choice === null ? null : (card.options[card.choice]?.label ?? null),
		note: card.note,
		decidedAt: card.decidedAt ?? card.updatedAt,
	};
}

/** What the interface shows for a delivered letter. */
export function letterRef(
	letter: Letter,
	decision: DecisionRef | null,
	schedule: ScheduleRef | null = null,
): LetterRef {
	return {
		id: letter.id,
		kind: letter.kind,
		from: { kind: letter.fromKind, sessionId: letter.fromSession, name: letter.fromName },
		summary: letter.summary,
		body: letter.body,
		...(letter.auto ? { auto: true } : {}),
		...(decision ? { decision } : {}),
		...(schedule ? { schedule } : {}),
	};
}

function decisionLines(decision: DecisionRef): string[] {
	return [
		`Question: ${neutralize(decision.title)}`,
		decision.choice
			? `Chosen: ${neutralize(decision.choice)}`
			: "No option was chosen; the note is the answer.",
		...(decision.note ? [`Note: ${neutralize(decision.note)}`] : []),
	];
}

/**
 * What the model reads for a delivered letter. The closing tag repeats the letter's id, which the sender
 * could not know while writing, so text inside a letter cannot pass itself off as the end of it. `note`
 * is Jig's own line about the letter, such as how a scheduled run works.
 */
export function letterText(
	letter: Letter,
	decision: DecisionRef | null,
	schedule: ScheduleRef | null = null,
	note: string | null = null,
): string {
	if (letter.fromKind === "person" && decision) {
		return [
			`<decision number="${decision.number}" from="the person" recorded-by="Jig">`,
			...decisionLines(decision),
			`</decision number="${decision.number}">`,
		].join("\n");
	}
	const attributes = [
		`id="${letter.id}"`,
		`kind="${letter.kind}"`,
		`from="${attr(senderLabel(letter))}"`,
		...(letter.fromSession ? [`from-id="${letter.fromSession}"`] : []),
		`thread="${letter.threadId}"`,
		...(letter.replyTo ? [`reply-to="${letter.replyTo}"`] : []),
		...(letter.auto ? ['auto="true"'] : []),
		...(schedule && letter.fromKind !== "jig" ? [`schedule="${attr(schedule.name)}"`] : []),
	];
	const lines = [`<letter ${attributes.join(" ")}>`, neutralize(letter.summary)];
	if (letter.body) lines.push("", neutralize(letter.body));
	if (decision) {
		lines.push(
			"",
			`[Jig checked decision #${decision.number}: the person decided it in Jig.]`,
			...decisionLines(decision),
		);
	}
	if (note) lines.push("", `[Jig] ${note}`);
	lines.push(`</letter id="${letter.id}">`);
	return lines.join("\n");
}

/** A decision for check_decision, with its state told plainly. */
export function decisionReport(card: Card, names: (id: string) => string | null): string {
	const lines: string[] = [];
	if (card.status === "pending") lines.push(`#${card.number} is still waiting for the person.`);
	else if (card.status === "withdrawn")
		lines.push(`#${card.number} was withdrawn: ${neutralize(card.withdrawnReason ?? "")}`);
	else {
		const when = new Date(card.decidedAt ?? card.updatedAt).toISOString();
		lines.push(`#${card.number} was decided by the person in Jig (${when}).`);
	}
	lines.push(`Question: ${neutralize(card.title)}`);
	if (card.options.length > 0) {
		lines.push(
			`Options: ${card.options
				.map(
					(option, index) =>
						`${index + 1}. ${neutralize(option.label)}${index === card.recommended ? " (recommended)" : ""}`,
				)
				.join("; ")}`,
		);
	}
	if (card.undoable !== null) {
		const how = card.reversible ? ` (${neutralize(card.reversible)})` : "";
		lines.push(`Can be undone: ${card.undoable ? "yes" : "no"}${how}`);
	}
	if (card.status === "decided") {
		const chosen = card.choice === null ? null : card.options[card.choice]?.label;
		lines.push(
			chosen ? `Chosen: ${neutralize(chosen)}` : "No option was chosen; the note is the answer.",
		);
		if (card.note) lines.push(`Note: ${neutralize(card.note)}`);
	}
	const requester = card.requestedBy ? names(card.requestedBy) : null;
	if (requester) lines.push(`Requested by: ${requester}`);
	return lines.join("\n");
}

/** One line per session for list_sessions. */
export function directoryLine(
	session: Session,
	marks: { you: boolean; main: boolean; parentName: string | null; group: string | null },
): string {
	const kind = `${session.kind} ${session.cwd ? `code (${session.cwd})` : "chat"}`;
	const parts = [session.id, session.name, kind, session.status];
	if (marks.group) parts.push(`group: ${marks.group}`);
	parts.push(`model: ${session.provider}/${session.model}`);
	parts.push(`permission: ${permissionModeOf(session.options)}`);
	const options = session.options;
	if (options.receive && options.receive !== "accept") parts.push(`receives: ${options.receive}`);
	if (options.letterQuota) parts.push(`letter quota: ${options.letterQuota}`);
	if (options.dailyBudget) parts.push(`daily budget: $${options.dailyBudget}`);
	if (options.canPostCards) parts.push("can post cards");
	if (options.canOrganize) parts.push("can manage Jig");
	if (session.pinned) parts.push("pinned");
	if (marks.main) parts.push("the main conversation");
	if (marks.you) parts.push("you");
	if (marks.parentName) parts.push(`opened by ${marks.parentName}`);
	if (session.outcome) parts.push(`result: ${session.outcome}`);
	const role = session.responsibility.trim().split("\n")[0]?.trim();
	if (role) parts.push(`role: ${role.length > 120 ? `${role.slice(0, 120)}…` : role}`);
	return `- ${parts.join(" · ")}`;
}
