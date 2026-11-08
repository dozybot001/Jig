import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Session, ThinkingLevel } from "../../../src/shared/types.ts";
import {
	compactSession,
	continueSession,
	editQueued,
	freeName,
	loadModels,
	sendMessage,
	startChat,
	stopSession,
	updateSession,
	withdrawQueued,
} from "../actions.ts";
import { formatCost, formatNumber, t, useLang } from "../i18n.ts";
import { type ModelInfo, type TranscriptState, useAppState } from "../state.ts";
import { NewSessionDialog, SessionSettingsDialog, type SessionTemplate } from "./dialogs.tsx";
import { ChatIcon, CodeIcon, MenuIcon, NotesIcon, PlusIcon } from "./icons.tsx";
import { Transcript } from "./transcript.tsx";
import { Button, ErrorBox, Menu, Select, useAction } from "./ui.tsx";

export function useModels(provider: string): ModelInfo[] {
	const models = useAppState((state) => state.models[provider]);
	useEffect(() => {
		if (!models) void loadModels(provider).catch(() => {});
	}, [provider, models]);
	return models ?? [];
}

const LEVEL_ORDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The level a request will actually use: the chosen one, else the next higher, else the next lower (as the server does). */
export function effectiveLevel(levels: ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
	if (levels.includes(wanted)) return wanted;
	const at = LEVEL_ORDER.indexOf(wanted);
	for (const level of LEVEL_ORDER.slice(at + 1)) if (levels.includes(level)) return level;
	for (const level of LEVEL_ORDER.slice(0, at).reverse()) if (levels.includes(level)) return level;
	return levels[0] ?? "off";
}

export function ModelPicker({
	provider,
	model,
	thinking,
	onChange,
	busy,
	layout = "row",
}: {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	onChange: (patch: { provider?: string; model?: string; thinking?: ThinkingLevel }) => void;
	busy?: boolean;
	/** "grid" shows a visible label over each choice, for forms; "row" is the compact header form. */
	layout?: "row" | "grid";
}) {
	useLang();
	const providers = useAppState((state) => state.providers);
	const models = useModels(provider);
	const info = models.find((m) => m.id === model);
	const ids = { provider: useId(), model: useId(), thinking: useId() };
	const providerOptions = providers.map((p) => ({
		value: p.id,
		label: p.hasKey || !p.keyRequired ? p.name : `${p.name} · ${t("noKey")}`,
		group: t(`region_${p.region}`),
	}));
	providerOptions.sort((a, b) => (a.group === b.group ? 0 : a.group === t("region_cn") ? -1 : 1));
	const grid = layout === "grid";
	const choose = {
		provider: (
			<Select
				{...(grid ? { labelledBy: ids.provider } : { label: t("provider") })}
				value={provider}
				options={providerOptions}
				busy={busy}
				onChange={async (value) => {
					const list = await loadModels(value);
					const first = list[0];
					if (first) onChange({ provider: value, model: first.id });
				}}
			/>
		),
		model: (
			<Select
				{...(grid ? { labelledBy: ids.model } : { label: t("model") })}
				value={model}
				busy={busy}
				options={models.map((m) => ({ value: m.id, label: m.name }))}
				onChange={(value) => onChange({ model: value })}
			/>
		),
		thinking: info?.reasoning ? (
			<Select
				{...(grid ? { labelledBy: ids.thinking } : { label: t("thinking") })}
				value={effectiveLevel(info.thinkingLevels, thinking)}
				busy={busy}
				options={info.thinkingLevels.map((level) => ({
					value: level,
					label: grid ? t(`thinking_${level}`) : `${t("thinking")}：${t(`thinking_${level}`)}`,
				}))}
				onChange={(value) => onChange({ thinking: value as ThinkingLevel })}
			/>
		) : null,
	};
	if (!grid) {
		return (
			<div className="model-picker">
				{choose.provider}
				{choose.model}
				{choose.thinking}
			</div>
		);
	}
	return (
		<div className="model-grid">
			<div className="field">
				<span className="field-label" id={ids.provider}>
					{t("provider")}
				</span>
				{choose.provider}
			</div>
			<div className="field">
				<span className="field-label" id={ids.model}>
					{t("model")}
				</span>
				{choose.model}
			</div>
			{choose.thinking && (
				<div className="field">
					<span className="field-label" id={ids.thinking}>
						{t("thinking")}
					</span>
					{choose.thinking}
				</div>
			)}
		</div>
	);
}

/** A home-relative path, so the header stays short: /Users/me/Jig → ~/Jig. */
function shortPath(path: string): string {
	return path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");
}

