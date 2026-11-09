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
import { CloseIcon, InfoIcon, SubmenuIcon } from "./icons.tsx";

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
	/** A second, quieter line in the list that says what the choice does. */
	hint?: string;
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

	// Keys move the active option and the list scrolls to keep it in view. The pointer only marks the
	// option under it: scrolling then would move the list under the pointer (founder, 2026-11-09).
	const byKey = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the active option changes
	useEffect(() => {
		if (!byKey.current) return;
		byKey.current = false;
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
		byKey.current = true;
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
							{option.hint ? (
								<span className="option-text">
									<span>{option.label}</span>
									<span className="option-hint">{option.hint}</span>
								</span>
							) : (
								option.label
							)}
						</div>,
					];
				})}
			</div>
		</>
	);
}

export interface MenuItem {
	label: string;
	/** What choosing the item does; an item with `items` opens them instead. */
	onSelect?: () => void;
	/** A submenu, opened beside the item (as in Claude's session menu). */
	items?: MenuEntry[];
	/** Distinguishes items with the same label in different groups. */
	id?: string;
	danger?: boolean;
	/** Set for a choice among options (menuitemradio); a check marks the current one. */
	checked?: boolean;
	icon?: ReactNode;
}

/** A menu entry: an item, a line between sections, or a labelled group of choices. */
export type MenuEntry =
	| MenuItem
	| { separator: true; id: string }
	| { group: string; items: MenuItem[] };

/** Puts a submenu beside the item that opened it: to the right, or to the left when there is no room. */
function placeBeside(popover: HTMLElement, anchor: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	const margin = 8;
	const width = popover.offsetWidth;
	const height = popover.offsetHeight;
	let left = rect.right + 6;
	if (left + width > window.innerWidth - margin) left = Math.max(margin, rect.left - width - 6);
	const top = Math.max(margin, Math.min(rect.top - 6, window.innerHeight - margin - height));
	popover.style.left = `${left}px`;
	popover.style.top = `${top}px`;
}

function MenuItemButton({
	item,
	close,
	onPointerEnter,
	submenu,
}: {
	item: MenuItem;
	close: () => void;
	onPointerEnter?: (button: HTMLButtonElement) => void;
	/** For an item with a submenu: whether it is open, and how to open it. */
	submenu?: { open: boolean; show: (button: HTMLButtonElement, focusFirst: boolean) => void };
}) {
	const onClick = (event: { stopPropagation(): void; currentTarget: HTMLButtonElement }) => {
		event.stopPropagation();
		if (submenu) {
			submenu.show(event.currentTarget, true);
			return;
		}
		close();
		item.onSelect?.();
	};
	if (submenu) {
		return (
			<button
				type="button"
				role="menuitem"
				tabIndex={-1}
				aria-haspopup="menu"
				aria-expanded={submenu.open}
				className="menu-parent"
				onClick={onClick}
				onPointerEnter={(event) => submenu.show(event.currentTarget, false)}
				onKeyDown={(event) => {
					if (event.key === "ArrowRight") {
						event.preventDefault();
						event.stopPropagation();
						submenu.show(event.currentTarget, true);
					}
				}}
			>
				{item.icon}
				<span className="menu-label">{item.label}</span>
				<SubmenuIcon />
			</button>
		);
	}
	const content = (
		<>
			{item.icon}
			<span className="menu-label">{item.label}</span>
			{item.checked && (
				<span className="menu-check" aria-hidden="true">
					✓
				</span>
			)}
		</>
	);
	if (item.checked !== undefined) {
		return (
			<button
				type="button"
				role="menuitemradio"
				aria-checked={item.checked}
				tabIndex={-1}
				onClick={onClick}
				onPointerEnter={(event) => onPointerEnter?.(event.currentTarget)}
			>
				{content}
			</button>
		);
	}
	return (
		<button
			type="button"
			role="menuitem"
			tabIndex={-1}
			className={item.danger ? "menu-danger" : undefined}
			onClick={onClick}
			onPointerEnter={(event) => onPointerEnter?.(event.currentTarget)}
		>
			{content}
		</button>
	);
}

/** Separators, groups and items, as one menu level shows them. */
function MenuEntries({
	entries,
	render,
}: {
	entries: MenuEntry[];
	render: (item: MenuItem, key: string) => ReactNode;
}) {
	return (
		<>
			{entries.map((entry) => {
				if ("separator" in entry) return <hr key={entry.id} className="menu-separator" />;
				if ("group" in entry) {
					return (
						// biome-ignore lint/a11y/useSemanticElements: a group of menu items is role="group" in the APG menu pattern; a fieldset does not belong in a menu
						<div key={entry.group} role="group" aria-label={entry.group}>
							<div className="menu-heading" aria-hidden="true">
								{entry.group}
							</div>
							{entry.items.map((item) => render(item, item.id ?? item.label))}
						</div>
					);
				}
				return render(entry, entry.id ?? entry.label);
			})}
		</>
	);
}

