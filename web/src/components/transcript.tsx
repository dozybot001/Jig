import {
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type AssistantMessage,
	askedQuestion,
	bodyAfterSummary,
	type LetterRef,
	plainLine,
	type ToolCallBlock,
	type ToolResultMessage,
} from "../../../src/shared/messages.ts";
import {
	type Approval,
	type Entry,
	type OrganizeStep,
	type PermissionRequest,
	type Question,
	type QuestionRequest,
	questionsOf,
	type ToolCallView,
} from "../../../src/shared/types.ts";
import { answerApproval, loadEarlier, markRead, selectSession, toolCallFor } from "../actions.ts";
import { formatAgo, hasMessage, type MessageKey, t, useLang } from "../i18n.ts";
import { type TranscriptState, useAppState } from "../state.ts";
import { Capped, Diff, Markdown, ScrollBlock, useStickToBottom } from "./content.tsx";
import {
	CheckAllIcon,
	CheckIcon,
	ChevronIcon,
	DecisionIcon,
	MailIcon,
	QuestionIcon,
	RefuseIcon,
	SendIcon,
	ShieldIcon,
} from "./icons.tsx";
import { Button, CardHead, describeRule, ErrorBox, useAction, useNow } from "./ui.tsx";

function resultText(result: ToolResultMessage | undefined): string {
	if (!result) return "";
	return result.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
}

/** The line beside a tool's verb: the command, the file, the letter's summary… */
function callSummary(call: ToolCallBlock, recipient: string | null): string {
	const args = call.arguments as Record<string, unknown>;
	switch (call.name) {
		case "send_letter":
			return `${recipient ?? String(args.to ?? "")} · ${String(args.summary ?? "")}`;
		case "open_session":
			return String(args.name ?? "");
		case "post_card":
			return String(args.title ?? "");
		case "update_card":
		case "withdraw_card":
		case "check_decision":
			return `#${String(args.number ?? "")}`;
		case "finish_task":
			return typeof args.result === "string" ? t(`outcome_${args.result}` as MessageKey) : "";
		case "todo":
		case "list_sessions":
		case "list_cards":
			return "";
	}
	const asked = askedQuestion(args);
	if (asked) {
		return asked.count > 1
			? t("moreQuestions", { q: asked.question, n: asked.count - 1 })
			: asked.question;
	}
	const value = args.command ?? args.path ?? args.pattern ?? args.url ?? args.job;
	if (typeof value === "string") return value;
	return JSON.stringify(args);
}

const TOOL_VERBS = [
	"read",
	"write",
	"edit",
	"glob",
	"grep",
	"shell",
	"shell_job",
	"todo",
	"ask_user",
	"web_fetch",
	"send_letter",
	"list_sessions",
	"check_decision",
	"open_session",
	"finish_task",
	"post_card",
	"update_card",
	"withdraw_card",
	"list_cards",
] as const;

function isToolVerb(name: string): name is (typeof TOOL_VERBS)[number] {
	return (TOOL_VERBS as readonly string[]).includes(name);
}

function Thinking({ text, live }: { text: string; live: boolean }) {
	// Open while it streams, folded once the answer starts (after AI Elements, prior-art 5.3).
	const [open, setOpen] = useState(live);
	useEffect(() => {
		if (!live) setOpen(false);
	}, [live]);
	return (
		<details
			className="activity"
			open={open}
			onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
		>
			<summary>
				<span className={live ? "activity-verb shimmer" : "activity-verb"}>
					{t("thinkingLabel")}
				</span>
				<ChevronIcon />
			</summary>
			<Capped className="thinking-body" label={t("thinkingLabel")} follow={live}>
				{text}
			</Capped>
		</details>
	);
}

/**
 * What a permission request does, in the person's words: why a must-confirm operation asks every time,
 * or the kind of action the tool takes. The command, file or address follows below it.
 */
function permissionHeadline(request: PermissionRequest): string {
	if (request.reasons && request.reasons.length > 0) {
		return request.reasons
			.map((reason) => t(`confirm_${reason}` satisfies MessageKey))
			.join(t("listSeparator"));
	}
	if (request.reason) return request.reason;
	// A task session is named in the line itself; there is no command or file to show under it.
	if (request.tool === "open_session") {
		return t("ask_open_session_named", { name: t("quoted", { s: request.summary }) });
	}
	const key = `ask_${request.tool}`;
	return hasMessage(key) ? t(key) : request.tool;
}

