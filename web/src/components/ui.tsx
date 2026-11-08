import {
	type ButtonHTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ApiError } from "../api.ts";
import { type MessageKey, t } from "../i18n.ts";
import { CloseIcon, InfoIcon } from "./icons.tsx";

/** Places a top-layer popover next to its trigger, flipping above when there is no room below (spec 5.9). */
function place(popover: HTMLElement, trigger: HTMLElement, width?: number): void {
	const rect = trigger.getBoundingClientRect();
	const margin = 16;
	const gap = 8;
	const w = width ?? Math.max(rect.width, popover.offsetWidth);
	popover.style.minWidth = `${Math.max(rect.width, 180)}px`;
	let left = Math.min(rect.left, window.innerWidth - w - margin);
	left = Math.max(margin, left);
	const below = window.innerHeight - rect.bottom - gap - margin;
	const height = popover.offsetHeight;
	const top =
		height > below && rect.top > below
			? Math.max(margin, rect.top - gap - height)
			: rect.bottom + gap;
	popover.style.left = `${left}px`;
	popover.style.top = `${top}px`;
}

export function Button({
	busy,
	variant = "default",
	children,
	disabled,
	...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	busy?: boolean;
	variant?: "default" | "primary" | "danger" | "ghost" | "icon";
}) {
	const classes = [
		"btn",
		variant === "default" ? "" : `btn-${variant}`,
		variant === "icon" ? "btn-ghost" : "",
	];
	return (
		<button
			type="button"
			{...rest}
			className={`${classes.join(" ")} ${rest.className ?? ""}`.trim()}
			disabled={disabled || busy}
			aria-busy={busy ? "true" : undefined}
		>
			{children}
		</button>
	);
}

/**
 * Runs an async action from a button: shows the loading state at once and blocks a second submit
 * until it settles (spec 4.7–4.8). Errors are kept for display.
 */
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<unknown>) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const running = useRef(false);
	const run = useCallback(
		async (...args: A) => {
			if (running.current) return false;
			running.current = true;
			setBusy(true);
			setError(null);
			try {
				await action(...args);
				return true;
			} catch (caught) {
				setError(caught);
				return false;
			} finally {
				running.current = false;
				setBusy(false);
			}
		},
		[action],
	);
	return { run, busy, error, setError };
}

const FIELD_MESSAGES: Record<string, MessageKey> = {
	name: "err_field_name",
	cwd: "err_field_cwd",
	text: "err_field_text",
	decision: "err_field_decision",
	answer: "err_field_answer",
	options: "err_field_options",
	key: "err_field_key",
	id: "err_field_id",
	baseUrl: "err_field_baseUrl",
	models: "err_field_models",
	rules: "err_field_rules",
	workspaces: "err_field_workspaces",
	model: "err_field_model",
	provider: "err_field_model",
};

const CODE_MESSAGES: Record<string, MessageKey> = {
	network: "err_network",
	"sign-in-required": "err_signin",
	"invalid-login-token": "err_signin",
	"not-found": "err_notFound",
	"internal-error": "err_internal",
	"session-busy": "err_sessionBusy",
	"session-archived": "err_sessionArchived",
	"nothing-to-continue": "err_nothingToContinue",
	"already-answered": "err_alreadyAnswered",
	"already-delivered": "err_alreadyDelivered",
	"not-supported": "err_noPicker",
	"picker-failed": "err_pickerFailed",
};

/** What went wrong and what to do, in the interface language (spec 4.1, 12.2); server text is a fallback. */
export function describeError(error: unknown): string {
	if (!(error instanceof ApiError)) return t("err_unknown");
	if (error.code === "missing-api-key")
		return t("err_missingKey", { provider: error.provider ?? "" });
	if (error.code === "conflict" && error.field === "name") return t("nameTaken");
	if (error.field && FIELD_MESSAGES[error.field])
		return t(FIELD_MESSAGES[error.field] as MessageKey);
	const known = CODE_MESSAGES[error.code];
	if (known) return t(known);
	if (error.status === 400 || error.status === 422) return t("err_invalid");
	return t("err_unknown");
}

