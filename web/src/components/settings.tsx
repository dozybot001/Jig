import { useEffect, useId, useState } from "react";
import {
	deleteCustomProvider,
	deleteKey,
	openSettings,
	saveCustomProvider,
	saveKey,
	saveSettings,
} from "../actions.ts";
import { t, useLang } from "../i18n.ts";
import { type ProviderSummary, setState, useAppState } from "../state.ts";
import { ConfirmDialog } from "./dialogs.tsx";
import {
	ChevronIcon,
	GearIcon,
	InfoIcon,
	JigMark,
	KeyIcon,
	MailIcon,
	PlusIcon,
	SlidersIcon,
} from "./icons.tsx";
import { ModelPicker } from "./session.tsx";
import { Button, Dialog, ErrorBox, Field, Menu, type MenuEntry, Switch, useAction } from "./ui.tsx";

function ProviderRow({ provider }: { provider: ProviderSummary }) {
	useLang();
	const [editing, setEditing] = useState(false);
	const [key, setKey] = useState("");
	const [confirming, setConfirming] = useState<"key" | "provider" | null>(null);
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
					<div className="provider-key">
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
					<Button variant="danger" onClick={() => setConfirming("key")}>
						{t("deleteKey")}
					</Button>
				)}
				{provider.custom && !editing && (
					<Button variant="danger" onClick={() => setConfirming("provider")}>
						{t("deleteProvider")}
					</Button>
				)}
			</div>
			{confirming && (
				<ConfirmDialog
					title={confirming === "key" ? t("deleteKey") : t("deleteProvider")}
					body={
						confirming === "key"
							? t("deleteKeyBody", { name: provider.name })
							: t("deleteProviderBody", { name: provider.name })
					}
					confirmLabel={t("delete")}
					onConfirm={() =>
						confirming === "key" ? deleteKey(provider.id) : deleteCustomProvider(provider.id)
					}
					onClose={() => setConfirming(null)}
				/>
			)}
		</div>
	);
}

/** Adding an OpenAI-compatible provider opens its own dialog, so the page holds no folded form. */
function CustomProviderForm() {
	useLang();
	const empty = {
		id: "",
		name: "",
		baseUrl: "",
		modelId: "",
		contextWindow: "32768",
		maxTokens: "8192",
		keyRequired: true,
	};
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState(empty);
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
		setForm(empty);
		setOpen(false);
	});
	const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
		setForm({ ...form, [key]: event.target.value });
	const field = (
		key: "id" | "name" | "baseUrl" | "modelId" | "contextWindow" | "maxTokens",
		label: string,
		placeholder?: string,
	) => (
		<label className="field">
			<span className="field-label">{label}</span>
			<input
				className="input"
				value={form[key]}
				placeholder={placeholder}
				inputMode={key === "contextWindow" || key === "maxTokens" ? "numeric" : undefined}
				onChange={set(key)}
			/>
		</label>
	);
	return (
		<div>
			<Button onClick={() => setOpen(true)}>
				<PlusIcon />
				{t("addProvider")}
			</Button>
			{open && (
				<Dialog
					title={t("addProvider")}
					size="m"
					onClose={() => setOpen(false)}
					footer={
						<>
							<Button onClick={() => setOpen(false)}>{t("cancel")}</Button>
							<Button
								variant="primary"
								busy={save.busy}
								disabled={
									!form.id.trim() ||
									!form.name.trim() ||
									!form.baseUrl.trim() ||
									!form.modelId.trim()
								}
								onClick={() => void save.run()}
							>
								{t("save")}
							</Button>
						</>
					}
				>
					<div className="field-row">
						{field("id", t("providerId"), "ollama")}
						{field("name", t("name"), "Ollama")}
					</div>
					{field("baseUrl", t("baseUrl"), "http://127.0.0.1:11434/v1")}
					{field("modelId", t("modelId"), "qwen3:8b")}
					<div className="field-row">
						{field("contextWindow", t("contextWindow"))}
						{field("maxTokens", t("maxOutput"))}
					</div>
					<Switch
						checked={form.keyRequired}
						onChange={(value) => setForm({ ...form, keyRequired: value })}
						label={t("keyRequired")}
					/>
					<ErrorBox error={save.error} />
				</Dialog>
			)}
		</div>
	);
}