function SessionHeader({ session }: { session: Session }) {
	useLang();
	const models = useModels(session.provider);
	const info = models.find((m) => m.id === session.model);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const change = useAction((patch: Parameters<typeof updateSession>[1]) =>
		updateSession(session.id, patch),
	);
	const cont = useAction(() => continueSession(session.id));
	const compact = useAction(() => compactSession(session.id));
	const busy = session.status === "working" || session.status === "waiting";
	const tokens =
		session.usage.input + session.usage.output + session.usage.cacheRead + session.usage.cacheWrite;
	return (
		<header className="session-header">
			<Button
				variant="icon"
				className="only-narrow"
				aria-label={t("sessions")}
				onClick={() => document.querySelector(".app")?.classList.toggle("sidebar-open")}
			>
				<MenuIcon />
			</Button>
			<div className="session-title">
				<h1>{session.name}</h1>
				<span className="session-meta" title={session.cwd ?? undefined}>
					{t(`status_${session.status}`)} · {session.cwd ? shortPath(session.cwd) : t("chat")} ·{" "}
					{t("tokens", { n: formatNumber(tokens) })} ·{" "}
					{t("cost", { n: formatCost(session.usage.cost) })}
					{info &&
						` · ${t("contextUsed", { used: formatNumber(session.contextTokens), total: formatNumber(info.contextWindow) })}`}
				</span>
			</div>
			<ModelPicker
				provider={session.provider}
				model={session.model}
				thinking={session.thinking}
				busy={change.busy}
				onChange={(patch) => void change.run(patch)}
			/>
			{!busy && (session.status === "needs_review" || session.status === "error") && (
				<Button
					variant="primary"
					busy={cont.busy}
					onClick={() => void cont.run()}
					title={t("continueHint")}
				>
					{t("continue")}
				</Button>
			)}
			<Menu
				label={t("more")}
				items={[
					{ label: t("sessionSettings"), onSelect: () => setSettingsOpen(true) },
					...(busy ? [] : [{ label: t("compact"), onSelect: () => void compact.run() }]),
					...(busy ? [] : [{ label: t("continue"), onSelect: () => void cont.run() }]),
				]}
			/>
			<ErrorBox error={change.error ?? cont.error ?? compact.error} />
			{settingsOpen && (
				<SessionSettingsDialog session={session} onClose={() => setSettingsOpen(false)} />
			)}
		</header>
	);
}

/** Grows with its content; `field-sizing: content` where supported, a height update otherwise (spec 8). */
function useAutoGrow(value: string) {
	const ref = useRef<HTMLTextAreaElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the height is measured again whenever the text changes
	useEffect(() => {
		const element = ref.current;
		if (!element || CSS.supports("field-sizing", "content")) return;
		element.style.height = "auto";
		element.style.height = `${element.scrollHeight + 2}px`;
	}, [value]);
	return ref;
}

function QueuedItem({ sessionId, id, text }: { sessionId: string; id: string; text: string }) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(text);
	const save = useAction(async () => {
		await editQueued(sessionId, id, value);
		setEditing(false);
	});
	const withdraw = useAction(() => withdrawQueued(sessionId, id));
	const ref = useAutoGrow(value);
	return (
		<div className="queued-item">
			{editing ? (
				<textarea
					ref={ref}
					className="textarea"
					value={value}
					aria-label={t("edit")}
					onChange={(e) => setValue(e.target.value)}
				/>
			) : (
				<span>{text}</span>
			)}
			{editing ? (
				<Button busy={save.busy} onClick={() => void save.run()}>
					{t("save")}
				</Button>
			) : (
				<Button onClick={() => setEditing(true)}>{t("edit")}</Button>
			)}
			<Button busy={withdraw.busy} onClick={() => void withdraw.run()}>
				{t("remove")}
			</Button>
			<ErrorBox error={save.error ?? withdraw.error} />
		</div>
	);
}

