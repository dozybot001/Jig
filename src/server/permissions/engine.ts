import { dirname } from "node:path";
import {
	type ConfirmReason,
	type PermissionRequest,
	type PermissionRule,
	permissionModeOf,
	type RuleEffect,
	type Session,
} from "../../shared/types.ts";
import { isInside, isSecretPath, pathMatches, resolvePath, secretLocations } from "./paths.ts";
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
	| { kind: "command"; tool: string; command: string }
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
	  };

export type Decision =
	| { effect: "allow" }
	| { effect: "deny"; reason: string }
	| { effect: "ask"; request: PermissionRequest };

const SAFE_REDIRECT_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "&1", "&2", "-"]);

function strongest(effects: RuleEffect[]): RuleEffect | null {
	if (effects.includes("deny")) return "deny";
	if (effects.includes("ask")) return "ask";
	if (effects.includes("allow")) return "allow";
	return null;
}

/**
 * Decides whether a tool call may run, must be asked about, or is refused (M1 plan, section 8).
 * Order: credential locations are refused; must-confirm operations always ask and cannot be remembered
 * (spec 21.2); then the session's rules, where deny beats ask beats allow; then the built-in defaults.
 * Text in the transcript never counts as approval: only the person's answer in Jig does.
 */
export class PermissionEngine {
	readonly #secrets: string[];
	/** Folders outside the working folder that may be read without asking: memory and skill folders. */
	readRoots: () => string[] = () => [];

	constructor(jigHome: string) {
		this.#secrets = secretLocations(jigHome);
	}

	/**
	 * `flagged` is the model's own judgment, through the `confirm` argument: in the automatic mode a
	 * flagged call is asked about, others run. Must-confirm operations, explicit "ask" rules and commands
	 * Jig cannot read are asked about in every mode.
	 */
	decide(subject: Subject, session: Session, flagged = false): Decision {
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

	/** An approval Jig asks for only by default; the session's mode settles it. */
	#byDefault(
		session: Session,
		flagged: boolean,
		tool: string,
		summary: string,
		remember?: PermissionRule[],
	): Decision {
		const mode = permissionModeOf(session.options);
		if (mode === "skip" || (mode === "auto" && !flagged)) return { effect: "allow" };
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

	#files(
		subject: Extract<Subject, { kind: "read" | "write" }>,
		session: Session,
		flagged: boolean,
	): Decision {
		const cwd = session.cwd;
		for (const path of subject.paths) {
			if (isSecretPath(path, this.#secrets)) {
				const verb = subject.kind === "read" ? "read" : "change";
				return {
					effect: "deny",
					reason: `${path} holds credentials or Jig's own data; sessions cannot ${verb} it.`,
				};
			}
		}
		const effects = subject.paths.map((path) =>
			this.#rulesFor(session, subject.tool, (rule) => pathMatches(path, rule.pattern ?? "", cwd)),
		);
		if (effects.includes("deny")) {
			return { effect: "deny", reason: "A rule in this session refuses this." };
		}
		const outside = subject.paths.filter((path) => !cwd || !isInside(path, cwd));

		if (subject.kind === "write") {
			if (outside.length > 0) {
				return this.#ask(subject.tool, subject.summary, ["write-outside"]);
			}
			if (effects.includes("ask")) return this.#ask(subject.tool, subject.summary);
			if (effects.every((effect) => effect === "allow")) return { effect: "allow" };
			return this.#byDefault(session, flagged, subject.tool, subject.summary, [
				{ effect: "allow", tool: subject.tool, pattern: "**" },
			]);
		}

		if (effects.includes("ask")) return this.#ask(subject.tool, subject.summary);
		const roots = this.readRoots();
		const needed = subject.paths.filter(
			(path, index) =>
				effects[index] !== "allow" &&
				(!cwd || !isInside(path, cwd)) &&
				!roots.some((root) => isInside(path, root)),
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

		const reasons = new Set<ConfirmReason>();
		for (const argv of commands) {
			const reason = mustConfirmReason(argv);
			if (reason) reasons.add(reason);
			// File tools cannot touch these places at all; a command that names one asks every time.
			const secret = pathArguments(argv).some((arg) => {
				const path = resolvePath(arg, cwd);
				return path !== null && isSecretPath(path, this.#secrets);
			});
			if (secret) reasons.add("credentials");
		}
		if (privileged) reasons.add("admin");
		for (const target of redirectTargets) {
			const path = resolvePath(target, cwd);
			if (!path || !cwd || !isInside(path, cwd)) reasons.add("write-outside");
			else if (isSecretPath(path, this.#secrets)) reasons.add("write-credentials");
		}

		const ruleFor = (argv: string[]) =>
			this.#rulesFor(session, subject.tool, (r) => matchesPrefix(argv, r.pattern ?? ""));
		if (commands.some((argv) => ruleFor(argv) === "deny")) {
			return { effect: "deny", reason: "A rule in this session refuses this command." };
		}
		if (reasons.size > 0) return this.#ask(subject.tool, subject.command, [...reasons]);
		if (!understood || dynamic) return this.#ask(subject.tool, subject.command);

		const pending: string[][] = [];
		let ruleAsks = false;
		for (const argv of commands) {
			const rule = ruleFor(argv);
			if (rule === "ask") ruleAsks = true;
			if (rule === "allow") continue;
			if (rule === null && this.#readOnlyHere(argv, cwd)) continue;
			pending.push(argv);
		}
		if (ruleAsks) return this.#ask(subject.tool, subject.command);
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

	#readOnlyHere(argv: string[], cwd: string | null): boolean {
		if (!cwd || !isReadOnly(argv)) return false;
		return pathArguments(argv).every((arg) => {
			const path = resolvePath(arg, cwd);
			return path !== null && isInside(path, cwd) && !isSecretPath(path, this.#secrets);
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
		if (rule === "ask") return this.#ask(subject.tool, subject.url);
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
		if (rule === "ask" || subject.always) {
			return this.#ask(subject.tool, subject.summary, undefined, remember);
		}
		return this.#byDefault(session, flagged, subject.tool, subject.summary, remember);
	}

	#ask(
		tool: string,
		summary: string,
		reasons?: ConfirmReason[],
		remember?: PermissionRule[],
	): Decision {
		const request: PermissionRequest = { tool, summary, mustConfirm: reasons !== undefined };
		if (reasons) request.reasons = reasons;
		else if (remember && remember.length > 0) request.rememberRules = remember;
		return { effect: "ask", request };
	}
}
