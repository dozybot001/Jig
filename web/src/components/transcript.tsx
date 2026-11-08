import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
	AssistantMessage,
	ToolCallBlock,
	ToolResultMessage,
} from "../../../src/shared/messages.ts";
import type {
	Approval,
	Entry,
	PermissionRequest,
	QuestionRequest,
	ToolCallView,
} from "../../../src/shared/types.ts";
import { answerApproval, loadEarlier, markRead, toolCallFor } from "../actions.ts";
import { t, useLang } from "../i18n.ts";
import { type TranscriptState, useAppState } from "../state.ts";
import { Diff, Markdown } from "./content.tsx";
import { Button, ErrorBox, useAction } from "./ui.tsx";

function resultText(result: ToolResultMessage | undefined): string {
	if (!result) return "";
	return result.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
}

function callSummary(call: ToolCallBlock): string {
	const args = call.arguments as Record<string, unknown>;
	const value = args.command ?? args.path ?? args.pattern ?? args.url ?? args.question ?? args.job;
	if (typeof value === "string") return value;
	if (call.name === "todo") return "";
	return JSON.stringify(args);
}

function Thinking({ text, live }: { text: string; live: boolean }) {
	// Open while it streams, folded once the answer starts (after AI Elements, prior-art 5.3).
	const [open, setOpen] = useState(live);
	useEffect(() => {
		if (!live) setOpen(false);
	}, [live]);
	return (
		<details
			className="thinking"
			open={open}
			onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
		>
			<summary>{t("thinkingLabel")}</summary>
			<div className="thinking-body">{text}</div>
		</details>
	);
}

function PermissionCard({ approval }: { approval: Approval }) {
	const request = approval.request as PermissionRequest;
	const [reason, setReason] = useState("");
	const [denying, setDenying] = useState(false);
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
					: decision
						? t(`decided_${decision}`)
						: ""}
				{approval.response?.reason ? `：${approval.response.reason}` : ""}
			</p>
		);
	}
	const rules = request.rememberRules
		?.map((rule) =>
			rule.pattern === "**"
				? t("allFilesInFolder", { tool: rule.tool })
				: (rule.pattern ?? rule.tool),
		)
		.join(", ");
	return (
		<section className="card request-card" aria-label={t("approvalTitle")}>
			<h3>{request.mustConfirm ? t("mustConfirmTitle") : t("approvalTitle")}</h3>
			<pre className="code">
				{request.tool === "shell" ? request.summary : `${request.tool}: ${request.summary}`}
			</pre>
			{request.mustConfirm && request.reason && (
				<p className="hint">{t("mustConfirmBody", { reason: request.reason })}</p>
			)}
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
			<div className="request-actions">
				<Button variant="primary" busy={action.busy} onClick={() => void action.run("allow_once")}>
					{t("approve")}
				</Button>
				{rules && (
					<Button
						busy={action.busy}
						onClick={() => void action.run("allow_always")}
						title={t("rememberAs", { rules })}
					>
						{t("approveRemember")}
					</Button>
				)}
				<Button
					variant="danger"
					busy={action.busy}
					onClick={() => (denying ? void action.run("deny") : setDenying(true))}
				>
					{t("deny")}
				</Button>
			</div>
			{rules && <p className="hint">{t("rememberAs", { rules })}</p>}
			<ErrorBox error={action.error} />
		</section>
	);
}

