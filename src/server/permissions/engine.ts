import { dirname } from "node:path";
import {
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
	| { kind: "url"; tool: string; url: string };

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
				return this.#ask(
					subject.tool,
					subject.summary,
					`changes files outside the working folder: ${outside.join(", ")}`,
				);
			}
			if (effects.includes("ask")) return this.#ask(subject.tool, subject.summary);
			if (effects.every((effect) => effect === "allow")) return { effect: "allow" };
			return this.#byDefault(session, flagged, subject.tool, subject.summary, [
				{ effect: "allow", tool: subject.tool, pattern: "**" },
			]);
		}

		if (effects.includes("ask")) return this.#ask(subject.tool, subject.summary);
		const needed = subject.paths.filter(
			(path, index) => effects[index] !== "allow" && (!cwd || !isInside(path, cwd)),
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

		const reasons = new Set<string>();
		for (const argv of commands) {
			const reason = mustConfirmReason(argv);
			if (reason) reasons.add(reason);
		}
		if (privileged) reasons.add("runs with administrator rights");
		for (const target of redirectTargets) {
			const path = resolvePath(target, cwd);
			if (!path || !cwd || !isInside(path, cwd))
				reasons.add("writes a file outside the working folder");
			else if (isSecretPath(path, this.#secrets)) reasons.add("writes into a credentials location");
		}

		const ruleFor = (argv: string[]) =>
			this.#rulesFor(session, subject.tool, (r) => matchesPrefix(argv, r.pattern ?? ""));
		if (commands.some((argv) => ruleFor(argv) === "deny")) {
			return { effect: "deny", reason: "A rule in this session refuses this command." };
		}
		if (reasons.size > 0) return this.#ask(subject.tool, subject.command, [...reasons].join("; "));
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

	#ask(tool: string, summary: string, mustConfirm?: string, remember?: PermissionRule[]): Decision {
		const request: PermissionRequest = { tool, summary, mustConfirm: mustConfirm !== undefined };
		if (mustConfirm) request.reason = mustConfirm;
		else if (remember && remember.length > 0) request.rememberRules = remember;
		return { effect: "ask", request };
	}
}
