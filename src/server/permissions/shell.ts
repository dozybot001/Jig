import { basename } from "node:path";
import type { ConfirmReason } from "../../shared/types.ts";

/**
 * A small, conservative shell parser for permission checks. It does not try to understand every
 * shell feature: anything it cannot follow is reported as not understood, and the caller then asks
 * the person instead of deciding (M1 plan, section 8).
 */

export interface Redirect {
	op: string;
	target: string;
}

export interface Segment {
	/** Words with quotes removed. Words containing an expansion keep the `$` text. */
	argv: string[];
	redirects: Redirect[];
	/** Contains `$VAR`, `$(...)`, backticks or process substitution, so the real arguments are unknown. */
	dynamic: boolean;
}

export interface ParsedCommand {
	segments: Segment[];
	/** False when the parser met something it does not follow; `reason` says what. */
	understood: boolean;
	reason?: string;
}

const OPERATOR_CHARS = new Set(["&", "|", ";", "\n"]);

/**
 * `$(cat <<'EOF' … EOF)`: a way to write a long literal argument (a commit message, say). With a
 * quoted delimiter nothing in the text is expanded and `cat` only hands it back, so it is the text.
 */
const LITERAL_TEXT =
	/^\$\(\s*cat\s*<<-?\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)/;

interface HereDocument {
	delimiter: string;
	/** `<<-`: leading tabs are removed from every line, the closing one too. */
	stripTabs: boolean;
	/** With a quoted delimiter the text is taken as written; otherwise `$…` and backticks in it run. */
	literal: boolean;
}

