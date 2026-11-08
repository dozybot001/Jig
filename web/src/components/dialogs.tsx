import { useId, useState } from "react";
import type {
	PermissionRule,
	Session,
	SessionKind,
	ThinkingLevel,
} from "../../../src/shared/types.ts";
import { createGroup, createSession, renameGroup, updateSession } from "../actions.ts";
import { ApiError } from "../api.ts";
import { t, useLang } from "../i18n.ts";
import { useAppState } from "../state.ts";
import { ModelPicker } from "./session.tsx";
import {
	Button,
	Dialog,
	describeError,
	ErrorBox,
	Field,
	Select,
	Switch,
	useAction,
} from "./ui.tsx";

const TOOLS = ["*", "read", "write", "edit", "glob", "grep", "shell", "web_fetch"];

function fieldError(error: unknown, field: string): string | null {
	if (!(error instanceof ApiError) || error.field !== field) return null;
	return describeError(error);
}

function generalError(error: unknown, fields: string[]): unknown {
	if (error instanceof ApiError && error.field && fields.includes(error.field)) return null;
	return error;
}

export function RulesEditor({
	rules,
	onChange,
}: {
	rules: PermissionRule[];
	onChange: (rules: PermissionRule[]) => void;
}) {
	useLang();
	const update = (index: number, patch: Partial<PermissionRule>) =>
		onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
	return (
		<div className="field">
			<Field label={t("rules")} info={t("rulesHelp")}>
				{rules.length === 0 && <span className="hint">{t("noRules")}</span>}
			</Field>
			{rules.map((rule, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rules have no identity besides their position
				<div key={index} className="rule-row">
					<Select
						label={t("effect_allow")}
						value={rule.effect}
						options={(["allow", "ask", "deny"] as const).map((e) => ({
							value: e,
							label: t(`effect_${e}`),
						}))}
						onChange={(value) => update(index, { effect: value as PermissionRule["effect"] })}
					/>
					<Select
						label={t("tool")}
						value={rule.tool}
						options={TOOLS.map((tool) => ({ value: tool, label: tool }))}
						onChange={(value) => update(index, { tool: value })}
					/>
					<input
						className="input"
						aria-label={t("pattern")}
						placeholder={t("pattern")}
						value={rule.pattern ?? ""}
						onChange={(event) => {
							const pattern = event.target.value;
							const { pattern: _drop, ...rest } = rule;
							onChange(
								rules.map((r, i) => (i === index ? (pattern ? { ...rest, pattern } : rest) : r)),
							);
						}}
					/>
					<Button onClick={() => onChange(rules.filter((_, i) => i !== index))}>
						{t("delete")}
					</Button>
				</div>
			))}
			<div>
				<Button onClick={() => onChange([...rules, { effect: "allow", tool: "shell" }])}>
					{t("addRule")}
				</Button>
			</div>
		</div>
	);
}

/**
 * Name and role first, since they define the session; then the folder, the model, and kind and group
 * side by side. Nothing is folded away, and the dialog fits without scrolling (spec 9.2).
 */
export function NewSessionDialog({
	onClose,
	groupId,
}: {
	onClose: () => void;
	groupId?: string | null;
}) {
	useLang();
	const settings = useAppState((state) => state.settings);
	const groups = useAppState((state) => state.groups);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<SessionKind>("task");
	const [group, setGroup] = useState<string>(groupId ?? "");
	const [cwd, setCwd] = useState("");
	const [responsibility, setResponsibility] = useState("");
	const [model, setModel] = useState({
		provider: settings?.defaultModel.provider ?? "deepseek",
		model: settings?.defaultModel.model ?? "deepseek-v4-pro",
		thinking: (settings?.defaultModel.thinking ?? "medium") as ThinkingLevel,
	});
	const ids = {
		name: useId(),
		nameError: useId(),
		role: useId(),
		cwd: useId(),
		cwdError: useId(),
		cwdHint: useId(),
	};
	const create = useAction(async () => {
		await createSession({
			name,
			kind,
			groupId: group || null,
			cwd: cwd.trim() || null,
			responsibility,
			...model,
		});
		onClose();
	});
	const nameError = fieldError(create.error, "name");
	const cwdError = fieldError(create.error, "cwd");
	return (
		<Dialog
			title={t("newSession")}
			size="m"
			onClose={onClose}
			footer={
				<>
					<Button onClick={onClose}>{t("cancel")}</Button>
					<Button
						variant="primary"
						busy={create.busy}
						disabled={!name.trim()}
						onClick={() => void create.run()}
					>
						{t("create")}
					</Button>
				</>
			}
		>
			<Field label={t("name")} htmlFor={ids.name} error={nameError} errorId={ids.nameError}>
				<input
					id={ids.name}
					className="input"
					value={name}
					maxLength={60}
					autoFocus
					aria-invalid={nameError ? "true" : undefined}
					aria-describedby={nameError ? ids.nameError : undefined}
					onChange={(event) => setName(event.target.value)}
				/>
			</Field>
			<Field label={t("responsibility")} htmlFor={ids.role}>
				<textarea
					id={ids.role}
					className="textarea textarea-large"
					placeholder={t("responsibilityPlaceholder")}
					value={responsibility}
					onChange={(event) => setResponsibility(event.target.value)}
				/>
			</Field>
			<Field label={t("workingFolder")} htmlFor={ids.cwd} error={cwdError} errorId={ids.cwdError}>
				<input
					id={ids.cwd}
					className="input"
					value={cwd}
					placeholder={t("folderPlaceholder")}
					aria-invalid={cwdError ? "true" : undefined}
					aria-describedby={cwdError ? ids.cwdError : undefined}
					onChange={(event) => setCwd(event.target.value)}
				/>
			</Field>
			<ModelPicker
				{...model}
				layout="grid"
				onChange={(patch) => setModel((current) => ({ ...current, ...patch }))}
			/>
			<div className="field-row">
				<Field label={t("kind")}>
					<Select
						label={t("kind")}
						value={kind}
						options={(["task", "standing"] as const).map((k) => ({
							value: k,
							label: t(`kind_${k}`),
						}))}
						onChange={(value) => setKind(value as SessionKind)}
					/>
				</Field>
				<Field label={t("group")}>
					<Select
						label={t("group")}
						value={group}
						options={[
							{ value: "", label: t("noGroup") },
							...groups.map((g) => ({ value: g.id, label: g.name })),
						]}
						onChange={setGroup}
					/>
				</Field>
			</div>
			<ErrorBox error={generalError(create.error, ["name", "cwd"])} />
		</Dialog>
	);
}