/** One change organize_sessions would make, in the person's language. */
function organizeText(step: OrganizeStep): string {
	const quoted = (name: string) => t("quoted", { s: name });
	switch (step.action) {
		case "rename_session":
			return t("organize_rename_session", { from: quoted(step.from), to: quoted(step.to) });
		case "create_team":
			return t("organize_create_team", { name: quoted(step.name) });
		case "rename_team":
			return t("organize_rename_team", { from: quoted(step.from), to: quoted(step.to) });
		case "move_to_team": {
			const sessions = step.sessions.map(quoted).join(t("enumSeparator"));
			return step.team === null
				? t("organize_leave_team", { sessions })
				: t("organize_move_to_team", { sessions, team: quoted(step.team) });
		}
	}
}

/**
 * A permission request. In the approval center it names the session and how long it has been waiting;
 * in the session itself it says that it needs the person's permission.
 */
export function PermissionCard({ approval, session }: { approval: Approval; session?: ReactNode }) {
	const request = approval.request as PermissionRequest;
	const [reason, setReason] = useState("");
	const [denying, setDenying] = useState(false);
	const now = useNow();
	const action = useAction((decision: "allow_once" | "allow_always" | "deny") =>
		answerApproval(
			approval.id,
			decision === "deny" && reason.trim() ? { decision, reason: reason.trim() } : { decision },
		),
	);
	if (approval.status !== "pending") {
		const decision = approval.response?.decision;
		return (
			<p className="hint">
				{approval.status === "cancelled"
					? t("cancelled")
					: decision && approval.response?.reason
						? t("decidedWithReason", {
								decision: t(`decided_${decision}`),
								reason: approval.response.reason,
							})
						: decision
							? t(`decided_${decision}`)
							: ""}
			</p>
		);
	}
	// "Always allow" names what it remembers the way the session settings list it.
	const rules = request.rememberRules?.map(describeRule).join(t("listSeparator"));
	const headline = permissionHeadline(request);
	return (
		<section className="card request-card" aria-label={headline}>
			<CardHead
				icon={<ShieldIcon />}
				parts={
					session
						? [session, t("waitingOnYou"), formatAgo(approval.createdAt, now)]
						: [t("approvalTitle")]
				}
				tags={
					request.mustConfirm ? (
						<span className="tag" title={t("confirmEachTimeHint")}>
							{t("confirmEachTime")}
						</span>
					) : null
				}
			/>
			<p className="request-title">{headline}</p>
			{request.description && (
				<Capped className="request-description" label={headline}>
					{request.description}
				</Capped>
			)}
			{request.tool === "open_session" ? null : request.organize ? (
				<ul className="request-list">
					{request.organize.map((step, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: the changes are fixed and in order
						<li key={index}>{organizeText(step)}</li>
					))}
				</ul>
			) : (
				<ScrollBlock className="code request-code" label={headline}>
					{request.summary}
				</ScrollBlock>
			)}
			{request.diff && <Diff patch={request.diff} />}
			{denying && (
				<input
					className="input"
					placeholder={t("denyReason")}
					aria-label={t("denyReason")}
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					onKeyDown={(event) => event.key === "Enter" && void action.run("deny")}
				/>
			)}
			{/* Allow, always allow (the rule is in the label), decline. */}
			<div className="request-actions">
				<Button variant="primary" busy={action.busy} onClick={() => void action.run("allow_once")}>
					<CheckIcon />
					{t("approve")}
				</Button>
				{rules && (
					<Button
						className="request-always"
						busy={action.busy}
						onClick={() => void action.run("allow_always")}
						title={t("rememberAs", { rules })}
					>
						<CheckAllIcon />
						{t("approveAlways", { rules })}
					</Button>
				)}
				<Button
					variant="danger"
					busy={action.busy}
					onClick={() => (denying ? void action.run("deny") : setDenying(true))}
				>
					<RefuseIcon />
					{denying ? t("confirmDeny") : t("deny")}
				</Button>
			</div>
			<ErrorBox error={action.error} />
		</section>
	);
}

