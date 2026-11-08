import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	PERMISSION_MODES,
	type PermissionMode,
	permissionModeOf,
	type Session,
	type ThinkingLevel,
} from "../../../src/shared/types.ts";
import {
	compactSession,
	continueSession,
	editQueued,
	freeName,
	loadModels,
	sendMessage,
	startSession,
	stopSession,
	updateSession,
	withdrawQueued,
} from "../actions.ts";
import { formatCost, formatNumber, t, useLang } from "../i18n.ts";
import { type ModelInfo, setState, type TranscriptState, useAppState } from "../state.ts";
import { NewSessionDialog } from "./dialogs.tsx";
import {
	ArrowUpIcon,
	ChatIcon,
	ChevronIcon,
	CodeIcon,
	CompactIcon,
	JigMark,
	MenuIcon,
	NotesIcon,
	PlayIcon,
	StopIcon,
	TodoActiveIcon,
	TodoDoneIcon,
	TodoIcon,
	TodoPendingIcon,
} from "./icons.tsx";
import { Transcript } from "./transcript.tsx";
import { Button, ErrorBox, Select, useAction } from "./ui.tsx";
import { useWorkspaces, WorkspacePicker, workspaceLabel } from "./workspaces.tsx";

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

/** On narrow screens the sidebar is a drawer; this opens it. */
export function SidebarToggle({ className = "" }: { className?: string }) {
	useLang();
	return (
		<Button
			variant="icon"
			className={`only-narrow ${className}`.trim()}
			aria-label={t("openSidebar")}
			onClick={() => setState({ drawerOpen: true })}
		>
			<MenuIcon />
		</Button>
	);
}

/** The header names the session; its actions live in the composer and in the sidebar's row menu. */
function SessionHeader({ session }: { session: Session }) {
	useLang();
	const workspaces = useWorkspaces();
	const tokens =
		session.usage.input + session.usage.output + session.usage.cacheRead + session.usage.cacheWrite;
	return (
		<header className="session-header">
			<SidebarToggle />
			<div className="session-title">
				<h1>{session.name}</h1>
				<span className="session-meta" title={session.cwd ?? undefined}>
					{t(`status_${session.status}`)} ·{" "}
					{session.cwd ? workspaceLabel(workspaces, session.cwd) : t("chat")} ·{" "}
					{t("tokens", { n: formatNumber(tokens) })} ·{" "}
					{t("cost", { n: formatCost(session.usage.cost) })}
				</span>
			</div>
		</header>
	);
}