function Providers() {
	useLang();
	const providers = useAppState((state) => state.providers);
	const regions = ["cn", "custom", "global"] as const;
	return (
		<section className="settings-section" aria-label={t("providers")}>
			<p className="hint">{t("keyHelp")}</p>
			{regions.map((region) => {
				const list = providers
					.filter((provider) => provider.region === region)
					.sort((a, b) => a.name.localeCompare(b.name));
				if (list.length === 0) return null;
				return (
					<div key={region} className="provider-group">
						<h3>{t(`region_${region}`)}</h3>
						{list.map((provider) => (
							<ProviderRow key={provider.id} provider={provider} />
						))}
					</div>
				);
			})}
			<CustomProviderForm />
		</section>
	);
}

/**
 * Defaults for new sessions (the model and the permission rules), and where decisions are logged;
 * saved together.
 */
function DefaultsDialog({ onClose }: { onClose: () => void }) {
	useLang();
	const settings = useAppState((state) => state.settings);
	const [model, setModel] = useState(settings?.defaultModel);
	const [log, setLog] = useState(settings?.decisionLog ?? "");
	const logId = useId();
	const save = useAction(async () => {
		await saveSettings({
			...(model ? { defaultModel: model } : {}),
			decisionLog: log.trim() || null,
		});
		onClose();
	});
	const dirty =
		JSON.stringify(model) !== JSON.stringify(settings?.defaultModel) ||
		log.trim() !== (settings?.decisionLog ?? "");
	return (
		<Dialog
			title={t("defaultsTitle")}
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
						disabled={!dirty}
						onClick={() => void save.run()}
					>
						{t("save")}
					</Button>
				</>
			}
		>
			{model && (
				<Field label={t("defaultModel")} info={t("defaultModelHelp")}>
					<ModelPicker
						{...model}
						layout="grid"
						onChange={(patch) => setModel((current) => current && { ...current, ...patch })}
					/>
				</Field>
			)}
			<Field label={t("decisionLog")} htmlFor={logId} info={t("decisionLogHelp")}>
				<input
					id={logId}
					className="input"
					spellCheck={false}
					placeholder={t("decisionLogPlaceholder")}
					value={log}
					onChange={(event) => setLog(event.target.value)}
				/>
			</Field>
			<ErrorBox error={save.error} />
		</Dialog>
	);
}

function About() {
	useLang();
	const health = useAppState((state) => state.health);
	const [doc, setDoc] = useState<"privacy" | "terms" | null>(null);
	const paragraphs = (body: string) =>
		body.split("\n\n").map((paragraph) => <p key={paragraph.slice(0, 24)}>{paragraph}</p>);
	return (
		<section className="settings-section about" aria-labelledby="settings-about">
			<h2 id="settings-about" className="visually-hidden">
				{t("about")}
			</h2>
			{/* In the order of spec 2.2: lockup, version, the text, publisher, website; then 2.3. */}
			<div className="about-head">
				{/* Full lockup on the About page (spec 1.6), with a name that includes Tenon (1.7). */}
				<div className="lockup" role="img" aria-label={t("lockupName")}>
					<JigMark className="lockup-mark" size={22} />
					<span className="lockup-word">
						<span className="wordmark">Jig</span>
						<img
							className="lockup-tenon"
							src="/icons/tenon-mark.svg"
							alt=""
							width={14}
							height={14}
						/>
					</span>
				</div>
				<p className="about-version">
					{t("version", { v: health?.version ?? "" })}
					{health?.build ? ` · ${t("build", { b: health.build })}` : ""}
				</p>
			</div>
			<div className="about-text">{paragraphs(t("aboutBody"))}</div>
			<div className="about-list">
				<div className="about-row">
					<span className="about-label">{t("publisher")}</span>
					<span className="about-value">
						<img src="/icons/tenon-mark.svg" alt="" width={18} height={18} />
						<strong>{t("publisherName")}</strong>
					</span>
				</div>
				<div className="about-row">
					<span className="about-label">{t("website")}</span>
					<a href="https://tenon.asia/" target="_blank" rel="noopener noreferrer">
						tenon.asia
					</a>
				</div>
				<button type="button" className="about-row" onClick={() => setDoc("privacy")}>
					{t("privacyPolicy")}
					<ChevronIcon />
				</button>
				<button type="button" className="about-row" onClick={() => setDoc("terms")}>
					{t("terms")}
					<ChevronIcon />
				</button>
				<div className="about-row">
					<span className="about-label">{t("feedback")}</span>
					<a href="mailto:support@tenonai.cn">support@tenonai.cn</a>
				</div>
			</div>
			{doc && (
				<Dialog
					title={doc === "privacy" ? t("privacyPolicy") : t("terms")}
					size="l"
					onClose={() => setDoc(null)}
					footer={<Button onClick={() => setDoc(null)}>{t("close")}</Button>}
				>
					<p className="hint">{t("docVersion", { v: "1.1", date: t("policyDate") })}</p>
					{paragraphs(doc === "privacy" ? t("privacyPolicyBody") : t("termsBody"))}
				</Dialog>
			)}
		</section>
	);
}