export function SessionSettingsDialog({
	session,
	onClose,
}: {
	session: Session;
	onClose: () => void;
}) {
	useLang();
	const groups = useAppState((state) => state.groups);
	const [name, setName] = useState(session.name);
	const [responsibility, setResponsibility] = useState(session.responsibility);
	const [group, setGroup] = useState(session.groupId ?? "");
	const [mode, setMode] = useState<"chat" | "code">(session.cwd ? "code" : "chat");
	const [folder, setFolder] = useState(session.cwd ?? "");
	const [directEdits, setDirectEdits] = useState(session.options.directEdits ?? false);
	const [compactAt, setCompactAt] = useState(
		session.options.compactAt ? String(session.options.compactAt) : "",
	);
	const [rules, setRules] = useState(session.rules);
	const nameId = useId();
	const folderId = useId();
	const folderErrorId = useId();
	const compactId = useId();
	const nameErrorId = useId();
	const compactErrorId = useId();
	const cwd = mode === "code" ? folder.trim() : null;
	const cwdChanged = cwd !== session.cwd;
	const save = useAction(async () => {
		await updateSession(session.id, {
			name,
			responsibility,
			groupId: group || null,
			...(cwdChanged ? { cwd } : {}),
			rules,
			options: { directEdits, compactAt: compactAt.trim() ? Number(compactAt) : null },
		});
		onClose();
	});
	// The switch is saved with the form, so show when something differs from what is saved (spec 6.4).
	const dirty =
		name !== session.name ||
		responsibility !== session.responsibility ||
		group !== (session.groupId ?? "") ||
		cwdChanged ||
		directEdits !== (session.options.directEdits ?? false) ||
		compactAt !== (session.options.compactAt ? String(session.options.compactAt) : "") ||
		JSON.stringify(rules) !== JSON.stringify(session.rules);
	return (
		<Dialog
			title={t("sessionSettings")}
			size="l"
			onClose={onClose}
			footer={
				<>
					{dirty && (
						<span className="hint unsaved" role="status">
							{t("unsavedChanges")}
						</span>
					)}
					<Button onClick={onClose}>{t("cancel")}</Button>
					<Button
						variant="primary"
						busy={save.busy}
						disabled={mode === "code" && !folder.trim()}
						onClick={() => void save.run()}
					>
						{t("save")}
					</Button>
				</>
			}
		>
			<Field
				label={t("name")}
				htmlFor={nameId}
				error={fieldError(save.error, "name")}
				errorId={nameErrorId}
			>
				<input
					id={nameId}
					className="input"
					value={name}
					maxLength={60}
					aria-invalid={fieldError(save.error, "name") ? "true" : undefined}
					aria-describedby={fieldError(save.error, "name") ? nameErrorId : undefined}
					onChange={(event) => setName(event.target.value)}
				/>
			</Field>
			<Field label={t("group")}>
				<Select
					label={t("group")}
					value={group}
					options={[
						{ value: "", label: t("noGroup") },
						...groups.map((g) => ({ value: g.id, label: g.name })),
					]}
					onChange={setGroup}
				/>
			</Field>
			<Field label={t("mode")} info={t("modeHelp")}>
				<Select
					label={t("mode")}
					value={mode}
					options={[
						{ value: "chat", label: t("mode_chat") },
						{ value: "code", label: t("mode_code") },
					]}
					onChange={(value) => setMode(value as "chat" | "code")}
				/>
			</Field>
			{mode === "code" && (
				<Field
					label={t("workingFolder")}
					htmlFor={folderId}
					error={fieldError(save.error, "cwd")}
					errorId={folderErrorId}
				>
					<input
						id={folderId}
						className="input"
						value={folder}
						placeholder={t("folderPath")}
						spellCheck={false}
						aria-invalid={fieldError(save.error, "cwd") ? "true" : undefined}
						aria-describedby={fieldError(save.error, "cwd") ? folderErrorId : undefined}
						onChange={(event) => setFolder(event.target.value)}
					/>
				</Field>
			)}
			<Field label={t("responsibility")}>
				<textarea
					className="textarea"
					aria-label={t("responsibility")}
					value={responsibility}
					onChange={(event) => setResponsibility(event.target.value)}
				/>
			</Field>
			{mode === "code" && (
				<Switch
					checked={directEdits}
					onChange={setDirectEdits}
					label={t("directEdits")}
					info={t("directEditsHelp")}
				/>
			)}
			<Field
				label={t("compactAt")}
				htmlFor={compactId}
				info={t("compactAtHelp")}
				error={fieldError(save.error, "options")}
				errorId={compactErrorId}
			>
				<input
					id={compactId}
					className="input"
					inputMode="numeric"
					aria-invalid={fieldError(save.error, "options") ? "true" : undefined}
					aria-describedby={fieldError(save.error, "options") ? compactErrorId : undefined}
					value={compactAt}
					onChange={(event) => setCompactAt(event.target.value.replace(/[^\d]/g, ""))}
				/>
			</Field>
			<RulesEditor rules={rules} onChange={setRules} />
			<ErrorBox error={generalError(save.error, ["name", "options", "cwd"])} />
		</Dialog>
	);
}

