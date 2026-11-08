import { useState } from "react";
import {
	deleteCustomProvider,
	deleteKey,
	saveCustomProvider,
	saveKey,
	saveSettings,
} from "../actions.ts";
import { t, useLang } from "../i18n.ts";
import { type ProviderSummary, setState, useAppState } from "../state.ts";
import { ConfirmDialog, RulesEditor } from "./dialogs.tsx";
import { ChevronIcon, JigMark, PlusIcon } from "./icons.tsx";
import { ModelPicker, SidebarToggle } from "./session.tsx";
import { Button, Dialog, ErrorBox, Select, Switch, Toggletip, useAction } from "./ui.tsx";

export type SettingsTab = "general" | "providers" | "rules" | "about";

const TABS: SettingsTab[] = ["general", "providers", "rules", "about"];
const TAB_LABEL = {
	general: "general",
	providers: "providers",
	rules: "defaultRules",
	about: "about",
} as const;

function Row({
	label,
	info,
	children,
}: {
	label: string;
	info?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="setting-row">
			<div className="setting-label">
				<strong>
					{label}
					{info && <Toggletip label={label} text={info} />}
				</strong>
			</div>
			<div className="setting-control">{children}</div>
		</div>
	);
}

function General() {
	useLang();
	const settings = useAppState((state) => state.settings);
	const save = useAction(saveSettings);
	if (!settings) return null;
	return (
		<section className="settings-section" aria-labelledby="settings-general">
			<h2 id="settings-general">{t("general")}</h2>
			<Row label={t("theme")}>
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
			</Row>
			<Row label={t("language")}>
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
			</Row>
			<Row label={t("defaultModel")} info={t("defaultModelHelp")}>
				<ModelPicker
					{...settings.defaultModel}
					layout="grid"
					busy={save.busy}
					onChange={(patch) =>
						void save.run({ defaultModel: { ...settings.defaultModel, ...patch } })
					}
				/>
			</Row>
			<ErrorBox error={save.error} />
		</section>
	);
}

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
		<section className="settings-section" aria-labelledby="settings-providers">
			<h2 id="settings-providers">{t("providers")}</h2>
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

function Rules() {
	useLang();
	const settings = useAppState((state) => state.settings);
	const [rules, setRules] = useState(settings?.defaultRules ?? []);
	const save = useAction(saveSettings);
	const dirty = JSON.stringify(rules) !== JSON.stringify(settings?.defaultRules ?? []);
	return (
		<section className="settings-section" aria-labelledby="settings-rules">
			<h2 id="settings-rules">{t("defaultRules")}</h2>
			<p className="hint">{t("defaultRulesBody")}</p>
			<RulesEditor rules={rules} onChange={setRules} />
			<div className="request-actions">
				<Button
					variant="primary"
					busy={save.busy}
					disabled={!dirty}
					onClick={() => void save.run({ defaultRules: rules })}
				>
					{t("save")}
				</Button>
				{dirty && (
					<span className="hint" role="status">
						{t("unsavedChanges")}
					</span>
				)}
			</div>
			<ErrorBox error={save.error} />
		</section>
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
					<p className="hint">{t("docVersion", { v: "1.0", date: t("policyDate") })}</p>
					{paragraphs(doc === "privacy" ? t("privacyPolicyBody") : t("termsBody"))}
				</Dialog>
			)}
		</section>
	);
}

/** Settings as a page (spec 10.5, 2.1): categories on the left, the chosen one on the right. */
export function SettingsPage() {
	useLang();
	const tab = useAppState((state) => state.settingsTab);
	return (
		<main className="main settings-page" aria-label={t("settings")}>
			{/* Navigation and content sit together in the middle of the page; the whole page scrolls. */}
			<div className="settings-layout">
				<nav className="settings-nav" aria-label={t("settings")}>
					<SidebarToggle />
					<h1>{t("settings")}</h1>
					{TABS.map((id) => (
						<button
							key={id}
							type="button"
							aria-current={tab === id ? "page" : undefined}
							onClick={() => setState({ settingsTab: id })}
						>
							{t(TAB_LABEL[id])}
						</button>
					))}
				</nav>
				<div className="settings-content">
					{tab === "general" && <General />}
					{tab === "providers" && <Providers />}
					{tab === "rules" && <Rules />}
					{tab === "about" && <About />}
				</div>
			</div>
		</main>
	);
}