type Draft = { choices: number[]; other: boolean; text: string };

/** What the person answered, as the resolved card shows it: options picked, then their own words. */
function answeredText(questions: Question[], response: Approval["response"]): string {
	const answers = response?.answers;
	if (!answers) return t("answered", { a: response?.answer ?? "" });
	const parts = questions.map((question, index) => {
		const answer = answers[index];
		const labels = (answer?.choices ?? [])
			.map((choice) => question.options?.[choice]?.label ?? "")
			.join(t("enumSeparator"));
		const words = answer?.text ?? "";
		const part = labels && words ? `${labels}${t("clauseSeparator")}${words}` : labels || words;
		return questions.length === 1 ? part : `${question.header || question.question} ${part}`;
	});
	return t("answered", { a: parts.join(t("clauseSeparator")) });
}

/**
 * Questions from a session, up to four on one card. Each lists its options with what they mean, the
 * recommended one chosen to start with; the last row takes the person's own words instead. One answer
 * button sends them all.
 */
export function QuestionCard({ approval, session }: { approval: Approval; session?: ReactNode }) {
	const questions = questionsOf(approval.request as QuestionRequest);
	const [drafts, setDrafts] = useState<Draft[]>(() =>
		questions.map((question) => ({
			choices:
				question.recommended !== undefined && question.options?.[question.recommended]
					? [question.recommended]
					: [],
			other: !question.options?.length,
			text: "",
		})),
	);
	const now = useNow();
	const id = useId();
	const action = useAction(() =>
		answerApproval(approval.id, {
			answers: drafts.map((draft) => ({
				choices: draft.choices,
				...(draft.other && draft.text.trim() ? { text: draft.text.trim() } : {}),
			})),
		}),
	);
	if (approval.status !== "pending") {
		return (
			<p className="hint">
				{approval.status === "cancelled"
					? t("cancelled")
					: answeredText(questions, approval.response)}
			</p>
		);
	}
	const ready = drafts.every(
		(draft) => draft.choices.length > 0 || (draft.other && draft.text.trim()),
	);
	const update = (index: number, change: (draft: Draft) => Draft) =>
		setDrafts((all) => all.map((draft, at) => (at === index ? change(draft) : draft)));
	// One choice replaces the others and the own words; with several allowed, each one toggles.
	const pick = (index: number, choice: number, multiple: boolean) =>
		update(index, (draft) =>
			multiple
				? {
						...draft,
						choices: draft.choices.includes(choice)
							? draft.choices.filter((c) => c !== choice)
							: [...draft.choices, choice].sort((a, b) => a - b),
					}
				: { ...draft, choices: [choice], other: false },
		);
	const pickOther = (index: number, multiple: boolean, on = true) =>
		update(index, (draft) =>
			multiple
				? { ...draft, other: on }
				: { ...draft, choices: on ? [] : draft.choices, other: on },
		);
	return (
		<section className="card request-card" aria-label={t("questionTitle")}>
			<CardHead
				icon={<QuestionIcon />}
				parts={
					session
						? [session, t("waitingOnYou"), formatAgo(approval.createdAt, now)]
						: [t("questionTitle")]
				}
			/>
			{questions.map((question, index) => {
				const draft = drafts[index] as Draft;
				const name = `${id}-${index}`;
				const options = question.options ?? [];
				const multiple = question.multiple === true;
				const kind = multiple ? "checkbox" : "radio";
				const mark = multiple ? "decision-check" : "decision-radio";
				return (
					<fieldset
						// biome-ignore lint/suspicious/noArrayIndexKey: a card's questions never change
						key={index}
						className="question-block"
						aria-labelledby={`${name}-q`}
					>
						<p id={`${name}-q`} className="request-title request-question">
							{question.header && <span className="tag">{question.header}</span>}
							{question.question}
							{multiple && <span className="hint">{t("pickSeveral")}</span>}
						</p>
						{options.map((option, choice) => (
							<label
								// biome-ignore lint/suspicious/noArrayIndexKey: options never change order, and labels may repeat
								key={choice}
								className="decision-option"
								data-checked={draft.choices.includes(choice) ? "true" : undefined}
							>
								<input
									type={kind}
									className="visually-hidden"
									name={name}
									checked={draft.choices.includes(choice)}
									onChange={() => pick(index, choice, multiple)}
								/>
								<span className={mark} aria-hidden="true" />
								<span className="decision-option-text">
									<span className="decision-option-label">
										{option.label}
										{choice === question.recommended && (
											<span className="tag">{t("recommended")}</span>
										)}
									</span>
									{option.detail && <span className="hint">{option.detail}</span>}
								</span>
							</label>
						))}
						{options.length > 0 ? (
							<div
								className="decision-option question-other"
								data-checked={draft.other ? "true" : undefined}
							>
								<input
									id={`${name}-other`}
									type={kind}
									className="visually-hidden"
									name={name}
									checked={draft.other}
									onChange={(event) => pickOther(index, multiple, event.target.checked)}
								/>
								<label htmlFor={`${name}-other`}>
									<span className={mark} aria-hidden="true" />
									<span className="visually-hidden">{t("otherAnswer")}</span>
								</label>
								<textarea
									className="question-other-input"
									rows={1}
									placeholder={t("otherAnswer")}
									aria-label={t("otherAnswer")}
									value={draft.text}
									onFocus={() => !multiple && !draft.other && pickOther(index, false)}
									onChange={(event) => {
										const text = event.target.value;
										update(index, (current) => ({
											...current,
											text,
											other: true,
											choices: multiple ? current.choices : [],
										}));
									}}
								/>
							</div>
						) : (
							<textarea
								className="textarea"
								rows={1}
								placeholder={t("answerPlaceholder")}
								aria-labelledby={`${name}-q`}
								value={draft.text}
								onChange={(event) => {
									const text = event.target.value;
									update(index, (current) => ({ ...current, text, other: true }));
								}}
							/>
						)}
					</fieldset>
				);
			})}
			<div className="request-actions">
				<Button
					variant="primary"
					busy={action.busy}
					disabled={!ready}
					onClick={() => void action.run()}
				>
					<SendIcon />
					{t("answer")}
				</Button>
			</div>
			<ErrorBox error={action.error} />
		</section>
	);
}