/** How full the context is: a small pie next to the send button, drawn like the other line icons. */
function ContextPie({ used, total }: { used: number; total: number }) {
	useLang();
	const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
	const label = t("contextPercent", {
		p: percent,
		used: formatNumber(used),
		total: formatNumber(total),
	});
	const angle = ((percent / 100) * 360 - 90) * (Math.PI / 180);
	const x = 12 + 6 * Math.cos(angle);
	const y = 12 + 6 * Math.sin(angle);
	return (
		// biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be drawn as a pie; the role carries the same meaning
		<span
			className={percent >= 80 ? "context-pie context-pie-high" : "context-pie"}
			role="meter"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			aria-label={label}
			title={label}
		>
			<svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
				<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
				{percent >= 100 ? (
					<circle cx="12" cy="12" r="6" fill="currentColor" />
				) : percent > 0 ? (
					<path
						d={`M12 12V6A6 6 0 ${percent > 50 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`}
						fill="currentColor"
					/>
				) : null}
			</svg>
		</span>
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

/** The box at the bottom: your message, the model choice and a round send or stop button (as in Codex). */
function Composer({ session, transcript }: { session: Session; transcript: TranscriptState }) {
	useLang();
	const [text, setText] = useState("");
	const ref = useAutoGrow(text);
	const working = session.status === "working" || session.status === "waiting";
	const change = useAction((patch: Parameters<typeof updateSession>[1]) =>
		updateSession(session.id, patch),
	);
	const send = useAction(async () => {
		const value = text;
		if (!value.trim()) return;
		await sendMessage(session.id, value);
		setText("");
	});
	const stop = useAction(() => stopSession(session.id));
	const cont = useAction(() => continueSession(session.id));
	const compact = useAction(() => compactSession(session.id));
	const models = useModels(session.provider);
	const info = models.find((m) => m.id === session.model);

	// A workspace makes it a code session, none makes it a chat; the switch applies from the next turn.
	const switchFolder = useAction(async (cwd: string | null) => {
		await updateSession(session.id, { cwd });
	});
	const sendLabel = working ? t("queueSend") : t("send");
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
				<div className="composer-box">
					<textarea
						ref={ref}
						rows={1}
						value={text}
						placeholder={
							working ? t("composerQueued") : t("composerPlaceholder", { name: session.name })
						}
						aria-label={t("composerPlaceholder", { name: session.name })}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								void send.run();
							}
						}}
					/>
					<div className="composer-bar">
						<div className="composer-chips">
							<WorkspacePicker
								value={session.cwd}
								busy={switchFolder.busy}
								onChange={(cwd) => void switchFolder.run(cwd)}
							/>
							<ModelPicker
								provider={session.provider}
								model={session.model}
								thinking={session.thinking}
								busy={change.busy}
								onChange={(patch) => void change.run(patch)}
							/>
							<Select
								label={t("permissionMode")}
								value={permissionModeOf(session.options)}
								options={PERMISSION_MODES.map((mode) => ({
									value: mode,
									label: t(`perm_${mode}`),
									hint: t(`perm_${mode}_hint`),
								}))}
								busy={change.busy}
								onChange={(value) =>
									void change.run({ options: { permissionMode: value as PermissionMode } })
								}
							/>
						</div>
						<div className="composer-actions">
							{!working && session.contextTokens > 0 && (
								<Button
									variant="icon"
									aria-label={t("compact")}
									title={t("compact")}
									busy={compact.busy}
									onClick={() => void compact.run()}
								>
									<CompactIcon />
								</Button>
							)}
							{!working && (
								<Button
									variant="icon"
									aria-label={t("continue")}
									title={t("continueHint")}
									busy={cont.busy}
									onClick={() => void cont.run()}
								>
									<PlayIcon />
								</Button>
							)}
							{info && <ContextPie used={session.contextTokens} total={info.contextWindow} />}
							{working && !text.trim() ? (
								<Button
									className="send-button"
									aria-label={t("stop")}
									title={t("stop")}
									busy={stop.busy}
									onClick={() => void stop.run()}
								>
									<StopIcon />
								</Button>
							) : (
								<Button
									className="send-button"
									aria-label={sendLabel}
									title={sendLabel}
									busy={send.busy}
									disabled={!text.trim()}
									onClick={() => void send.run()}
								>
									<ArrowUpIcon />
								</Button>
							)}
						</div>
					</div>
				</div>
				<ErrorBox
					error={
						send.error ??
						stop.error ??
						change.error ??
						cont.error ??
						compact.error ??
						switchFolder.error
					}
				/>
			</div>
		</div>
	);
}

const TODO_MARKS = {
	pending: <TodoPendingIcon />,
	in_progress: <TodoActiveIcon />,
	done: <TodoDoneIcon />,
} as const;

/**
 * The session's task list as a card floating at the transcript's top right, so it never narrows the
 * conversation. Folded, it shows the progress and the task under way; opened, every task.
 */
function TodoCard({ session }: { session: Session }) {
	useLang();
	const [open, setOpen] = useState(false);
	const listId = useId();
	const todos = session.todos;
	if (todos.length === 0) return null;
	const done = todos.filter((todo) => todo.status === "done").length;
	const current = todos.find((todo) => todo.status === "in_progress");
	return (
		<aside className={open ? "todo-card open" : "todo-card"} aria-label={t("todoTitle")}>
			<button
				type="button"
				className="todo-toggle"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen(!open)}
			>
				<TodoIcon />
				<span className="todo-count">{t("todoProgress", { done, total: todos.length })}</span>
				{!open && current && <span className="todo-current">{current.text}</span>}
				<ChevronIcon />
			</button>
			<ol id={listId} className="todo-list" hidden={!open}>
				{todos
					.map((todo, position) => ({ ...todo, key: `todo-${position}` }))
					.map((todo) => (
						<li key={todo.key} className={`todo-${todo.status}`}>
							{TODO_MARKS[todo.status]}
							<span>{todo.text}</span>
						</li>
					))}
			</ol>
		</aside>
	);
}

type TemplateKey = "code" | "docs" | "chat";

