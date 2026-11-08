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
import { CloseIcon, PlusIcon } from "./icons.tsx";
import { ModelPicker } from "./session.tsx";
import {
	Button,
	Dialog,
	describeError,
	ErrorBox,
	Field,
	Select,
	Toggletip,
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

/**
 * Permission rules as one list: the heading and "Add rule" on a line, then a row per rule (effect,
 * tool, optional scope, delete). An empty list says what happens without rules.
 */
export function RulesEditor({
	rules,
	onChange,
}: {
	rules: PermissionRule[];
	onChange: (rules: PermissionRule[]) => void;
}) {
	useLang();
	const headingId = useId();
	const update = (index: number, patch: Partial<PermissionRule>) =>
		onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
	return (
		<section className="rules" aria-labelledby={headingId}>
			<div className="rules-head">
				<span className="field-label">
					<span id={headingId}>{t("rules")}</span>
					<Toggletip label={t("rules")} text={t("rulesHelp")} />
				</span>
				<Button onClick={() => onChange([...rules, { effect: "allow", tool: "shell" }])}>
					<PlusIcon />
					{t("addRule")}
				</Button>
			</div>
			<div className="rules-list">
				{rules.length === 0 ? (
					<p className="rules-empty">{t("noRules")}</p>
				) : (
					rules.map((rule, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rules have no identity besides their position
						<div key={index} className="rule-row">
							<Select
								label={t("effect")}
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
										rules.map((r, i) =>
											i === index ? (pattern ? { ...rest, pattern } : rest) : r,
										),
									);
								}}
							/>
							<Button
								variant="icon"
								aria-label={t("deleteRule")}
								title={t("deleteRule")}
								onClick={() => onChange(rules.filter((_, i) => i !== index))}
							>
								<CloseIcon />
							</Button>
						</div>
					))
				)}
			</div>
		</section>
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

/**
 * Session settings: the role, permission rules and the compaction threshold. The rest sits where it
 * is used: name and group in the row menu; folder, model and edits in the composer.
 */
export function SessionSettingsDialog({
	session,
	onClose,
}: {
	session: Session;
	onClose: () => void;
}) {
	useLang();
	const [responsibility, setResponsibility] = useState(session.responsibility);
	const [compactAt, setCompactAt] = useState(
		session.options.compactAt ? String(session.options.compactAt) : "",
	);
	const [rules, setRules] = useState(session.rules);
	const roleId = useId();
	const compactId = useId();
	const compactErrorId = useId();
	const save = useAction(async () => {
		await updateSession(session.id, {
			responsibility,
			rules,
			options: { compactAt: compactAt.trim() ? Number(compactAt) : null },
		});
		onClose();
	});
	const dirty =
		responsibility !== session.responsibility ||
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
					<Button variant="primary" busy={save.busy} onClick={() => void save.run()}>
						{t("save")}
					</Button>
				</>
			}
		>
			<Field label={t("responsibility")} htmlFor={roleId}>
				<textarea
					id={roleId}
					className="textarea textarea-large"
					placeholder={t("responsibilityPlaceholder")}
					value={responsibility}
					onChange={(event) => setResponsibility(event.target.value)}
				/>
			</Field>
			<RulesEditor rules={rules} onChange={setRules} />
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
			<ErrorBox error={generalError(save.error, ["options"])} />
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