const ToolCard = memo(function ToolCard({
	call,
	view,
	result,
	approvals,
	output,
}: {
	call: ToolCallBlock;
	view: ToolCallView | undefined;
	result: ToolResultMessage | undefined;
	approvals: Approval[];
	output: string | undefined;
}) {
	const status = view?.status ?? (result ? (result.isError ? "error" : "done") : "pending");
	const pending = approvals.some((approval) => approval.status === "pending");
	const detail = view?.detail as
		| { diff?: string; added?: number; removed?: number }
		| null
		| undefined;
	const [open, setOpen] = useState(false);
	const to = call.name === "send_letter" ? (call.arguments as { to?: unknown }).to : undefined;
	const recipient = useAppState((state) =>
		typeof to === "string" ? (state.sessions[to]?.name ?? null) : null,
	);
	const running = status === "running";
	const verb = isToolVerb(call.name)
		? t(running ? `act_${call.name}_ing` : `act_${call.name}`)
		: call.name;
	const flagged = status !== "running" && status !== "done";
	return (
		<div className="msg-assistant msg-tool">
			{/* While the person is asked, the request card alone says what the call wants to do. */}
			{!pending && (
				<details
					className="activity tool-card"
					open={open}
					onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
				>
					<summary>
						<span className={running ? "activity-verb shimmer" : "activity-verb"}>{verb}</span>
						<span className="tool-summary">{callSummary(call, recipient)}</span>
						{detail?.diff && (
							<span className="tool-stat">
								<span className="stat-add" aria-hidden="true">
									+{detail.added ?? 0}
								</span>{" "}
								<span className="stat-del" aria-hidden="true">
									−{detail.removed ?? 0}
								</span>
								<span className="visually-hidden">
									{t("linesAdded", { n: detail.added ?? 0 })}{" "}
									{t("linesRemoved", { n: detail.removed ?? 0 })}
								</span>
							</span>
						)}
						{flagged && (
							<span className={`tool-state tool-state-${status}`}>{t(`tool_${status}`)}</span>
						)}
						<ChevronIcon />
					</summary>
					<div className="tool-detail">
						<h2>{t("toolArguments")}</h2>
						<ScrollBlock className="code output" label={t("toolArguments")}>
							{JSON.stringify(call.arguments, null, 2)}
						</ScrollBlock>
						{status === "running" && output && (
							<>
								<h2>{t("toolOutput")}</h2>
								<ScrollBlock className="code output" label={t("toolOutput")} follow>
									{output}
								</ScrollBlock>
							</>
						)}
						{detail?.diff && (
							<>
								<h2>{t("diff")}</h2>
								<Diff patch={detail.diff} />
							</>
						)}
						{result && (
							<>
								<h2>{t("toolResult")}</h2>
								<ScrollBlock className="code output" label={t("toolResult")}>
									{resultText(result)}
								</ScrollBlock>
							</>
						)}
					</div>
				</details>
			)}
			{approvals.map((approval) =>
				approval.kind === "permission" ? (
					<PermissionCard key={approval.id} approval={approval} />
				) : (
					<QuestionCard key={approval.id} approval={approval} />
				),
			)}
		</div>
	);
});

