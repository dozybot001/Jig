import { dirname } from "node:path";
import {
	type ConfirmReason,
	DECISION_REASONS,
	type PermissionNote,
	type PermissionRequest,
	type PermissionRule,
	permissionModeOf,
	type RuleEffect,
	type Session,
} from "../../shared/types.ts";
import {
	canonical,
	isInside,
	isSecretPath,
	pathMatches,
	resolvePath,
	secretLocations,
} from "./paths.ts";
import {
	isReadOnly,
	matchesPrefix,
	mustConfirmReason,
	parseShell,
	pathArguments,
	rememberPrefix,
	unwrap,
} from "./shell.ts";

/** What a tool call touches, as far as permissions are concerned. Tools describe themselves this way. */
export type Subject =
	| { kind: "none" }
	| { kind: "read"; tool: string; paths: string[]; summary: string }
	| { kind: "write"; tool: string; paths: string[]; summary: string }
	/** `outsideSandbox`: the command asks to run outside the system sandbox, so it asks every time. */
	| { kind: "command"; tool: string; command: string; outsideSandbox?: boolean }
	| { kind: "url"; tool: string; url: string }
	/**
	 * Something that is neither a file, a command nor a URL, such as opening a session. `scope` names
	 * what "always allow" remembers; `always` asks in every mode; `reasons` make it must-confirm.
	 */
	| {
			kind: "act";
			tool: string;
			summary: string;
			scope?: string;
			always?: boolean;
			reasons?: ConfirmReason[];
			/** Shown with "always allow" (see PermissionRequest.warning). */
			warning?: "acts-as-you";
	  };

export type Decision =
	/** `note`: skip mode let a risky call run, or the review allowed it (shown on its row). */
	| { effect: "allow"; note?: PermissionNote }
	| { effect: "deny"; reason: string }
	| {
			effect: "ask";
			request: PermissionRequest;
			/** Review mode: the check by the model decides first; the person is asked if it does not allow. */
			review?: boolean;
			/** Asked because a rule of the session says so; not left to the check. */
			byRule?: boolean;
			/** A command Yew cannot read. */
			unreadable?: boolean;
	  };

const SAFE_REDIRECT_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "&1", "&2", "-"]);

/**
 * The rules a new session takes over from the one it was opened by or copied from. "Always allow"
 * for the tools of Yew's own browser and computer control was given for one session, with its scope
 * said at the time (spec 21.2): it does not travel.
 */
export function inheritableRules(rules: PermissionRule[]): PermissionRule[] {
	return rules.filter(
		(rule) => !(rule.effect === "allow" && /^mcp__(browser|computer)__/.test(rule.tool)),
	);
}

function strongest(effects: RuleEffect[]): RuleEffect | null {
	if (effects.includes("deny")) return "deny";
	if (effects.includes("ask")) return "ask";
	if (effects.includes("allow")) return "allow";
	return null;
}

/**
 * Decides whether a tool call may run, must be asked about, or is refused (M1 plan, section 8;
 * blueprint 6.1, item 6). Order: credential locations are refused; operations asked about every time
 * cannot be remembered; then the session's rules, where deny beats ask beats allow; then the
 * built-in defaults. What is asked is then settled by its kind and the session's mode: a decision
 * (审批: DECISION_REASONS) is the person's in every mode; a permission (授权) is asked in the default
 * mode, goes to the check first in review mode, and runs with its risk marked in skip mode.
 * Text in the transcript never counts as approval: only the person's answer in Yew does.
 */
export class PermissionEngine {
	readonly #secrets: string[];
	/** Yew's own data folder: a command that names it could change decisions. */
	readonly #home: string;
	/** Folders outside the working folder that may be read without asking: memory and skill folders. */
	readRoots: () => string[] = () => [];
	/** Folders the person keeps from sessions (the settings): refused like credential locations. */
	hidden: () => string[] = () => [];
	/**
	 * Whether commands outside the sandbox run in the guard (guard.ts). Without it, running outside
	 * the sandbox is asked about in every mode: such a command could answer a decision itself.
	 */
	guarded: () => boolean = () => false;

	constructor(yewHome: string) {
		this.#secrets = secretLocations(yewHome);
		this.#home = canonical(yewHome);
	}

	/** Credential locations, Yew's own data and the folders the person keeps from sessions. */
	#offLimits(): string[] {
		return [...this.#secrets, ...this.hidden().map(canonical)];
	}