function QuestionCard({ approval }: { approval: Approval }) {
	const request = approval.request as QuestionRequest;
	const [text, setText] = useState("");
	const action = useAction((answer: string) => answerApproval(approval.id, { answer }));
	if (approval.status !== "pending") {
		return (
			<p className="hint">
				{approval.status === "cancelled"
					? t("cancelled")
					: t("answered", { a: approval.response?.answer ?? "" })}
			</p>
		);
	}
	return (
		<section className="card request-card" aria-label={t("questionTitle")}>
			<h3>{t("questionTitle")}</h3>
			<div>{request.question}</div>
			{request.options && (
				<div className="request-actions">
					{request.options.map((option) => (
						<Button key={option} busy={action.busy} onClick={() => void action.run(option)}>
							{option}
						</Button>
					))}
				</div>
			)}
			<div className="composer-row">
				<textarea
					className="textarea"
					rows={1}
					placeholder={t("answerPlaceholder")}
					aria-label={t("answerPlaceholder")}
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
				<Button
					variant="primary"
					busy={action.busy}
					disabled={!text.trim()}
					onClick={() => void action.run(text.trim())}
				>
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
	return (
		<div className="msg-assistant">
			<details
				className="card tool-card"
				open={open || pending}
				onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
			>
				<summary>
					<span className="tool-name">{call.name}</span>
					<span className="tool-summary">{callSummary(call)}</span>
					<span className={`chip chip-${status}`}>
						{t(`tool_${status}`)}
						{detail?.diff &&
							` ${t("linesAdded", { n: detail.added ?? 0 })} ${t("linesRemoved", { n: detail.removed ?? 0 })}`}
					</span>
				</summary>
				<div className="tool-detail">
					<h3>{t("toolArguments")}</h3>
					<pre className="code output">{JSON.stringify(call.arguments, null, 2)}</pre>
					{status === "running" && output && (
						<>
							<h3>{t("toolOutput")}</h3>
							<pre className="code output">{output}</pre>
						</>
					)}
					{detail?.diff && (
						<>
							<h3>{t("diff")}</h3>
							<Diff patch={detail.diff} />
						</>
					)}
					{result && (
						<>
							<h3>{t("toolResult")}</h3>
							<pre className="code output">{resultText(result)}</pre>
						</>
					)}
				</div>
			</details>
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

function AssistantBlocks({
	message,
	entryId,
	transcript,
	results,
	live,
}: {
	message: AssistantMessage;
	entryId: string | null;
	transcript: TranscriptState;
	results: Map<string, ToolResultMessage>;
	live: boolean;
}) {
	return (
		<>
			{message.content
				.map((block, position) => ({
					block,
					key: `${entryId ?? "draft"}:${position}`,
					last: position === message.content.length - 1,
				}))
				.map(({ block, key, last }) => {
					if (block.type === "thinking") {
						if (!block.thinking.trim()) return null;
						return <Thinking key={key} text={block.thinking} live={live && last} />;
					}
					if (block.type === "text") {
						if (!block.text.trim()) return null;
						return (
							<div key={key} className="msg-assistant">
								<Markdown text={block.text} />
							</div>
						);
					}
					const view = entryId ? toolCallFor(transcript.toolCalls, entryId, block.id) : undefined;
					const approvals = view
						? Object.values(transcript.approvals).filter((a) => a.toolCallId === view.id)
						: [];
					return (
						<ToolCard
							key={block.id}
							call={block}
							view={view}
							result={results.get(block.id)}
							approvals={approvals}
							output={view ? transcript.outputs[view.id] : undefined}
						/>
					);
				})}
		</>
	);
}

function EntryView({
	entry,
	transcript,
	results,
}: {
	entry: Entry;
	transcript: TranscriptState;
	results: Map<string, ToolResultMessage>;
}) {
	switch (entry.role) {
		case "user": {
			const content = entry.message.content;
			const text =
				typeof content === "string"
					? content
					: content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
			if (text.startsWith("[From Jig, not from the person]")) {
				return <p className="notice">{text.replace("[From Jig, not from the person] ", "")}</p>;
			}
			return (
				<div className="msg-user">
					<span className="visually-hidden">{t("you")}: </span>
					{text}
				</div>
			);
		}
		case "assistant":
			return (
				<AssistantBlocks
					message={entry.message}
					entryId={entry.id}
					transcript={transcript}
					results={results}
					live={false}
				/>
			);
		case "toolResult":
			return null;
		case "system":
			return (
				<details className="card divider-card">
					<summary>{t("instructionsUpdated")}</summary>
					<pre className="code output">{entry.message.content}</pre>
				</details>
			);
		case "compaction":
			return (
				<details className="card divider-card">
					<summary>{t("summaryTitle")}</summary>
					<Markdown text={entry.compaction.summary} />
				</details>
			);
		case "notice": {
			const notice = entry.notice;
			return (
				<p className={`notice ${notice.kind === "error" ? "notice-error" : ""}`}>
					{t(`notice_${notice.kind}`, { text: notice.text ?? "" })}
				</p>
			);
		}
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
	const atBottom = useRef(true);
	const [behind, setBehind] = useState(false);
	const loadMore = useAction(loadEarlier);

	const results = new Map<string, ToolResultMessage>();
	for (const entry of transcript.entries) {
		if (entry.role === "toolResult") results.set(entry.message.toolCallId, entry.message);
	}
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
		if (atBottom.current) {
			element.scrollTop = element.scrollHeight;
			markRead(transcript.sessionId);
		} else {
			setBehind(true);
		}
	}, [contentKey]);

	const openSessionId = transcript.sessionId;
	// biome-ignore lint/correctness/useExhaustiveDependencies: resets the scroll state when another session opens
	useEffect(() => {
		atBottom.current = true;
		setBehind(false);
	}, [openSessionId]);

	// A turn that ends while you are watching at the bottom counts as read.
	const unread = session?.unread ?? 0;
	useEffect(() => {
		if (unread > 0 && atBottom.current) markRead(transcript.sessionId);
	}, [unread, transcript.sessionId]);

	const onScroll = () => {
		const element = scroller.current;
		if (!element) return;
		atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
		if (atBottom.current) setBehind(false);
	};

	return (
		<section
			ref={scroller}
			className="transcript"
			onScroll={onScroll}
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
				{transcript.entries.map((entry) => (
					<EntryView key={entry.id} entry={entry} transcript={transcript} results={results} />
				))}
				{transcript.draft && (
					<div aria-busy="true">
						<AssistantBlocks
							message={transcript.draft}
							entryId={null}
							transcript={transcript}
							results={results}
							live
						/>
					</div>
				)}
				{freeApprovals.map((approval) => (
					<QuestionCard key={approval.id} approval={approval} />
				))}
				{behind && (
					<Button
						className="new-messages"
						onClick={() => {
							const element = scroller.current;
							if (element) element.scrollTop = element.scrollHeight;
							atBottom.current = true;
							setBehind(false);
						}}
					>
						{t("newMessages")} ↓
					</Button>
				)}
			</div>
		</section>
	);
}