/**
 * A menu behind a button (APG menu button): by default a "…" icon button, or a visible trigger such as
 * the sidebar's settings row. It can be opened from outside (a keyboard shortcut) through `open`.
 */
export function Menu({
	label,
	items,
	trigger,
	open: controlled,
	onOpenChange,
	width = 200,
}: {
	label: string;
	items: MenuEntry[];
	trigger?: { className: string; content: ReactNode; title?: string };
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	width?: number;
}) {
	const [own, setOwn] = useState(false);
	const open = controlled ?? own;
	const setOpen = (next: boolean) => {
		if (controlled === undefined) setOwn(next);
		onOpenChange?.(next);
	};
	const button = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const subMenu = useRef<HTMLDivElement>(null);
	const id = useId();
	// The open submenu: which item opened it, and whether its first item takes the focus (keyboard).
	const [sub, setSub] = useState<{ key: string; anchor: HTMLButtonElement; focus: boolean } | null>(
		null,
	);

	useLayoutEffect(() => {
		const element = menu.current;
		if (!element || !button.current) return;
		if (open) {
			element.showPopover?.();
			place(element, button.current, width);
			(element.querySelector("[role^=menuitem]") as HTMLElement | null)?.focus();
		} else if (element.matches(":popover-open")) {
			element.hidePopover?.();
		}
		if (!open) setSub(null);
	}, [open, width]);

	useLayoutEffect(() => {
		const element = subMenu.current;
		if (!element || !sub) return;
		element.showPopover?.();
		placeBeside(element, sub.anchor);
		if (sub.focus) (element.querySelector("[role^=menuitem]") as HTMLElement | null)?.focus();
	}, [sub]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: setOpen is rebuilt each render; the listener only needs to follow `open`
	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			const target = event.target as Node;
			const inside =
				menu.current?.contains(target) ||
				subMenu.current?.contains(target) ||
				button.current?.contains(target);
			if (!inside) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	const onKeyDown = (event: KeyboardEvent) => {
		const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
		const index = entries.indexOf(document.activeElement as HTMLElement);
		if (event.key === "Escape") {
			setOpen(false);
			button.current?.focus();
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
	const close = () => setOpen(false);
	const subItems = sub
		? (items.find(
				(entry): entry is MenuItem =>
					!("separator" in entry) && !("group" in entry) && (entry.id ?? entry.label) === sub.key,
			)?.items ?? null)
		: null;
	const onSubKeyDown = (event: KeyboardEvent) => {
		const entries = [...(subMenu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
		const index = entries.indexOf(document.activeElement as HTMLElement);
		if (event.key === "Escape" || event.key === "ArrowLeft") {
			event.preventDefault();
			event.stopPropagation();
			const anchor = sub?.anchor;
			setSub(null);
			anchor?.focus();
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
	const renderItem = (item: MenuItem, key: string) =>
		item.items ? (
			<MenuItemButton
				key={key}
				item={item}
				close={close}
				submenu={{
					open: sub?.key === key,
					show: (anchor, focus) => setSub({ key, anchor, focus }),
				}}
			/>
		) : (
			<MenuItemButton
				key={key}
				item={item}
				close={close}
				// Moving onto a plain item closes an open submenu, as menus do elsewhere.
				onPointerEnter={() => setSub(null)}
			/>
		);

	return (
		<>
			<button
				ref={button}
				type="button"
				className={trigger?.className ?? "btn btn-ghost btn-icon"}
				title={trigger?.title}
				aria-label={trigger ? undefined : label}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={id}
				onClick={(event) => {
					event.stopPropagation();
					setOpen(!open);
				}}
			>
				{trigger ? trigger.content : <span aria-hidden="true">⋯</span>}
			</button>
			<div
				ref={menu}
				id={id}
				role="menu"
				aria-label={label}
				popover="manual"
				className="menu"
				onKeyDown={onKeyDown}
			>
				<MenuEntries entries={items} render={renderItem} />
			</div>
			{open && sub && subItems && (
				<div
					ref={subMenu}
					role="menu"
					aria-label={sub.anchor.textContent ?? label}
					popover="manual"
					className="menu submenu"
					onKeyDown={onSubKeyDown}
				>
					<MenuEntries
						entries={subItems}
						render={(item, key) => <MenuItemButton key={key} item={item} close={close} />}
					/>
				</div>
			)}
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