	/** Whether sessions may never read or change `path` (an absolute path). */
	offLimits(path: string): boolean {
		return isSecretPath(path, this.#offLimits());
	}

	/**
	 * `flagged` is the model's own judgment, through the `confirm` argument: in the automatic mode a
	 * flagged call is asked about, others run. Must-confirm operations, explicit "ask" rules and commands
	 * Yew cannot read are asked about in every mode.
	 */
	decide(subject: Subject, session: Session, flagged = false): Decision {
		const decision = this.#decide(subject, session, flagged);
		if (decision.effect !== "ask") return decision;
		const reasons = decision.request.reasons ?? [];
		const always = (reason: ConfirmReason) =>
			DECISION_REASONS.has(reason) || (reason === "outside-sandbox" && !this.guarded());
		if (reasons.some(always)) {
			decision.request.matter = true;
			return decision;
		}
		if (session.options.readerOnly) return decision;
		const mode = permissionModeOf(session.options);
		if (mode === "skip") {
			const risk: ConfirmReason[] =
				reasons.length > 0 ? reasons : decision.unreadable ? ["unreadable-command"] : [];
			return risk.length > 0 ? { effect: "allow", note: { risk } } : { effect: "allow" };
		}
		if (mode === "review" && !flagged && !decision.byRule) return { ...decision, review: true };
		return decision;
	}

	#decide(subject: Subject, session: Session, flagged: boolean): Decision {
		switch (subject.kind) {
			case "none":
				return { effect: "allow" };
			case "read":
			case "write":
				return this.#files(subject, session, flagged);
			case "command":
				return this.#command(subject, session, flagged);
			case "url":
				return this.#url(subject, session, flagged);
			case "act":
				return this.#act(subject, session, flagged);
		}
	}