export function parseShell(command: string): ParsedCommand {
	const segments: Segment[] = [];
	let segment: Segment = { argv: [], redirects: [], dynamic: false };
	let word = "";
	let inWord = false;
	let pendingRedirect: string | null = null;
	let reason: string | undefined;
	/** Here-documents opened on the current line; their text starts on the next one. */
	const opened: HereDocument[] = [];

	const fail = (why: string) => {
		reason ??= why;
	};
	const endWord = () => {
		if (!inWord) return;
		if (pendingRedirect) {
			segment.redirects.push({ op: pendingRedirect, target: word });
			pendingRedirect = null;
		} else {
			segment.argv.push(word);
		}
		word = "";
		inWord = false;
	};
	const endSegment = () => {
		endWord();
		if (pendingRedirect) fail("a redirect without a target");
		if (segment.argv.length > 0 || segment.redirects.length > 0) segments.push(segment);
		segment = { argv: [], redirects: [], dynamic: false };
	};

	let i = 0;
	while (i < command.length) {
		const c = command[i] as string;
		const next = command[i + 1];

		if (c === "\\") {
			if (next === "\n") {
				i += 2;
				continue;
			}
			if (next !== undefined) word += next;
			inWord = true;
			i += 2;
			continue;
		}
		if (c === "'") {
			const end = command.indexOf("'", i + 1);
			if (end < 0) {
				fail("an unclosed single quote");
				break;
			}
			word += command.slice(i + 1, end);
			inWord = true;
			i = end + 1;
			continue;
		}
		if (c === '"') {
			let j = i + 1;
			let closed = false;
			while (j < command.length) {
				const d = command[j] as string;
				if (d === "\\" && j + 1 < command.length) {
					const escaped = command[j + 1] as string;
					word += '"\\$`'.includes(escaped) ? escaped : `\\${escaped}`;
					j += 2;
					continue;
				}
				if (d === '"') {
					closed = true;
					break;
				}
				if (d === "$") {
					const literal = LITERAL_TEXT.exec(command.slice(j));
					if (literal) {
						word += literal[3];
						j += literal[0].length;
						continue;
					}
				}
				if (d === "$" || d === "`") segment.dynamic = true;
				word += d;
				j++;
			}
			if (!closed) {
				fail("an unclosed double quote");
				break;
			}
			inWord = true;
			i = j + 1;
			continue;
		}
		if (c === "$") {
			const literal = LITERAL_TEXT.exec(command.slice(i));
			if (literal) {
				word += literal[3];
				inWord = true;
				i += literal[0].length;
				continue;
			}
		}
		if (c === "$" || c === "`") {
			segment.dynamic = true;
			word += c;
			inWord = true;
			i++;
			continue;
		}
		if (c === "#" && !inWord) {
			const end = command.indexOf("\n", i);
			i = end < 0 ? command.length : end;
			continue;
		}
		if (c === " " || c === "\t") {
			endWord();
			i++;
			continue;
		}
		if (c === "(" || c === ")" || c === "{" || c === "}") {
			if (c === "{" || c === "}") {
				// Braces inside a word (`a{b,c}` or `${x}`) are fine; on their own they start a group.
				if (inWord) {
					word += c;
					i++;
					continue;
				}
			}
			fail("a subshell or command group");
			word += c;
			inWord = true;
			i++;
			continue;
		}
		if (c === "<" || c === ">") {
			if (c === "<" && next === "<" && command[i + 2] === "<") {
				// A here-string: the next word is the command's input.
				endWord();
				pendingRedirect = "<<<";
				i += 3;
				continue;
			}
			if (c === "<" && next === "<") {
				// A here-document: the lines after this one, up to the delimiter, are the command's input.
				endWord();
				i += 2;
				const stripTabs = command[i] === "-";
				if (stripTabs) i++;
				while (command[i] === " " || command[i] === "\t") i++;
				const start = i;
				while (i < command.length && !/[\s;&|<>()]/.test(command[i] as string)) i++;
				const raw = command.slice(start, i);
				const delimiter = raw.replace(/['"\\]/g, "");
				if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(delimiter)) {
					fail("a here-document");
					continue;
				}
				opened.push({ delimiter, stripTabs, literal: raw !== delimiter });
				continue;
			}
			if (next === "(") {
				segment.dynamic = true;
				fail("process substitution");
				i += 2;
				continue;
			}
			// A word made only of digits right before the operator is a file descriptor: 2>, 1>>.
			let op = "";
			if (inWord && /^\d+$/.test(word)) {
				op = word;
				word = "";
				inWord = false;
			} else {
				endWord();
			}
			op += c;
			i++;
			if (command[i] === c) {
				op += c;
				i++;
			}
			if (command[i] === "&") {
				op += "&";
				i++;
			}
			pendingRedirect = op;
			continue;
		}
		if (c === "&" && next === ">") {
			endWord();
			let op = "&>";
			i += 2;
			if (command[i] === ">") {
				op += ">";
				i++;
			}
			pendingRedirect = op;
			continue;
		}
		if (c === "\n" && opened.length > 0) {
			// The text of each here-document is input, not commands: step over it.
			let at = i + 1;
			for (const doc of opened) {
				let closed = false;
				let text = "";
				while (at <= command.length) {
					const end = command.indexOf("\n", at);
					const line = command.slice(at, end < 0 ? command.length : end);
					at = end < 0 ? command.length + 1 : end + 1;
					if ((doc.stripTabs ? line.replace(/^\t+/, "") : line) === doc.delimiter) {
						closed = true;
						break;
					}
					text += `${line}\n`;
				}
				if (!closed) fail("an unclosed here-document");
				else if (!doc.literal && /[$`]/.test(text)) fail("a here-document that runs commands");
			}
			opened.length = 0;
			endSegment();
			i = Math.min(at, command.length);
			continue;
		}
		if (OPERATOR_CHARS.has(c)) {
			endSegment();
			if ((c === "&" || c === "|") && next === c) i += 2;
			else if (c === "|" && next === "&") i += 2;
			else i++;
			continue;
		}
		word += c;
		inWord = true;
		i++;
	}
	endSegment();
	if (opened.length > 0) fail("an unclosed here-document");
	return reason ? { segments, understood: false, reason } : { segments, understood: true };
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);

export interface Unwrapped {
	commands: string[][];
	/** Wrappers that matter by themselves, such as sudo. */
	privileged: boolean;
	understood: boolean;
}

/**
 * Peels wrappers off a command so the real program is checked: `sudo`, `env VAR=x`, `exec`,
 * `nohup`, `time`, `nice`, `timeout`, `xargs`, and `bash -c '...'` or `eval '...'`, whose string is
 * parsed again. Stops after four levels (prior-art 4.3, after Kimi Code's dangerous-command check).
 */
export function unwrap(argv: string[], depth = 0): Unwrapped {
	if (depth > 4) return { commands: [argv], privileged: false, understood: false };
	let args = [...argv];
	while (args.length > 0 && ASSIGNMENT.test(args[0] as string)) args = args.slice(1);
	const name = basename(args[0] ?? "");
	const rest = args.slice(1);

	const skipOptions = (list: string[], withValue: Set<string> = new Set()) => {
		let k = 0;
		while (k < list.length && (list[k] as string).startsWith("-")) {
			if (withValue.has(list[k] as string)) k++;
			k++;
		}
		return list.slice(k);
	};

	if (name === "sudo" || name === "doas") {
		const inner = unwrap(
			skipOptions(rest, new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t"])),
			depth + 1,
		);
		return { ...inner, privileged: true };
	}
	if (name === "env") {
		let inner = skipOptions(rest, new Set(["-u", "-C", "-S"]));
		while (inner.length > 0 && ASSIGNMENT.test(inner[0] as string)) inner = inner.slice(1);
		return inner.length
			? unwrap(inner, depth + 1)
			: { commands: [args], privileged: false, understood: true };
	}
	if (
		name === "exec" ||
		name === "command" ||
		name === "nohup" ||
		name === "time" ||
		name === "builtin"
	) {
		return rest.length
			? unwrap(skipOptions(rest), depth + 1)
			: { commands: [args], privileged: false, understood: true };
	}
	if (name === "nice") return unwrap(skipOptions(rest, new Set(["-n"])), depth + 1);
	if (name === "timeout") {
		const inner = skipOptions(rest, new Set(["-s", "-k", "--signal", "--kill-after"]));
		return unwrap(inner.slice(1), depth + 1);
	}
	if (name === "xargs") {
		const inner = skipOptions(rest, new Set(["-I", "-n", "-P", "-L", "-s", "-d", "-E"]));
		return inner.length
			? unwrap(inner, depth + 1)
			: { commands: [["echo"]], privileged: false, understood: true };
	}
	if (SHELLS.has(name) && !rest.includes("-c") && rest.every((arg) => arg.startsWith("-"))) {
		// A shell with no script named reads its commands from its input (a pipe, a here-document):
		// commands Yew has not read.
		return { commands: [args], privileged: false, understood: false };
	}
	if ((SHELLS.has(name) && rest.includes("-c")) || name === "eval") {
		const script = name === "eval" ? rest.join(" ") : rest[rest.indexOf("-c") + 1];
		if (script === undefined) return { commands: [args], privileged: false, understood: false };
		const parsed = parseShell(script);
		const commands: string[][] = [];
		let privileged = false;
		let understood = parsed.understood;
		for (const segment of parsed.segments) {
			if (segment.dynamic) understood = false;
			const inner = unwrap(segment.argv, depth + 1);
			commands.push(...inner.commands);
			privileged ||= inner.privileged;
			understood &&= inner.understood;
		}
		return { commands, privileged, understood };
	}
	return { commands: [args], privileged: false, understood: true };
}

function gitSubcommand(args: string[]): { sub: string | undefined; rest: string[] } {
	let k = 0;
	while (k < args.length && (args[k] as string).startsWith("-")) {
		if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(args[k] as string)) k++;
		k++;
	}
	return { sub: args[k], rest: args.slice(k + 1) };
}

/** Why an operation must be confirmed every time (spec 21.2), or null. Checked on unwrapped commands. */
export function mustConfirmReason(argv: string[]): ConfirmReason | null {
	const name = basename(argv[0] ?? "");
	const args = argv.slice(1);
	const has = (...flags: string[]) => args.some((arg) => flags.includes(arg));
	const hasPrefix = (...prefixes: string[]) =>
		args.some((arg) => prefixes.some((prefix) => arg.startsWith(prefix)));

	if (["rm", "rmdir", "unlink", "shred", "srm", "trash"].includes(name)) return "delete-files";
	// Yew's own command line sends letters and manages keys and the service; sessions use their tools.
	if (name === "yew" || name === "yew") {
		const informational =
			has("--help", "-h") || args.every((arg) => ["--version", "-v", "--json"].includes(arg));
		if (!informational) return "yew-cli";
	}
	if (name === "find" && has("-delete")) return "delete-files";
	if (name === "rsync" && hasPrefix("--delete", "--remove-source-files")) return "delete-files";
	if (name === "git") {
		const { sub, rest } = gitSubcommand(args);
		const restHas = (...flags: string[]) => rest.some((arg) => flags.includes(arg));
		if (sub === "push") return "push";
		if (sub === "reset" && restHas("--hard", "--merge", "--keep")) return "discard-changes";
		if (sub === "clean") return "delete-untracked";
		if (sub === "branch" && restHas("-d", "-D", "--delete")) return "delete-branch";
		if (sub === "tag" && restHas("-d", "--delete")) return "delete-tag";
		if (sub === "stash" && (rest[0] === "drop" || rest[0] === "clear")) return "delete-stash";
		if (sub === "checkout" && (restHas("--", ".") || restHas("-f", "--force")))
			return "discard-changes";
		if (sub === "restore" && !restHas("--staged", "-S")) return "discard-changes";
		if (sub === "filter-branch" || sub === "filter-repo") return "rewrite-history";
		if (sub === "update-ref" && restHas("-d")) return "delete-ref";
		if (sub === "worktree" && rest[0] === "remove") return "delete-worktree";
	}
	if (["npm", "pnpm", "yarn", "bun"].includes(name) && args[0] === "publish")
		return "publish-package";
	if (name === "npm" && (args[0] === "unpublish" || args[0] === "deprecate"))
		return "change-package";
	if (["cargo", "poetry", "flit", "hatch"].includes(name) && args[0] === "publish")
		return "publish-package";
	if (name === "gem" && args[0] === "push") return "publish-package";
	if (name === "twine" && args[0] === "upload") return "publish-package";
	if (name === "docker" && (args[0] === "push" || (args[0] === "image" && args[1] === "push"))) {
		return "publish-image";
	}
	if (name === "gh") {
		const action = `${args[0] ?? ""} ${args[1] ?? ""}`;
		if (
			/^(release (create|delete|upload|edit)|repo (delete|create|edit|rename|archive)|pr (merge|close|create)|issue (create|close|delete|comment)|secret (set|delete)|workflow run|api) ?/.test(
				`${action} `,
			)
		) {
			return "github";
		}
	}
	if (["ssh", "scp", "sftp", "mosh", "telnet", "ftp", "sshpass"].includes(name)) {
		return "remote-machine";
	}
	if (name === "rsync" && args.some((arg) => /^[^/]*:/.test(arg) && !arg.startsWith("-"))) {
		return "remote-copy";
	}
	if (name === "curl") {
		const sends = args.some(
			(arg, index) =>
				["-d", "-F", "-T", "--form", "--upload-file", "--json"].includes(arg) ||
				arg.startsWith("--data") ||
				arg.startsWith("--form") ||
				(/^-[a-zA-Z]*[dFT]/.test(arg) && !arg.startsWith("--")) ||
				((arg === "-X" || arg === "--request") &&
					/^(POST|PUT|PATCH|DELETE)$/i.test(args[index + 1] ?? "")),
		);
		if (sends) return "send-data";
	}
	if (
		name === "wget" &&
		hasPrefix("--post-data", "--post-file", "--method", "--body-data", "--body-file")
	) {
		return "send-data";
	}
	if (["dd", "mkfs", "fdisk", "parted", "diskutil"].includes(name) || name.startsWith("mkfs.")) {
		return "write-disk";
	}
	if (
		name === "kubectl" &&
		["apply", "delete", "create", "replace", "patch", "scale", "drain", "rollout"].includes(
			args[0] ?? "",
		)
	) {
		return "cluster";
	}
	if (name === "terraform" && ["apply", "destroy", "import"].includes(args[0] ?? "")) {
		return "infrastructure";
	}
	if (["launchctl", "systemctl", "crontab", "shutdown", "reboot", "halt"].includes(name)) {
		return "system-services";
	}
	return null;
}

const READ_ONLY = new Set([
	"ls",
	"pwd",
	"cat",
	"head",
	"tail",
	"wc",
	"file",
	"stat",
	"du",
	"which",
	"whoami",
	"uname",
	"date",
	"echo",
	"printf",
	"realpath",
	"dirname",
	"basename",
	"diff",
	"cmp",
	"jq",
	"rg",
	"grep",
	"egrep",
	"fgrep",
	"cut",
	"tr",
	"sort",
	"tree",
	"find",
	"true",
	"false",
]);

const GIT_READ_ONLY = new Set([
	"status",
	"diff",
	"log",
	"show",
	"rev-parse",
	"ls-files",
	"blame",
	"describe",
	"shortlog",
	"grep",
	"branch",
	"tag",
	"remote",
]);

/**
 * True when a command only reads. The lists follow Gemini CLI's read-only check (prior-art 4.3) and
 * exclude the options that execute other programs or write files. Paths are checked by the caller.
 */
export function isReadOnly(argv: string[]): boolean {
	const name = argv[0] ?? "";
	const args = argv.slice(1);
	if (name.includes("/")) return false;
	if (args.length === 1 && args[0] === "--version") return true;
	if (!READ_ONLY.has(name) && name !== "git") return false;
	if (name === "find") {
		const writes = [
			"-exec",
			"-execdir",
			"-ok",
			"-okdir",
			"-delete",
			"-fprint",
			"-fprint0",
			"-fprintf",
			"-fls",
		];
		return !args.some((arg) => writes.includes(arg));
	}
	if (name === "rg") return !args.some((arg) => arg.startsWith("--pre"));
	if (name === "sort") return !args.some((arg) => arg === "-o" || arg.startsWith("--output"));
	if (name === "tree") return !args.some((arg) => arg === "-o");
	if (name === "git") {
		if (
			args.some(
				(arg) =>
					arg === "-c" ||
					arg.startsWith("--config") ||
					arg === "-C" ||
					arg.startsWith("--exec-path") ||
					arg.startsWith("--output") ||
					arg.startsWith("--ext-diff"),
			)
		) {
			return false;
		}
		const { sub, rest } = gitSubcommand(args);
		if (!sub || !GIT_READ_ONLY.has(sub)) return false;
		if (sub === "branch")
			return rest.every((arg) =>
				["-a", "-r", "-v", "-vv", "--list", "--show-current", "--all", "--remotes"].includes(arg),
			);
		if (sub === "tag") return rest.every((arg) => ["-l", "--list"].includes(arg));
		if (sub === "remote") return rest.every((arg) => arg === "-v");
		return true;
	}
	return true;
}

/** Arguments that look like paths, which the caller keeps inside the working folder. */
export function pathArguments(argv: string[]): string[] {
	return argv
		.slice(1)
		.filter(
			(arg) =>
				!arg.startsWith("-") &&
				(arg.includes("/") || arg.startsWith("~") || arg === ".." || arg.startsWith(".")),
		);
}

const MULTI_WORD = new Set([
	"git",
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"cargo",
	"go",
	"docker",
	"kubectl",
	"gh",
	"brew",
	"pip",
	"pip3",
	"uv",
	"poetry",
	"make",
	"just",
	"dotnet",
	"mvn",
	"gradle",
	"swift",
	"deno",
]);
const THIRD_WORD: Record<string, string[]> = {
	npm: ["run", "exec", "x"],
	pnpm: ["run", "exec", "dlx"],
	yarn: ["run", "dlx"],
	bun: ["run", "x"],
	uv: ["run", "pip"],
	poetry: ["run"],
	go: ["run", "test"],
	deno: ["run", "task"],
};
const INTERPRETERS = new Set([
	"node",
	"python",
	"python3",
	"ruby",
	"perl",
	"php",
	"bash",
	"sh",
	"zsh",
	"osascript",
	"tsx",
	"ts-node",
]);

/**
 * The prefix "allow and remember" stores, after OpenCode's arity table (prior-art 4.3): `git status`,
 * `npm run build`. Interpreters store the whole command, since their first word allows anything.
 */
export function rememberPrefix(argv: string[]): string {
	const name = argv[0] ?? "";
	if (INTERPRETERS.has(name)) return argv.join(" ");
	if (!MULTI_WORD.has(name)) return name;
	const second = argv.slice(1).find((arg) => !arg.startsWith("-"));
	if (!second) return name;
	const index = argv.indexOf(second);
	const third = argv.slice(index + 1).find((arg) => !arg.startsWith("-"));
	if (third && THIRD_WORD[name]?.includes(second)) return `${name} ${second} ${third}`;
	return `${name} ${second}`;
}

/** Word-wise prefix match: the rule `npm run build` matches `npm run build --watch`, not `npm run builder`. */
export function matchesPrefix(argv: string[], pattern: string): boolean {
	const words = pattern
		.trim()
		.replace(/\s+\*$/, "")
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return true;
	return words.every((word, index) => argv[index] === word);
}
