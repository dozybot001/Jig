import { useId, useState } from "react";
import type {
	PermissionRule,
	Session,
	SessionKind,
	ThinkingLevel,
} from "../../../src/shared/types.ts";
import {
	createGroup,
	createSession,
	deleteCustomProvider,
	deleteKey,
	renameGroup,
	saveCustomProvider,
	saveKey,
	saveSettings,
	updateSession,
} from "../actions.ts";
import { ApiError } from "../api.ts";
import { t, useLang } from "../i18n.ts";
import { type ProviderSummary, useAppState } from "../state.ts";
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
	const nameId = useId();
	const cwdId = useId();
	const nameErrorId = useId();
	const cwdErrorId = useId();
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
			<Field
				label={t("name")}
				htmlFor={nameId}
				error={fieldError(create.error, "name")}
				errorId={nameErrorId}
			>
				<input
					id={nameId}
					className="input"
					value={name}
					maxLength={60}
					aria-invalid={fieldError(create.error, "name") ? "true" : undefined}
					aria-describedby={fieldError(create.error, "name") ? nameErrorId : undefined}
					onChange={(event) => setName(event.target.value)}
				/>
			</Field>
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
			<Field
				label={t("workingFolder")}
				htmlFor={cwdId}
				error={fieldError(create.error, "cwd")}
				errorId={cwdErrorId}
			>
				<input
					id={cwdId}
					className="input"
					value={cwd}
					placeholder={t("folderPlaceholder")}
					aria-invalid={fieldError(create.error, "cwd") ? "true" : undefined}
					aria-describedby={fieldError(create.error, "cwd") ? cwdErrorId : undefined}
					onChange={(event) => setCwd(event.target.value)}
				/>
			</Field>
			<Field label={t("model")}>
				<ModelPicker
					{...model}
					onChange={(patch) => setModel((current) => ({ ...current, ...patch }))}
				/>
			</Field>
			<Field label={t("responsibility")}>
				<textarea
					className="textarea"
					aria-label={t("responsibility")}
					placeholder={t("responsibilityPlaceholder")}
					value={responsibility}
					onChange={(event) => setResponsibility(event.target.value)}
				/>
			</Field>
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
	const [directEdits, setDirectEdits] = useState(session.options.directEdits ?? false);
	const [compactAt, setCompactAt] = useState(
		session.options.compactAt ? String(session.options.compactAt) : "",
	);
	const [rules, setRules] = useState(session.rules);
	const nameId = useId();
	const compactId = useId();
	const nameErrorId = useId();
	const compactErrorId = useId();
	const save = useAction(async () => {
		await updateSession(session.id, {
			name,
			responsibility,
			groupId: group || null,
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
					<Button variant="primary" busy={save.busy} onClick={() => void save.run()}>
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
			<Field label={t("responsibility")}>
				<textarea
					className="textarea"
					aria-label={t("responsibility")}
					value={responsibility}
					onChange={(event) => setResponsibility(event.target.value)}
				/>
			</Field>
			{session.cwd && (
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
			<ErrorBox error={generalError(save.error, ["name", "options"])} />
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

function ProviderRow({ provider }: { provider: ProviderSummary }) {
	useLang();
	const [editing, setEditing] = useState(false);
	const [key, setKey] = useState("");
	const [confirming, setConfirming] = useState(false);
	const save = useAction(async () => {
		await saveKey(provider.id, key.trim());
		setKey("");
		setEditing(false);
	});
	const status = !provider.keyRequired
		? t("keyless")
		: provider.hasKey
			? t("keySaved")
			: t("noKey");
	return (
		<div className="provider-row">
			<div>
				<strong>{provider.name}</strong> <span className="hint">· {status}</span>
				{editing && (
					<div className="field" style={{ marginTop: 8 }}>
						{/* An API key is not a sign-in password, so it is not marked as one (spec 18.5). */}
						<input
							className="input secret-input"
							type="text"
							autoComplete="off"
							spellCheck={false}
							data-1p-ignore="true"
							aria-label={t("keyPlaceholder")}
							placeholder={t("keyPlaceholder")}
							value={key}
							onChange={(event) => setKey(event.target.value)}
						/>
						<span className="hint">{t("keyHelp")}</span>
						<ErrorBox error={save.error} />
					</div>
				)}
			</div>
			<div className="request-actions">
				{editing ? (
					<>
						<Button onClick={() => setEditing(false)}>{t("cancel")}</Button>
						<Button
							variant="primary"
							busy={save.busy}
							disabled={!key.trim()}
							onClick={() => void save.run()}
						>
							{t("save")}
						</Button>
					</>
				) : (
					provider.keyRequired && (
						<Button onClick={() => setEditing(true)}>
							{provider.hasKey ? t("replaceKey") : t("setKey")}
						</Button>
					)
				)}
				{provider.hasKey && provider.keyRequired && !editing && (
					<Button variant="danger" onClick={() => setConfirming(true)}>
						{t("deleteKey")}
					</Button>
				)}
				{provider.custom && !editing && (
					<Button variant="danger" onClick={() => void deleteCustomProvider(provider.id)}>
						{t("deleteProvider")}
					</Button>
				)}
			</div>
			{confirming && (
				<ConfirmDialog
					title={t("deleteKey")}
					body={t("deleteKeyBody", { name: provider.name })}
					confirmLabel={t("delete")}
					onConfirm={() => deleteKey(provider.id)}
					onClose={() => setConfirming(false)}
				/>
			)}
		</div>
	);
}

function CustomProviderForm() {
	useLang();
	const [form, setForm] = useState({
		id: "",
		name: "",
		baseUrl: "",
		modelId: "",
		contextWindow: "32768",
		maxTokens: "8192",
		keyRequired: true,
	});
	const save = useAction(async () => {
		await saveCustomProvider(form.id.trim(), {
			name: form.name.trim(),
			baseUrl: form.baseUrl.trim(),
			keyRequired: form.keyRequired,
			models: [
				{
					id: form.modelId.trim(),
					contextWindow: Number(form.contextWindow),
					maxTokens: Number(form.maxTokens),
				},
			],
		});
		setForm({ ...form, id: "", name: "", baseUrl: "", modelId: "" });
	});
	const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
		setForm({ ...form, [key]: event.target.value });
	return (
		<details className="card divider-card">
			<summary>{t("addProvider")}</summary>
			<div className="dialog-body">
				<input
					className="input"
					aria-label={t("providerId")}
					placeholder={`${t("providerId")}: ollama`}
					value={form.id}
					onChange={set("id")}
				/>
				<input
					className="input"
					aria-label={t("name")}
					placeholder={`${t("name")}: Ollama`}
					value={form.name}
					onChange={set("name")}
				/>
				<input
					className="input"
					aria-label={t("baseUrl")}
					placeholder="http://127.0.0.1:11434/v1"
					value={form.baseUrl}
					onChange={set("baseUrl")}
				/>
				<input
					className="input"
					aria-label={t("modelId")}
					placeholder={`${t("modelId")}: qwen3:8b`}
					value={form.modelId}
					onChange={set("modelId")}
				/>
				<input
					className="input"
					aria-label={t("contextWindow")}
					inputMode="numeric"
					value={form.contextWindow}
					onChange={set("contextWindow")}
				/>
				<input
					className="input"
					aria-label={t("maxOutput")}
					inputMode="numeric"
					value={form.maxTokens}
					onChange={set("maxTokens")}
				/>
				<Switch
					checked={form.keyRequired}
					onChange={(value) => setForm({ ...form, keyRequired: value })}
					label={t("keyRequired")}
				/>
				<div>
					<Button
						variant="primary"
						busy={save.busy}
						disabled={
							!form.id.trim() || !form.name.trim() || !form.baseUrl.trim() || !form.modelId.trim()
						}
						onClick={() => void save.run()}
					>
						{t("save")}
					</Button>
				</div>
				<ErrorBox error={save.error} />
			</div>
		</details>
	);
}

function About() {
	useLang();
	const health = useAppState((state) => state.health);
	return (
		<div className="dialog-body" style={{ padding: 0 }}>
			<div className="about-block">
				{/* Wordmark with the Tenon endorsement mark at its top right (spec 1.2, 1.4); Jig's own logomark is still to be designed. */}
				<div className="lockup" role="img" aria-label={t("lockupName")}>
					<span className="wordmark lockup-word">Jig</span>
					<img className="lockup-tenon" src="/icons/tenon-mark.svg" alt="" width={14} height={14} />
				</div>
				<p className="hint">
					{t("version", { v: health?.version ?? "" })}
					{health?.build ? ` · ${t("build", { b: health.build })}` : ""}
				</p>
			</div>
			<p>{t("aboutBody")}</p>
			<div className="about-block">
				<h3>{t("publisher")}</h3>
				<p className="publisher">
					<img src="/icons/tenon-mark.svg" alt="" width={20} height={20} />
					<strong>{t("publisherName")}</strong>
				</p>
			</div>
			<div className="about-block">
				<h3>{t("website")}</h3>
				<p>
					<a href="https://tenon.asia/" target="_blank" rel="noopener noreferrer">
						tenon.asia
					</a>
				</p>
			</div>
			<details className="card divider-card">
				<summary>{t("privacyPolicy")}</summary>
				<div className="policy">
					<p className="hint">{t("docVersion", { v: "1.0", date: t("policyDate") })}</p>
					{t("privacyPolicyBody")
						.split("\n\n")
						.map((paragraph) => (
							<p key={paragraph.slice(0, 24)}>{paragraph}</p>
						))}
				</div>
			</details>
			<details className="card divider-card">
				<summary>{t("terms")}</summary>
				<div className="policy">
					<p className="hint">{t("docVersion", { v: "1.0", date: t("policyDate") })}</p>
					{t("termsBody")
						.split("\n\n")
						.map((paragraph) => (
							<p key={paragraph.slice(0, 24)}>{paragraph}</p>
						))}
				</div>
			</details>
			<div className="about-block">
				<h3>{t("feedback")}</h3>
				<p>
					<a href="mailto:support@tenonai.cn">support@tenonai.cn</a>
				</p>
			</div>
		</div>
	);
}

export function SettingsDialog({
	onClose,
	initialTab = "general",
}: {
	onClose: () => void;
	initialTab?: string;
}) {
	useLang();
	const settings = useAppState((state) => state.settings);
	const providers = useAppState((state) => state.providers);
	const [tab, setTab] = useState(initialTab);
	const [rules, setRules] = useState(settings?.defaultRules ?? []);
	const save = useAction(saveSettings);
	if (!settings) return null;
	const tabs = [
		["general", t("general")],
		["providers", t("providers")],
		["rules", t("defaultRules")],
		["about", t("about")],
	] as const;
	const sorted = [...providers].sort((a, b) => {
		const order = { cn: 0, custom: 1, global: 2 } as const;
		return order[a.region] - order[b.region] || a.name.localeCompare(b.name);
	});
	return (
		<Dialog
			title={tab === "about" ? t("about") : t("settings")}
			size="l"
			onClose={onClose}
			tabs={
				<div className="tabs" role="tablist">
					{tabs.map(([id, label]) => (
						<button
							key={id}
							type="button"
							role="tab"
							className="tab"
							aria-selected={tab === id}
							onClick={() => setTab(id)}
						>
							{label}
						</button>
					))}
				</div>
			}
			footer={
				tab === "rules" ? (
					<Button
						variant="primary"
						busy={save.busy}
						onClick={() => void save.run({ defaultRules: rules })}
					>
						{t("save")}
					</Button>
				) : (
					<Button onClick={onClose}>{t("close")}</Button>
				)
			}
		>
			{tab === "general" && (
				<>
					<Field label={t("theme")}>
						<Select
							label={t("theme")}
							value={settings.theme}
							busy={save.busy}
							options={(["system", "light", "dark"] as const).map((v) => ({
								value: v,
								label: t(`theme_${v}`),
							}))}
							onChange={(value) => void save.run({ theme: value as typeof settings.theme })}
						/>
					</Field>
					<Field label={t("language")}>
						<Select
							label={t("language")}
							value={settings.language}
							busy={save.busy}
							options={[
								{ value: "system", label: t("language_system") },
								{ value: "zh", label: "简体中文" },
								{ value: "en", label: "English" },
							]}
							onChange={(value) => void save.run({ language: value as typeof settings.language })}
						/>
					</Field>
					<Field label={t("defaultModel")}>
						<ModelPicker
							{...settings.defaultModel}
							busy={save.busy}
							onChange={(patch) =>
								void save.run({ defaultModel: { ...settings.defaultModel, ...patch } })
							}
						/>
					</Field>
					<ErrorBox error={save.error} />
				</>
			)}
			{tab === "providers" && (
				<>
					{sorted.map((provider) => (
						<ProviderRow key={provider.id} provider={provider} />
					))}
					<CustomProviderForm />
				</>
			)}
			{tab === "rules" && (
				<>
					<RulesEditor rules={rules} onChange={setRules} />
					<ErrorBox error={save.error} />
				</>
			)}
			{tab === "about" && <About />}
		</Dialog>
	);
}