const TEMPLATES: { key: TemplateKey; icon: ReactNode }[] = [
	{ key: "code", icon: <CodeIcon /> },
	{ key: "docs", icon: <NotesIcon /> },
	{ key: "chat", icon: <ChatIcon /> },
];

/** A short session name from the first line of the first message; names may not hold @ or control characters. */
function nameFrom(text: string): string {
	const line = (text.trim().split("\n")[0] ?? "").replace(/[@\p{Cc}]/gu, "").trim();
	const chars = [...line];
	return chars.length > 24 ? `${chars.slice(0, 24).join("")}…` : line;
}

/**
 * No session open: one composer in the middle of the page (as in Codex, spec 12.3). You pick a folder
 * and a model in its bar and start by sending; the three templates under it add a role.
 */
function HomeView() {
	useLang();
	const settings = useAppState((state) => state.settings);
	const homeFolder = useAppState((state) => state.homeFolder);
	const [text, setText] = useState("");
	const [folder, setFolder] = useState<string | null>(null);
	const [template, setTemplate] = useState<TemplateKey | null>(null);
	const [model, setModel] = useState(
		() =>
			settings?.defaultModel ?? {
				provider: "deepseek",
				model: "deepseek-v4-pro",
				thinking: "medium" as ThinkingLevel,
			},
	);
	const [dialog, setDialog] = useState(false);
	const ref = useAutoGrow(text);
	useEffect(() => {
		ref.current?.focus();
	}, [ref]);
	// Opening a workspace from the sidebar lands here with that workspace chosen.
	useEffect(() => {
		if (!homeFolder) return;
		setFolder(homeFolder);
		setState({ homeFolder: null });
		ref.current?.focus();
	}, [homeFolder, ref]);
	const role = template === "code" || template === "docs" ? template : null;
	const missingFolder = role !== null && !folder;
	const start = useAction(async () => {
		const value = text.trim();
		if (!value || missingFolder) return;
		await startSession(
			{
				name: freeName(nameFrom(value) || t("template_chat")),
				kind: "task",
				groupId: null,
				cwd: folder,
				responsibility: role ? t(`template_${role}_role`) : "",
				...model,
			},
			value,
		);
	});
	const pickTemplate = (key: TemplateKey) => {
		const next = template === key ? null : key;
		setTemplate(next);
		if (next === "chat") setFolder(null);
		ref.current?.focus();
	};
	return (
		<main className="main main-home">
			<SidebarToggle className="home-menu" />
			<div className="home">
				<div className="home-intro">
					<JigMark className="lockup-mark" size={40} />
					<h1>{t("homeTitle")}</h1>
				</div>
				<div className="composer-box">
					<textarea
						ref={ref}
						rows={2}
						value={text}
						placeholder={t("homePlaceholder")}
						aria-label={t("homeTitle")}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								void start.run();
							}
						}}
					/>
					<div className="composer-bar">
						<div className="composer-chips">
							<WorkspacePicker value={folder} onChange={setFolder} />
							<ModelPicker {...model} onChange={(patch) => setModel((m) => ({ ...m, ...patch }))} />
						</div>
						<div className="composer-actions">
							<Button
								className="send-button"
								aria-label={t("send")}
								title={t("send")}
								busy={start.busy}
								disabled={!text.trim() || missingFolder}
								onClick={() => void start.run()}
							>
								<ArrowUpIcon />
							</Button>
						</div>
					</div>
				</div>
				{missingFolder && (
					<p className="hint" role="status">
						{t("folderRequired")}
					</p>
				)}
				<ErrorBox error={start.error} />
				<div className="suggestions">
					{TEMPLATES.map(({ key, icon }) => (
						<Button
							key={key}
							className="suggestion"
							aria-pressed={template === key}
							onClick={() => pickTemplate(key)}
						>
							{icon}
							{t(`template_${key}`)}
						</Button>
					))}
				</div>
				<Button variant="ghost" className="home-more" onClick={() => setDialog(true)}>
					{t("moreOptions")}
				</Button>
				{dialog && <NewSessionDialog onClose={() => setDialog(false)} />}
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
		return <HomeView />;
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
				<TodoCard session={session} />
			</div>
			{transcript && transcript.sessionId === session.id && (
				<Composer session={session} transcript={transcript} />
			)}
		</main>
	);
}