	/** An approval Yew asks for only by default; the session's mode settles it. */
	#byDefault(
		session: Session,
		flagged: boolean,
		tool: string,
		summary: string,
		remember?: PermissionRule[],
	): Decision {
		// What the model marks with confirm is asked about; skip mode asks nothing.
		const skip = permissionModeOf(session.options) === "skip";
		if (!session.options.readerOnly && (!flagged || skip)) return { effect: "allow" };
		return this.#ask(tool, summary, undefined, remember);
	}

	#rulesFor(
		session: Session,
		tool: string,
		matches: (rule: PermissionRule) => boolean,
	): RuleEffect | null {
		const effects = session.rules
			.filter(
				(rule) => (rule.tool === tool || rule.tool === "*") && (!rule.pattern || matches(rule)),
			)
			.map((rule) => rule.effect);
		return strongest(effects);
	}

	/** Folders this session may change without asking: its working folder plus writable extraDirs. */
	#writableDirs(session: Session): string[] {
		const dirs: string[] = [];
		if (session.cwd) dirs.push(session.cwd);
		for (const extra of session.options.extraDirs ?? []) {
			if (extra.access === "write") dirs.push(extra.path);
		}
		return dirs;
	}

	/** Folders this session may read without asking: its working folder plus all extraDirs. */
	#readableDirs(session: Session): string[] {
		const dirs: string[] = [];
		if (session.cwd) dirs.push(session.cwd);
		for (const extra of session.options.extraDirs ?? []) dirs.push(extra.path);
		return dirs;
	}

	#files(
		subject: Extract<Subject, { kind: "read" | "write" }>,
		session: Session,
		flagged: boolean,
	): Decision {
		const cwd = session.cwd;
		for (const path of subject.paths) {
			const verb = subject.kind === "read" ? "read" : "change";
			if (isSecretPath(path, this.#secrets)) {
				return {
					effect: "deny",
					reason: `${path} holds credentials or Yew's own data; sessions cannot ${verb} it.`,
				};
			}
			if (this.offLimits(path)) {
				return {
					effect: "deny",
					reason: `${path} is in a folder the person keeps from sessions; sessions cannot ${verb} it.`,
				};
			}
		}
		const effects = subject.paths.map((path) =>
			this.#rulesFor(session, subject.tool, (rule) => pathMatches(path, rule.pattern ?? "", cwd)),
		);
		if (effects.includes("deny")) {
			return { effect: "deny", reason: "A rule in this session refuses this." };
		}
		const writable = this.#writableDirs(session);
		const outside = subject.paths.filter((path) => !writable.some((dir) => isInside(path, dir)));

		if (subject.kind === "write") {
			if (outside.length > 0) {
				return this.#ask(subject.tool, subject.summary, ["write-outside"]);
			}
			if (effects.includes("ask")) return this.#byRule(subject.tool, subject.summary);
			if (effects.every((effect) => effect === "allow")) return { effect: "allow" };
			return this.#byDefault(session, flagged, subject.tool, subject.summary, [
				{ effect: "allow", tool: subject.tool, pattern: "**" },
			]);
		}

		if (effects.includes("ask")) return this.#byRule(subject.tool, subject.summary);
		const roots = [...this.#readableDirs(session), ...this.readRoots()];
		const needed = subject.paths.filter(
			(path, index) => effects[index] !== "allow" && !roots.some((root) => isInside(path, root)),
		);
		if (needed.length === 0) return { effect: "allow" };
		// Remember the folder: allowing ~/memory/a.md once usually means the person trusts ~/memory.
		const folders = [
			...new Set(needed.map((path) => (subject.tool === "read" ? dirname(path) : path))),
		];
		return this.#byDefault(
			session,
			flagged,
			subject.tool,
			subject.summary,
			folders.map((pattern) => ({ effect: "allow" as const, tool: subject.tool, pattern })),
		);
	}

	#command(
		subject: Extract<Subject, { kind: "command" }>,
		session: Session,
		flagged: boolean,
	): Decision {
		const cwd = session.cwd;
		const parsed = parseShell(subject.command);
		const commands: string[][] = [];
		let privileged = false;
		let understood = parsed.understood;
		let dynamic = false;
		const redirectTargets: string[] = [];
		for (const segment of parsed.segments) {
			dynamic ||= segment.dynamic;
			for (const redirect of segment.redirects) {
				const duplicatesDescriptor = redirect.op.endsWith("&") && /^(\d+|-)$/.test(redirect.target);
				if (
					redirect.op.includes(">") &&
					!duplicatesDescriptor &&
					!SAFE_REDIRECT_TARGETS.has(redirect.target)
				) {
					redirectTargets.push(redirect.target);
				}
			}
			const inner = unwrap(segment.argv);
			commands.push(...inner.commands);
			privileged ||= inner.privileged;
			understood &&= inner.understood;
		}

		const writable = this.#writableDirs(session);
		const readable = this.#readableDirs(session);
		const reasons = new Set<ConfirmReason>();
		for (const argv of commands) {
			const reason = mustConfirmReason(argv);
			// Deleting outside the working folder (or writable extraDirs) cannot be undone with git: the person decides.
			if (reason === "delete-files" && !this.#allInside(argv, cwd, writable)) {
				reasons.add("delete-outside");
			} else if (reason) reasons.add(reason);
			// File tools cannot touch these places at all; a command that names one asks.
			for (const arg of pathArguments(argv)) {
				const path = resolvePath(arg, cwd);
				const kind = path === null ? null : this.#placeOf(path);
				if (kind) reasons.add(kind);
			}
		}
		if (privileged) reasons.add("admin");
		if (subject.outsideSandbox) reasons.add("outside-sandbox");
		for (const target of redirectTargets) {
			const path = resolvePath(target, cwd);
			const kind = path === null ? null : this.#placeOf(path);
			if (kind === "yew-data" || kind === "hidden-folder") reasons.add(kind);
			else if (!path || !writable.some((dir) => isInside(path, dir))) reasons.add("write-outside");
			else if (kind) reasons.add("write-credentials");
		}

		const ruleFor = (argv: string[]) =>
			this.#rulesFor(session, subject.tool, (r) => matchesPrefix(argv, r.pattern ?? ""));
		if (commands.some((argv) => ruleFor(argv) === "deny")) {
			return { effect: "deny", reason: "A rule in this session refuses this command." };
		}
		if (reasons.size > 0) return this.#ask(subject.tool, subject.command, [...reasons]);
		if (!understood || dynamic)
			return { ...this.#ask(subject.tool, subject.command), unreadable: true };

		const pending: string[][] = [];
		let ruleAsks = false;
		for (const argv of commands) {
			const rule = ruleFor(argv);
			if (rule === "ask") ruleAsks = true;
			if (rule === "allow") continue;
			if (rule === null && this.#readOnlyHere(argv, cwd, readable)) continue;
			pending.push(argv);
		}
		if (ruleAsks) return this.#byRule(subject.tool, subject.command);
		if (redirectTargets.length === 0 && pending.length === 0) return { effect: "allow" };
		const remember = [...new Set(pending.map(rememberPrefix))].map((pattern) => ({
			effect: "allow" as const,
			tool: subject.tool,
			pattern,
		}));
		return this.#byDefault(
			session,
			flagged,
			subject.tool,
			subject.command,
			pending.length === 0 ? undefined : remember,
		);
	}

	/**
	 * Which kind of place sessions may not touch a path is in: Yew's own data and the folders the
	 * person keeps from sessions are asked about in every mode; other credential locations are a
	 * permission. Null for anywhere else.
	 */
	#placeOf(path: string): "yew-data" | "hidden-folder" | "credentials" | null {
		if (isInside(path, this.#home)) return "yew-data";
		if (isSecretPath(path, this.hidden().map(canonical))) return "hidden-folder";
		if (isSecretPath(path, this.#offLimits())) return "credentials";
		return null;
	}

	/** Whether every path a command names is inside one of `roots` (`host:path` never is). */
	#allInside(argv: string[], cwd: string | null, roots: string[]): boolean {
		if (roots.length === 0) return false;
		return pathArguments(argv).every((arg) => {
			if (/^[^/]*:/.test(arg)) return false;
			const path = resolvePath(arg, cwd);
			return path !== null && roots.some((dir) => isInside(path, dir));
		});
	}

	#readOnlyHere(argv: string[], cwd: string | null, roots: string[]): boolean {
		if (roots.length === 0 || !isReadOnly(argv)) return false;
		return pathArguments(argv).every((arg) => {
			const path = resolvePath(arg, cwd);
			return (
				path !== null &&
				roots.some((dir) => isInside(path, dir)) &&
				!isSecretPath(path, this.#offLimits())
			);
		});
	}

	#url(subject: Extract<Subject, { kind: "url" }>, session: Session, flagged: boolean): Decision {
		let host: string;
		try {
			host = new URL(subject.url).hostname.toLowerCase();
		} catch {
			return { effect: "deny", reason: "This is not a valid URL." };
		}
		const rule = this.#rulesFor(session, subject.tool, (r) => {
			const pattern = (r.pattern ?? "").toLowerCase();
			return pattern.startsWith("*.")
				? host.endsWith(pattern.slice(1)) || host === pattern.slice(2)
				: host === pattern;
		});
		if (rule === "deny")
			return { effect: "deny", reason: `A rule in this session refuses ${host}.` };
		if (rule === "allow") return { effect: "allow" };
		if (rule === "ask") return this.#byRule(subject.tool, subject.url);
		return this.#byDefault(session, flagged, subject.tool, subject.url, [
			{ effect: "allow", tool: subject.tool, pattern: host },
		]);
	}

	#act(subject: Extract<Subject, { kind: "act" }>, session: Session, flagged: boolean): Decision {
		const rule = this.#rulesFor(
			session,
			subject.tool,
			(r) => !r.pattern || r.pattern === subject.scope,
		);
		if (rule === "deny") return { effect: "deny", reason: "A rule in this session refuses this." };
		if (subject.reasons && subject.reasons.length > 0) {
			return this.#ask(subject.tool, subject.summary, subject.reasons);
		}
		if (rule === "allow") return { effect: "allow" };
		const remember: PermissionRule[] = [
			subject.scope
				? { effect: "allow", tool: subject.tool, pattern: subject.scope }
				: { effect: "allow", tool: subject.tool },
		];
		if (rule === "ask") return this.#byRule(subject.tool, subject.summary, remember);
		if (subject.always) {
			const decision = this.#ask(subject.tool, subject.summary, undefined, remember);
			if (subject.warning && decision.effect === "ask") decision.request.warning = subject.warning;
			return decision;
		}
		return this.#byDefault(session, flagged, subject.tool, subject.summary, remember);
	}

	/** Asked because a rule of the session says so. */
	#byRule(tool: string, summary: string, remember?: PermissionRule[]): Decision {
		return { ...this.#ask(tool, summary, undefined, remember), byRule: true } as Decision;
	}

	#ask(
		tool: string,
		summary: string,
		reasons?: ConfirmReason[],
		remember?: PermissionRule[],
	): Extract<Decision, { effect: "ask" }> {
		const request: PermissionRequest = { tool, summary, mustConfirm: reasons !== undefined };
		if (reasons) request.reasons = reasons;
		else if (remember && remember.length > 0) request.rememberRules = remember;
		return { effect: "ask", request };
	}
}