export function ErrorBox({ error }: { error: unknown }) {
	const [copied, setCopied] = useState(false);
	if (!error) return null;
	const requestId = error instanceof ApiError ? error.requestId : undefined;
	return (
		<div className="error-box" role="alert">
			<strong>{t("errorTitle")}</strong>
			<span>{describeError(error)}</span>
			{requestId && (
				<span className="hint error-id">
					{t("requestId")}: <code className="error-code">{requestId}</code>
					<Button
						variant="ghost"
						onClick={() => {
							void navigator.clipboard?.writeText(requestId).then(() => setCopied(true));
						}}
					>
						{copied ? t("copied") : t("copyRequestId")}
					</Button>
				</span>
			)}
		</div>
	);
}

export function Switch({
	checked,
	onChange,
	label,
	disabled,
	busy,
	info,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
	disabled?: boolean;
	busy?: boolean;
	info?: string;
}) {
	return (
		<span className="field-label">
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				className="switch"
				disabled={disabled || busy}
				aria-busy={busy ? "true" : undefined}
				onClick={() => onChange(!checked)}
			>
				<span className="switch-track" aria-hidden="true">
					<span className="switch-thumb" />
				</span>
				<span>{label}</span>
			</button>
			{info && <Toggletip label={label} text={info} />}
		</span>
	);
}

/** The ⓘ button and its click-to-open explanation (spec 5). */
export function Toggletip({ label, text }: { label: string; text: string }) {
	const [open, setOpen] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const pop = useRef<HTMLDivElement>(null);
	const id = useId();
	const hover = useRef(false);

	useLayoutEffect(() => {
		const element = pop.current;
		if (!element || !button.current) return;
		if (open) {
			element.showPopover?.();
			place(element, button.current, 260);
		} else if (element.matches(":popover-open")) {
			element.hidePopover?.();
		}
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && setOpen(false);
		const onDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!pop.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onDown);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onDown);
		};
	}, [open]);

	const hoverable = window.matchMedia("(hover: hover)").matches;
	return (
		<>
			<button
				ref={button}
				type="button"
				className="info-button"
				aria-label={t("infoAbout", { label })}
				aria-expanded={open}
				aria-describedby={open ? id : undefined}
				onClick={() => setOpen((value) => !value)}
				onFocus={() => hoverable && setOpen(true)}
				onMouseEnter={() => {
					if (!hoverable) return;
					hover.current = true;
					setOpen(true);
				}}
				onMouseLeave={() => {
					hover.current = false;
				}}
			>
				<InfoIcon />
			</button>
			<div ref={pop} id={id} popover="manual" className="toggletip" role="tooltip">
				{text}
			</div>
		</>
	);
}

export interface Option {
	value: string;
	label: string;
	group?: string;
}