/** Renaming keeps the session's id, so messages and links to it still arrive (blueprint 7.1). */
export function RenameDialog({ session, onClose }: { session: Session; onClose: () => void }) {
	useLang();
	const [name, setName] = useState(session.name);
	const id = useId();
	const errorId = useId();
	const save = useAction(async () => {
		await updateSession(session.id, { name });
		onClose();
	});
	const error = fieldError(save.error, "name");
	return (
		<Dialog
			title={t("rename")}
			size="s"
			onClose={onClose}
			footer={
				<>
					<Button onClick={onClose}>{t("cancel")}</Button>
					<Button
						variant="primary"
						busy={save.busy}
						disabled={!name.trim() || name === session.name}
						onClick={() => void save.run()}
					>
						{t("save")}
					</Button>
				</>
			}
		>
			<Field label={t("name")} htmlFor={id} error={error} errorId={errorId}>
				<input
					id={id}
					className="input"
					value={name}
					maxLength={60}
					autoFocus
					aria-invalid={error ? "true" : undefined}
					aria-describedby={error ? errorId : undefined}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.nativeEvent.isComposing) {
							event.preventDefault();
							void save.run();
						}
					}}
				/>
			</Field>
			<ErrorBox error={generalError(save.error, ["name"])} />
		</Dialog>
	);
}

export function GroupDialog({
	group,
	onClose,
}: {
	group?: { id: string; name: string };
	onClose: () => void;
}) {
	useLang();
	const [name, setName] = useState(group?.name ?? "");
	const id = useId();
	const save = useAction(async () => {
		if (group) await renameGroup(group.id, name);
		else await createGroup(name);
		onClose();
	});
	return (
		<Dialog
			title={group ? t("renameGroup") : t("newGroup")}
			size="s"
			onClose={onClose}
			footer={
				<>
					<Button onClick={onClose}>{t("cancel")}</Button>
					<Button
						variant="primary"
						busy={save.busy}
						disabled={!name.trim()}
						onClick={() => void save.run()}
					>
						{group ? t("save") : t("create")}
					</Button>
				</>
			}
		>
			<Field label={t("groupName")} htmlFor={id}>
				<input
					id={id}
					className="input"
					value={name}
					maxLength={60}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => event.key === "Enter" && name.trim() && void save.run()}
				/>
			</Field>
			<ErrorBox error={save.error} />
		</Dialog>
	);
}

export function ConfirmDialog({
	title,
	body,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	body: string;
	confirmLabel: string;
	onConfirm: () => Promise<unknown>;
	onClose: () => void;
}) {
	const action = useAction(async () => {
		await onConfirm();
		onClose();
	});
	return (
		<Dialog
			title={title}
			size="s"
			onClose={onClose}
			footer={
				<>
					<Button onClick={onClose}>{t("cancel")}</Button>
					<Button variant="danger" busy={action.busy} onClick={() => void action.run()}>
						{confirmLabel}
					</Button>
				</>
			}
		>
			<p>{body}</p>
			<ErrorBox error={action.error} />
		</Dialog>
	);
}