function Composer({ session, transcript }: { session: Session; transcript: TranscriptState }) {
	useLang();
	const [text, setText] = useState("");
	const ref = useAutoGrow(text);
	const working = session.status === "working" || session.status === "waiting";
	const send = useAction(async () => {
		const value = text;
		if (!value.trim()) return;
		await sendMessage(session.id, value);
		setText("");
	});
	const stop = useAction(() => stopSession(session.id));
	return (
		<div className="composer">
			<div className="composer-inner">
				{transcript.queue.length > 0 && (
					<section className="queued" aria-label={t("queuedTitle")}>
						{transcript.queue.map((item) => (
							<QueuedItem key={item.id} sessionId={session.id} id={item.id} text={item.text} />
						))}
					</section>
				)}
				<div className="composer-row">
					<textarea
						ref={ref}
						className="textarea"
						rows={1}
						value={text}
						placeholder={t("composerPlaceholder", { name: session.name })}
						aria-label={t("composerPlaceholder", { name: session.name })}
						aria-describedby={working ? `${session.id}-queued-hint` : undefined}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								void send.run();
							}
						}}
					/>
					<div className="request-actions">
						{working && (
							<Button variant="danger" busy={stop.busy} onClick={() => void stop.run()}>
								{t("stop")}
							</Button>
						)}
						<Button
							variant="primary"
							busy={send.busy}
							disabled={!text.trim()}
							onClick={() => void send.run()}
						>
							{t("send")}
						</Button>
					</div>
				</div>
				{working && (
					<span id={`${session.id}-queued-hint`} className="hint">
						{t("composerQueued")}
					</span>
				)}
				<ErrorBox error={send.error ?? stop.error} />
			</div>
		</div>
	);
}

function TodoPanel({ session }: { session: Session }) {
	if (session.todos.length === 0) return null;
	const marks = { pending: "○", in_progress: "◐", done: "●" } as const;
	return (
		<aside className="todo-panel" aria-label="todo">
			<ol>
				{session.todos
					.map((todo, position) => ({ ...todo, key: `todo-${position}` }))
					.map((todo) => (
						<li
							key={todo.key}
							className={
								todo.status === "done"
									? "todo-done"
									: todo.status === "in_progress"
										? "todo-active"
										: ""
							}
						>
							<span aria-hidden="true">{marks[todo.status]}</span>
							<span>{todo.text}</span>
						</li>
					))}
			</ol>
		</aside>
	);
}

/** No session open: centred, one primary action, and a few starting points (spec 12.3). */
function EmptyMain() {
	useLang();
	const [template, setTemplate] = useState<SessionTemplate | null | undefined>(undefined);
	const chat = useAction(() => startChat(t("template_chat")));
	const templates: { icon: ReactNode; key: "code" | "docs" | "chat"; needsFolder: boolean }[] = [
		{ icon: <CodeIcon />, key: "code", needsFolder: true },
		{ icon: <NotesIcon />, key: "docs", needsFolder: true },
		{ icon: <ChatIcon />, key: "chat", needsFolder: false },
	];
	return (
		<main className="main main-empty">
			<div className="empty">
				<div className="empty-intro">
					<img className="lockup-mark" src="/icons/jig-mark.svg" alt="" width={48} height={48} />
					<h1>{t("noSessionTitle")}</h1>
					<p>{t("noSessionBody")}</p>
				</div>
				<div className="templates">
					{templates.map(({ icon, key, needsFolder }) => (
						<button
							key={key}
							type="button"
							className="template-card"
							aria-busy={key === "chat" && chat.busy ? "true" : undefined}
							onClick={() =>
								key === "chat"
									? void chat.run()
									: setTemplate({
											name: freeName(t(`template_${key}`)),
											responsibility: t(`template_${key}_role`),
											needsFolder,
										})
							}
						>
							{icon}
							<strong>{t(`template_${key}`)}</strong>
							<span>{t(`template_${key}_body`)}</span>
						</button>
					))}
				</div>
				<Button variant="primary" onClick={() => setTemplate(null)}>
					<PlusIcon /> {t("newSession")}
				</Button>
				<ErrorBox error={chat.error} />
				{template !== undefined && (
					<NewSessionDialog
						{...(template ? { template } : {})}
						onClose={() => setTemplate(undefined)}
					/>
				)}
			</div>
		</main>
	);
}

export function SessionView() {
	useLang();
	const selectedId = useAppState((state) => state.selectedId);
	const session = useAppState((state) =>
		state.selectedId ? state.sessions[state.selectedId] : undefined,
	);
	const transcript = useAppState((state) => state.transcript);
	if (!selectedId || !session) {
		return <EmptyMain />;
	}
	return (
		<main className="main">
			<SessionHeader session={session} />
			<div className="session-body">
				{transcript && transcript.sessionId === session.id ? (
					<Transcript transcript={transcript} />
				) : (
					<p className="notice">{t("loading")}</p>
				)}
				<TodoPanel session={session} />
			</div>
			{transcript && transcript.sessionId === session.id && (
				<Composer session={session} transcript={transcript} />
			)}
		</main>
	);
}