const JIG_NOTE = "[From Jig, not from the person]";

/** One step of a turn's work: a thought, a tool call, or a note Jig added to the context. */
type Step =
	| { kind: "thinking"; key: string; text: string; live: boolean }
	| { kind: "tool"; key: string; block: ToolCallBlock; entryId: string | null }
	| { kind: "note"; key: string; entry: Entry };

/** What the transcript shows, in order: messages, the assistant's text, and runs of steps. */
type Item =
	| { kind: "entry"; key: string; entry: Entry }
	| { kind: "text"; key: string; text: string; live: boolean }
	| { kind: "steps"; key: string; steps: Step[]; live: boolean; alone: boolean };

function userText(entry: Extract<Entry, { role: "user" }>): string {
	const content = entry.message.content;
	return typeof content === "string"
		? content
		: content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

/**
 * Turns the transcript into items. Consecutive thoughts and tool calls between two pieces of text form
 * one run, shown folded so the conversation stays readable. A call waiting for the person is taken out
 * of its run, so an approval is never hidden.
 */
function buildItems(transcript: TranscriptState, working: boolean): Item[] {
	const items: Item[] = [];
	let run: Step[] = [];
	const flush = (live = false) => {
		const first = run[0];
		if (first) items.push({ kind: "steps", key: first.key, steps: run, live, alone: false });
		run = [];
	};
	const blocks = (message: AssistantMessage, entryId: string | null, live: boolean) => {
		message.content.forEach((block, position) => {
			const key = `${entryId ?? "draft"}:${position}`;
			if (block.type === "thinking") {
				const last = position === message.content.length - 1;
				if (block.thinking.trim()) {
					run.push({ kind: "thinking", key, text: block.thinking, live: live && last });
				}
			} else if (block.type === "text") {
				if (!block.text.trim()) return;
				flush();
				items.push({ kind: "text", key, text: block.text, live });
			} else {
				const view = entryId ? toolCallFor(transcript.toolCalls, entryId, block.id) : undefined;
				const waiting =
					view !== undefined &&
					Object.values(transcript.approvals).some(
						(a) => a.toolCallId === view.id && a.status === "pending",
					);
				const step: Step = { kind: "tool", key: block.id, block, entryId };
				if (!waiting) {
					run.push(step);
					return;
				}
				flush();
				items.push({ kind: "steps", key: block.id, steps: [step], live: false, alone: true });
			}
		});
	};
	for (const entry of transcript.entries) {
		if (entry.role === "assistant") blocks(entry.message, entry.id, false);
		else if (entry.role === "system" || entry.role === "compaction") {
			run.push({ kind: "note", key: entry.id, entry });
		} else if (entry.role === "user" && userText(entry).startsWith(JIG_NOTE)) {
			// Jig's own notes to the model are not shown and do not split a run.
		} else if (entry.role !== "toolResult") {
			flush();
			items.push({ kind: "entry", key: entry.id, entry });
		}
	}
	if (transcript.draft) blocks(transcript.draft, null, true);
	flush(working);
	return items;
}

const SUMMARY_KINDS = [
	"read",
	"edit",
	"write",
	"search",
	"shell",
	"web",
	"letter",
	"session",
	"card",
] as const;
type SummaryKind = (typeof SUMMARY_KINDS)[number];

function summaryKind(tool: string): SummaryKind | null {
	if (tool === "read" || tool === "edit" || tool === "write") return tool;
	if (tool === "grep" || tool === "glob") return "search";
	if (tool === "shell" || tool === "shell_job") return "shell";
	if (tool === "web_fetch") return "web";
	if (tool === "send_letter") return "letter";
	if (tool === "open_session") return "session";
	if (tool === "post_card" || tool === "update_card" || tool === "withdraw_card") return "card";
	return null;
}

function failed(
	step: Step,
	transcript: TranscriptState,
	results: Map<string, ToolResultMessage>,
): boolean {
	if (step.kind !== "tool") return false;
	const view = step.entryId
		? toolCallFor(transcript.toolCalls, step.entryId, step.block.id)
		: undefined;
	const status = view?.status ?? (results.get(step.block.id)?.isError ? "error" : "done");
	return status === "error" || status === "denied";
}

/** "读取 6 个文件，运行 4 条命令，编辑 2 处": what a run did, counted by kind. */
function summarize(steps: Step[]): string {
	const counts = new Map<SummaryKind, number>();
	let thoughts = 0;
	let others = 0;
	for (const step of steps) {
		if (step.kind === "thinking") thoughts++;
		else if (step.kind === "note") others++;
		else {
			const kind = summaryKind(step.block.name);
			if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
			else others++;
		}
	}
	const parts = SUMMARY_KINDS.filter((kind) => counts.has(kind)).map((kind) => {
		const n = counts.get(kind) ?? 0;
		return t(n === 1 ? `sum_${kind}_one` : `sum_${kind}`, { n });
	});
	if (others > 0) parts.push(t(others === 1 ? "sum_other_one" : "sum_other", { n: others }));
	if (parts.length === 0) {
		parts.push(t(thoughts === 1 ? "sum_think_one" : "sum_think", { n: thoughts }));
	}
	return parts.join(t("listSeparator"));
}

function StepView({
	step,
	transcript,
	results,
}: {
	step: Step;
	transcript: TranscriptState;
	results: Map<string, ToolResultMessage>;
}) {
	if (step.kind === "thinking") return <Thinking text={step.text} live={step.live} />;
	if (step.kind === "note") return <NoteStep entry={step.entry} />;
	const view = step.entryId
		? toolCallFor(transcript.toolCalls, step.entryId, step.block.id)
		: undefined;
	const approvals = view
		? Object.values(transcript.approvals).filter((a) => a.toolCallId === view.id)
		: [];
	return (
		<ToolCard
			call={step.block}
			view={view}
			result={results.get(step.block.id)}
			approvals={approvals}
			output={view ? transcript.outputs[view.id] : undefined}
		/>
	);
}

/**
 * A run of steps folded into one line that counts what was done; open it to see every step. While the
 * session is still working on it, the latest step stays visible under the line.
 */
function StepGroup({
	steps,
	live,
	transcript,
	results,
}: {
	steps: Step[];
	live: boolean;
	transcript: TranscriptState;
	results: Map<string, ToolResultMessage>;
}) {
	useLang();
	const [open, setOpen] = useState(false);
	const errors = steps.filter((step) => failed(step, transcript, results)).length;
	const last = steps[steps.length - 1];
	return (
		<div className="step-group">
			<details
				className="activity"
				open={open}
				onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
			>
				<summary>
					<span className="activity-verb activity-count">{summarize(steps)}</span>
					{errors > 0 && (
						<span className="tool-state tool-state-error">{t("stepsFailed", { n: errors })}</span>
					)}
					<ChevronIcon />
				</summary>
				<Capped className="step-list" label={summarize(steps)} follow={live}>
					{steps.map((step) => (
						<StepView key={step.key} step={step} transcript={transcript} results={results} />
					))}
				</Capped>
			</details>
			{live && !open && last && <StepView step={last} transcript={transcript} results={results} />}
		</div>
	);
}

/** Jig's notes in the context: changed instruction files, or the summary of compacted history. */
function NoteStep({ entry }: { entry: Entry }) {
	useLang();
	if (entry.role === "system") {
		return (
			<details className="activity">
				<summary>
					<span className="activity-verb">{t("instructionsUpdated")}</span>
					<ChevronIcon />
				</summary>
				<ScrollBlock className="code output note-body" label={t("instructionsUpdated")}>
					{entry.message.content}
				</ScrollBlock>
			</details>
		);
	}
	if (entry.role === "compaction") {
		return (
			<details className="activity">
				<summary>
					<span className="activity-verb">{t("summaryTitle")}</span>
					<ChevronIcon />
				</summary>
				<Capped className="tool-detail note-summary" label={t("summaryTitle")}>
					<Markdown text={entry.compaction.summary} />
				</Capped>
			</details>
		);
	}
	return null;
}

/**
 * A letter from another session, a script or Jig, shown as a letter, not as words of the person. The
 * person's own decisions carry the "by you" mark (blueprint 7.2).
 */
function LetterEntry({ letter }: { letter: LetterRef }) {
	useLang();
	const senderId = letter.from.sessionId;
	const sender = useAppState((state) =>
		senderId ? (state.sessions[senderId]?.name ?? null) : null,
	);
	if (letter.kind === "decision" && letter.decision && letter.from.kind === "person") {
		const decision = letter.decision;
		return (
			<section
				className="letter-card letter-decision"
				aria-label={t("decisionHeading", { n: decision.number })}
			>
				<div className="letter-head">
					<DecisionIcon />
					<span>{t("decisionHeading", { n: decision.number })}</span>
					<span className="tag">{t("byYou")}</span>
				</div>
				<p className="letter-summary">{decision.title}</p>
				<p>{decision.choice ? t("decidedChoice", { c: decision.choice }) : t("noteOnly")}</p>
				{decision.note && <p className="letter-note">{decision.note}</p>}
			</section>
		);
	}
	const from =
		letter.from.kind === "cli"
			? t("fromCli")
			: letter.from.kind === "person"
				? t("you")
				: (sender ?? letter.from.name);
	// An automatic report repeats its first line as the summary; show it once.
	const body = bodyAfterSummary(letter.body, letter.summary);
	const kind = t(`letterKind_${letter.kind}`);
	return (
		<section className="letter-card" aria-label={`${kind} · ${from}`}>
			<div className="letter-head">
				<MailIcon />
				{senderId && sender ? (
					<button
						type="button"
						className="link-button"
						onClick={() => void selectSession(senderId)}
					>
						{from}
					</button>
				) : (
					<span>{from}</span>
				)}
				<span className="tag">{kind}</span>
				{letter.auto && <span className="hint">{t("sentByJig")}</span>}
			</div>
			<p className="letter-summary">{plainLine(letter.summary) || letter.summary}</p>
			{body && (
				<Capped className="letter-body" label={letter.summary}>
					<Markdown text={body} breaks />
				</Capped>
			)}
			{letter.decision && (
				<p className="hint">
					{t("verifiedDecision", { n: letter.decision.number })} ·{" "}
					{letter.decision.choice
						? t("decidedChoice", { c: letter.decision.choice })
						: t("noteOnly")}
				</p>
			)}
		</section>
	);
}

/** A message from the person, a letter, or a notice from Jig. */
function EntryView({ entry }: { entry: Entry }) {
	switch (entry.role) {
		case "user":
			if (entry.letter) return <LetterEntry letter={entry.letter} />;
			return (
				<Capped className="msg-user" label={t("you")}>
					<span className="visually-hidden">{t("you")}: </span>
					{userText(entry)}
				</Capped>
			);
		case "notice": {
			const notice = entry.notice;
			const data = (notice.data ?? {}) as Record<string, string | number | null>;
			let text: string;
			if (notice.kind === "error") {
				const code = String(data.code ?? "");
				text =
					code === "model-error"
						? t("notice_error_model", { text: notice.text ?? "" })
						: code === "compact-failed"
							? t("notice_compact_failed", { text: notice.text ?? "" })
							: code === "missing-api-key"
								? t("err_missingKey", { provider: String(data.provider ?? "") })
								: t("notice_error_internal");
			} else if (notice.kind === "job_finished") {
				text = t("notice_job_finished", {
					job: String(data.job ?? ""),
					command: String(data.command ?? ""),
					exit:
						data.exitCode === null || data.exitCode === undefined
							? ""
							: t("jobExit", { code: data.exitCode }),
				});
			} else {
				text = t(`notice_${notice.kind}`, { text: notice.text ?? "" });
			}
			return <p className={`notice ${notice.kind === "error" ? "notice-error" : ""}`}>{text}</p>;
		}
		default:
			return null;
	}
}

/**
 * The conversation. It follows new content only while you are at the bottom; when you have scrolled
 * up it leaves the view alone and offers a "new messages" button instead (spec 9.8).
 */
export function Transcript({ transcript }: { transcript: TranscriptState }) {
	useLang();
	const session = useAppState((state) => state.sessions[transcript.sessionId]);
	const scroller = useRef<HTMLDivElement>(null);
	const [behind, setBehind] = useState(false);
	const onFollow = useCallback((following: boolean) => {
		if (following) setBehind(false);
	}, []);
	// Follows new content only while you are at the bottom; any scroll up stops it at once (spec 9.8).
	const following = useStickToBottom(scroller, onFollow);
	const loadMore = useAction(loadEarlier);

	const results = new Map<string, ToolResultMessage>();
	for (const entry of transcript.entries) {
		if (entry.role === "toolResult") results.set(entry.message.toolCallId, entry.message);
	}
	const items = buildItems(transcript, session?.status === "working");
	const freeApprovals = Object.values(transcript.approvals).filter(
		(a) => !a.toolCallId && a.status === "pending",
	);
	const lastSeq = transcript.entries.at(-1)?.seq ?? 0;
	const draftSize = transcript.draft
		? transcript.draft.content.reduce(
				(n, b) =>
					n + (b.type === "text" ? b.text.length : b.type === "thinking" ? b.thinking.length : 1),
				0,
			)
		: 0;
	const contentKey = `${lastSeq}:${draftSize}:${Object.keys(transcript.approvals).length}`;

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when new content arrives, keyed by contentKey
	useLayoutEffect(() => {
		const element = scroller.current;
		if (!element) return;
		if (following.current) {
			element.scrollTop = element.scrollHeight;
			markRead(transcript.sessionId);
		} else {
			setBehind(true);
		}
	}, [contentKey]);

	const openSessionId = transcript.sessionId;
	// biome-ignore lint/correctness/useExhaustiveDependencies: resets the scroll state when another session opens
	useEffect(() => {
		following.current = true;
		setBehind(false);
	}, [openSessionId]);

	// A turn that ends while you are watching at the bottom counts as read.
	const unread = session?.unread ?? 0;
	useEffect(() => {
		if (unread > 0 && following.current) markRead(transcript.sessionId);
	}, [unread, transcript.sessionId, following]);

	return (
		<section
			ref={scroller}
			className="transcript"
			aria-label={session?.name ?? ""}
			aria-live="off"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area must be reachable by keyboard (spec 18.6)
			tabIndex={0}
			data-last-seq={lastSeq}
		>
			<div className="transcript-inner">
				{transcript.olderCursor !== null && (
					<Button busy={loadMore.busy} onClick={() => void loadMore.run()}>
						{t("loadEarlier")}
					</Button>
				)}
				{transcript.entries.length === 0 && !transcript.draft && (
					<p className="notice">{t("emptyTranscript")}</p>
				)}
				{items.map((item) => {
					if (item.kind === "entry") return <EntryView key={item.key} entry={item.entry} />;
					if (item.kind === "text") {
						return (
							<div key={item.key} className="msg-assistant">
								<Markdown text={item.text} live={item.live} />
							</div>
						);
					}
					const only = item.steps[0];
					// A single step, or one waiting for the person, shows as itself.
					if (only && (item.alone || item.steps.length === 1)) {
						return (
							<StepView key={item.key} step={only} transcript={transcript} results={results} />
						);
					}
					return (
						<StepGroup
							key={item.key}
							steps={item.steps}
							live={item.live}
							transcript={transcript}
							results={results}
						/>
					);
				})}
				{freeApprovals.map((approval) => (
					<QuestionCard key={approval.id} approval={approval} />
				))}
				{behind && (
					<Button
						className="new-messages"
						onClick={() => {
							const element = scroller.current;
							if (element) element.scrollTop = element.scrollHeight;
							following.current = true;
							setBehind(false);
						}}
					>
						{t("jumpToNew")} ↓
					</Button>
				)}
			</div>
		</section>
	);
}