/** The settings dialog that is open, if any; it covers the conversation without replacing it. */
export function SettingsDialogs() {
	useLang();
	const which = useAppState((state) => state.settingsDialog);
	const close = () => setState({ settingsDialog: null });
	if (which === "defaults") return <DefaultsDialog onClose={close} />;
	if (which === "providers" || which === "about") {
		return (
			<Dialog
				title={which === "providers" ? t("providers") : t("about")}
				size="l"
				onClose={close}
				footer={<Button onClick={close}>{t("close")}</Button>}
			>
				{which === "providers" ? <Providers /> : <About />}
			</Dialog>
		);
	}
	return null;
}

/**
 * The settings menu at the bottom of the sidebar (spec 10.3, 10.5): theme and language chosen right in
 * the menu, the rest in dialogs over the conversation, so the conversation is never replaced.
 * Cmd/Ctrl+, opens it, as in Claude.
 */
export function SettingsMenu({ variant }: { variant: "row" | "icon" }) {
	useLang();
	const settings = useAppState((state) => state.settings);
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === ",") {
				event.preventDefault();
				setOpen(true);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);
	const save = (patch: Parameters<typeof saveSettings>[0]) =>
		void saveSettings(patch).catch(() => {});
	const theme = settings?.theme ?? "system";
	const language = settings?.language ?? "system";
	const items: MenuEntry[] = [
		{
			group: t("theme"),
			items: (["system", "light", "dark"] as const).map((value) => ({
				id: `theme-${value}`,
				label: t(`theme_${value}`),
				checked: theme === value,
				onSelect: () => save({ theme: value }),
			})),
		},
		{
			group: t("language"),
			items: [
				{ id: "language-system", label: t("language_system"), value: "system" as const },
				{ id: "language-zh", label: "简体中文", value: "zh" as const },
				{ id: "language-en", label: "English", value: "en" as const },
			].map(({ id, label, value }) => ({
				id,
				label,
				checked: language === value,
				onSelect: () => save({ language: value }),
			})),
		},
		{ separator: true, id: "line-1" },
		{ label: t("providersMenu"), icon: <KeyIcon />, onSelect: () => openSettings("providers") },
		{ label: t("defaultsMenu"), icon: <SlidersIcon />, onSelect: () => openSettings("defaults") },
		{ separator: true, id: "line-2" },
		{ label: t("aboutMenu"), icon: <InfoIcon />, onSelect: () => openSettings("about") },
		{
			label: t("sendFeedback"),
			icon: <MailIcon />,
			onSelect: () => {
				window.location.href = "mailto:support@tenonai.cn";
			},
		},
	];
	return (
		<Menu
			label={t("settings")}
			items={items}
			open={open}
			onOpenChange={setOpen}
			width={240}
			trigger={
				variant === "row"
					? {
							className: "nav-row",
							title: `${t("settings")}（⌘,）`,
							content: (
								<>
									<GearIcon />
									{t("settings")}
								</>
							),
						}
					: { className: "btn btn-ghost btn-icon", title: t("settings"), content: <GearIcon /> }
			}
		/>
	);
}