/** A select-only combobox with its own listbox (WAI-ARIA APG; spec 7.2). */
export function Select({
	value,
	options,
	onChange,
	label,
	labelledBy,
	disabled,
	busy,
}: {
	value: string;
	options: Option[];
	onChange: (value: string) => void;
	label?: string;
	labelledBy?: string;
	disabled?: boolean;
	busy?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const trigger = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const id = useId();
	const selected = options.find((option) => option.value === value);

	useLayoutEffect(() => {
		const element = list.current;
		if (!element || !trigger.current) return;
		if (open) {
			element.showPopover?.();
			place(element, trigger.current);
			element.querySelector(".active")?.scrollIntoView({ block: "nearest" });
		} else if (element.matches(":popover-open")) {
			element.hidePopover?.();
		}
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!list.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: keeps the active option visible when it changes
	useEffect(() => {
		list.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const openList = () => {
		setActive(
			Math.max(
				0,
				options.findIndex((option) => option.value === value),
			),
		);
		setOpen(true);
	};
	const choose = (index: number) => {
		const option = options[index];
		setOpen(false);
		trigger.current?.focus();
		if (option && option.value !== value) onChange(option.value);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (!open) {
			if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
				event.preventDefault();
				openList();
			}
			return;
		}
		if (event.key === "Escape" || event.key === "Tab") {
			setOpen(false);
			return;
		}
		event.preventDefault();
		if (event.key === "ArrowDown") setActive((i) => Math.min(options.length - 1, i + 1));
		else if (event.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
		else if (event.key === "Home") setActive(0);
		else if (event.key === "End") setActive(options.length - 1);
		else if (event.key === "Enter" || event.key === " ") choose(active);
	};

	let lastGroup: string | undefined;
	return (
		<>
			<button
				ref={trigger}
				type="button"
				role="combobox"
				className="btn select-trigger"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={id}
				aria-label={label}
				aria-labelledby={labelledBy}
				aria-activedescendant={open ? `${id}-${active}` : undefined}
				disabled={disabled || busy}
				aria-busy={busy ? "true" : undefined}
				onClick={() => (open ? setOpen(false) : openList())}
				onKeyDown={onKeyDown}
			>
				<span>{selected?.label ?? value}</span>
			</button>
			<div
				ref={list}
				id={id}
				role="listbox"
				popover="manual"
				className="listbox"
				aria-label={label}
			>
				{options.map((option, index) => {
					const heading = option.group && option.group !== lastGroup ? option.group : null;
					lastGroup = option.group;
					return [
						heading && (
							<div key={`g-${option.group}`} className="group-label" role="presentation">
								{heading}
							</div>
						),
						// biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the combobox, which owns focus (APG active-descendant pattern)
						<div
							key={option.value}
							id={`${id}-${index}`}
							role="option"
							tabIndex={-1}
							aria-selected={option.value === value}
							className={index === active ? "active" : undefined}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => choose(index)}
							onMouseMove={() => setActive(index)}
						>
							{option.label}
						</div>,
					];
				})}
			</div>
		</>
	);
}

/** An actions menu behind a "…" button (APG menu button). */
export function Menu({
	label,
	items,
}: {
	label: string;
	items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const id = useId();

	useLayoutEffect(() => {
		const element = menu.current;
		if (!element || !trigger.current) return;
		if (open) {
			element.showPopover?.();
			place(element, trigger.current, 200);
			(element.querySelector("[role=menuitem]") as HTMLElement | null)?.focus();
		} else if (element.matches(":popover-open")) {
			element.hidePopover?.();
		}
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	const onKeyDown = (event: KeyboardEvent) => {
		const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
		const index = entries.indexOf(document.activeElement as HTMLElement);
		if (event.key === "Escape") {
			setOpen(false);
			trigger.current?.focus();
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			entries[(index + 1) % entries.length]?.focus();
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			entries[(index - 1 + entries.length) % entries.length]?.focus();
		} else if (event.key === "Tab") {
			setOpen(false);
		}
	};

	return (
		<>
			<button
				ref={trigger}
				type="button"
				className="btn btn-ghost btn-icon"
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={id}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((value) => !value);
				}}
			>
				<span aria-hidden="true">⋯</span>
			</button>
			<div ref={menu} id={id} role="menu" popover="manual" className="menu" onKeyDown={onKeyDown}>
				{items.map((item) => (
					<button
						key={item.label}
						type="button"
						role="menuitem"
						tabIndex={-1}
						className={item.danger ? "menu-danger" : undefined}
						onClick={(event) => {
							event.stopPropagation();
							setOpen(false);
							item.onSelect();
						}}
					>
						{item.label}
					</button>
				))}
			</div>
		</>
	);
}

/** A modal dialog with a fixed size tier; only the body scrolls (spec 9). */
export function Dialog({
	title,
	size,
	onClose,
	children,
	footer,
	tabs,
}: {
	title: string;
	size: "s" | "m" | "l";
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	tabs?: ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		dialog.showModal();
		document.body.classList.add("scroll-locked");
		return () => {
			document.body.classList.remove("scroll-locked");
			if (dialog.open) dialog.close();
		};
	}, []);
	return (
		<dialog
			ref={ref}
			className={`dialog dialog-${size}`}
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<div
				className="dialog-frame"
				style={tabs ? { gridTemplateRows: "auto auto 1fr auto" } : undefined}
			>
				<div className="dialog-header">
					<h2 id={titleId}>{title}</h2>
					<Button variant="icon" aria-label={t("close")} onClick={onClose}>
						<CloseIcon />
					</Button>
				</div>
				{tabs}
				<div className="dialog-body">{children}</div>
				<div className="dialog-footer">{footer}</div>
			</div>
		</dialog>
	);
}

export function Field({
	label,
	children,
	error,
	info,
	htmlFor,
	labelId,
	errorId,
}: {
	label: string;
	children: ReactNode;
	error?: string | null;
	info?: string;
	htmlFor?: string;
	labelId?: string;
	/** Give the input `aria-describedby={errorId}` so the error is read with it (spec 18.3). */
	errorId?: string;
}) {
	return (
		<div className="field">
			<span className="field-label">
				<label htmlFor={htmlFor} id={labelId}>
					{label}
				</label>
				{info && <Toggletip label={label} text={info} />}
			</span>
			{children}
			{error && (
				<span id={errorId} className="field-error">
					{error}
				</span>
			)}
		</div>
	);
}
