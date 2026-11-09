import { Hono } from "hono";
import type { PermissionRule, Session, ThinkingLevel, Transcript } from "../../shared/types.ts";
import { PERMISSION_MODES, SESSION_KINDS, THINKING_LEVELS } from "../../shared/types.ts";
import { invalid } from "../errors.ts";
import { type ExportLanguage, exportFileName, sessionMarkdown } from "../export.ts";
import { pickFolder } from "../folder-picker.ts";
import { resolveWorkingFolder } from "../paths.ts";
import type { SessionPatch, Store } from "../store.ts";
import { idempotent } from "./idempotency.ts";
import {
	type Fields,
	optArray,
	optBoolean,
	optEnum,
	optIntQuery,
	optNullableString,
	optNumber,
	optObject,
	optString,
	pageParams,
	readJson,
	reqString,
} from "./input.ts";
import type { AppEnv } from "./problem.ts";

export interface DefaultModel {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
}

/** A saved working folder, offered first when you pick a folder for a session. */
export interface Workspace {
	id: string;
	name: string;
	path: string;
}

export const SETTING_DEFAULTS = {
	defaultModel: {
		provider: "deepseek",
		model: "deepseek-v4-pro",
		thinking: "medium",
	} as DefaultModel,
	defaultRules: [] as PermissionRule[],
	theme: "system" as "system" | "light" | "dark",
	language: "system" as "system" | "zh" | "en",
	workspaces: [] as Workspace[],
};

export type Settings = typeof SETTING_DEFAULTS;

export function readSettings(store: Store): Settings {
	return {
		defaultModel: store.getSetting("defaultModel", SETTING_DEFAULTS.defaultModel),
		defaultRules: store.getSetting("defaultRules", SETTING_DEFAULTS.defaultRules),
		theme: store.getSetting("theme", SETTING_DEFAULTS.theme),
		language: store.getSetting("language", SETTING_DEFAULTS.language),
		workspaces: store.getSetting("workspaces", SETTING_DEFAULTS.workspaces),
	};
}

/** Checks that a provider and model exist; supplied by the model layer. */
export type ModelCheck = (provider: string, model: string) => void;

export interface ApiDeps {
	store: Store;
	checkModel?: ModelCheck;
	/** Opens the system folder picker; replaced in tests so they never open a window. */
	pickFolder?: () => Promise<string | null>;
}

const RULE_EFFECTS = ["allow", "ask", "deny"] as const;

export function parseRules(value: unknown[]): PermissionRule[] {
	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw invalid(`Rule ${index + 1} must be an object.`, "rules");
		}
		const fields = item as Fields;
		const effect = optEnum(fields, "effect", RULE_EFFECTS);
		const tool = optString(fields, "tool", 64);
		const pattern = optString(fields, "pattern", 1000);
		if (!effect || !tool) throw invalid(`Rule ${index + 1} needs an effect and a tool.`, "rules");
		return pattern ? { effect, tool, pattern } : { effect, tool };
	});
}

const MAX_WORKSPACES = 50;

/**
 * Checks the saved workspaces. A new or moved one must point at an existing folder; one already saved
 * with the same path is kept as it is, so a folder that has since gone away can still be renamed or
 * removed.
 */
export function parseWorkspaces(value: unknown[], saved: Workspace[]): Workspace[] {
	if (value.length > MAX_WORKSPACES) {
		throw invalid(`Up to ${MAX_WORKSPACES} workspaces can be saved.`, "workspaces");
	}
	const known = new Map(saved.map((workspace) => [workspace.id, workspace]));
	const paths = new Set<string>();
	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw invalid(`Workspace ${index + 1} must be an object.`, "workspaces");
		}
		const fields = item as Fields;
		const id = reqString(fields, "id", 64);
		if (!/^[\w-]+$/.test(id))
			throw invalid(`Workspace ${index + 1} has an invalid id.`, "workspaces");
		const name = reqString(fields, "name", 60).trim();
		if (!name || /\p{Cc}/u.test(name)) {
			throw invalid(
				`Workspace ${index + 1} needs a name without control characters.`,
				"workspaces",
			);
		}
		const requested = reqString(fields, "path", 4096);
		const previous = known.get(id);
		let path: string;
		if (previous && previous.path === requested) {
			path = previous.path;
		} else {
			try {
				path = resolveWorkingFolder(requested);
			} catch (error) {
				throw invalid((error as Error).message, "workspaces");
			}
		}
		if (paths.has(path)) throw invalid(`${requested} is already a workspace.`, "workspaces");
		paths.add(path);
		return { id, name, path };
	});
}

/** `filename` for old clients, `filename*` for the real name (RFC 6266 and 5987). */
function contentDisposition(filename: string): string {
	const ascii = filename
		.replace(/[^\x20-\x7e]/g, "")
		.replace(/["\\]/g, "_")
		.trim();
	const fallback = ascii || "jig-session.md";
	const encoded = encodeURIComponent(filename).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function api(deps: ApiDeps): Hono<AppEnv> {
	const { store } = deps;
	const app = new Hono<AppEnv>();
	const once = idempotent(store.db);

	// --- groups ---

	app.get("/groups", (c) => c.json({ items: store.listGroups(), nextCursor: null }));

	// The system folder picker, for choosing a workspace's folder (macOS; elsewhere a typed path).
	app.post("/folders/pick", async (c) => {
		const path = await (deps.pickFolder ?? (() => pickFolder()))();
		return c.json({ path });
	});

	app.post("/groups", once, async (c) => {
		const fields = await readJson(c);
		return c.json(store.createGroup(reqString(fields, "name", 200)), 201);
	});

	app.patch("/groups/:id", async (c) => {
		const fields = await readJson(c);
		const name = optString(fields, "name", 200);
		const position = optNumber(fields, "position");
		return c.json(
			store.updateGroup(c.req.param("id"), {
				...(name !== undefined ? { name } : {}),
				...(position !== undefined ? { position } : {}),
			}),
		);
	});

	app.delete("/groups/:id", (c) => {
		store.deleteGroup(c.req.param("id"));
		return c.body(null, 204);
	});

	// --- sessions ---

	app.get("/sessions", (c) => {
		const { limit, cursor } = pageParams(c);
		const archived = c.req.query("archived") === "true";
		return c.json(store.listSessions({ archived, cursor, limit }));
	});

	app.post("/sessions", once, async (c) => {
		const fields = await readJson(c);
		const settings = readSettings(store);
		const provider = optString(fields, "provider", 100) ?? settings.defaultModel.provider;
		const model = optString(fields, "model", 200) ?? settings.defaultModel.model;
		deps.checkModel?.(provider, model);
		const cwd = optNullableString(fields, "cwd", 4096);
		const session = store.createSession({
			name: reqString(fields, "name", 200),
			kind: optEnum(fields, "kind", SESSION_KINDS) ?? "task",
			groupId: optNullableString(fields, "groupId", 100) ?? null,
			responsibility: optString(fields, "responsibility", 20_000) ?? "",
			cwd: cwd ? resolveWorkingFolder(cwd) : null,
			provider,
			model,
			thinking: optEnum(fields, "thinking", THINKING_LEVELS) ?? settings.defaultModel.thinking,
			rules: settings.defaultRules,
			options: { permissionMode: "auto" },
		});
		return c.json(session, 201);
	});

	app.get("/sessions/:id", (c) => c.json(store.getSession(c.req.param("id"))));

	app.patch("/sessions/:id", async (c) => {
		const id = c.req.param("id");
		const fields = await readJson(c);
		const patch: SessionPatch = {};
		const name = optString(fields, "name", 200);
		if (name !== undefined) patch.name = name;
		const groupId = optNullableString(fields, "groupId", 100);
		if (groupId !== undefined) patch.groupId = groupId;
		const cwd = optNullableString(fields, "cwd", 4096);
		if (cwd !== undefined) patch.cwd = cwd ? resolveWorkingFolder(cwd) : null;
		const responsibility = optString(fields, "responsibility", 20_000);
		if (responsibility !== undefined) patch.responsibility = responsibility;
		const provider = optString(fields, "provider", 100);
		const model = optString(fields, "model", 200);
		if (provider !== undefined || model !== undefined) {
			const current = store.getSession(id);
			deps.checkModel?.(provider ?? current.provider, model ?? current.model);
			if (provider !== undefined) patch.provider = provider;
			if (model !== undefined) patch.model = model;
		}
		const thinking = optEnum(fields, "thinking", THINKING_LEVELS);
		if (thinking !== undefined) patch.thinking = thinking;
		const rules = optArray(fields, "rules");
		if (rules !== undefined) patch.rules = parseRules(rules);
		const options = optObject(fields, "options");
		if (options !== undefined) {
			const compactAt = options.compactAt;
			if (
				compactAt !== undefined &&
				compactAt !== null &&
				(typeof compactAt !== "number" || !Number.isInteger(compactAt) || compactAt < 10_000)
			) {
				throw invalid("compactAt must be a whole number of at least 10000, or null.", "options");
			}
			const permissionMode = optEnum(options, "permissionMode", PERMISSION_MODES);
			patch.options = {
				...(compactAt !== undefined ? { compactAt: compactAt as number | null } : {}),
				...(permissionMode !== undefined ? { permissionMode } : {}),
			};
		}
		const pinned = optBoolean(fields, "pinned");
		if (pinned !== undefined) patch.pinned = pinned;
		const archived = optBoolean(fields, "archived");
		if (archived !== undefined) patch.archived = archived;
		if (optBoolean(fields, "read") === true) patch.read = true;
		const before = store.getSession(id);
		const updated = store.updateSession(id, patch);
		if (updated.provider !== before.provider || updated.model !== before.model) {
			store.appendEntry(id, {
				role: "notice",
				notice: {
					kind: "model_changed",
					text: `${before.provider}/${before.model} → ${updated.provider}/${updated.model}`,
					timestamp: Date.now(),
				},
			});
			return c.json(store.getSession(id));
		}
		return c.json(updated);
	});

	app.get("/sessions/:id/transcript", (c) => {
		const session: Session = store.getSession(c.req.param("id"));
		const limit = optIntQuery(c, "limit") ?? 100;
		if (limit < 1 || limit > 500) throw invalid("limit must be from 1 to 500.", "limit");
		const before = optIntQuery(c, "before") ?? null;
		// Read everything at one point in time, so the client can resume the event stream from session.eventSeq.
		const transcript = store.tx((): Transcript => {
			const page = store.listEntries(session.id, { before, limit });
			const toolCalls = store.toolCallsForMessages(page.entries.map((entry) => entry.id));
			const approvals = store.approvalsForToolCalls(toolCalls.map((call) => call.id));
			const pending = store
				.pendingApprovals(session.id)
				.filter((approval) => !approvals.some((known) => known.id === approval.id));
			return {
				session: store.getSession(session.id),
				entries: page.entries,
				toolCalls,
				approvals: [...approvals, ...pending],
				queue: store.listQueue(session.id),
				olderCursor: page.olderCursor,
			};
		});
		return c.json(transcript);
	});

	// The whole session as one Markdown file. The language comes from the interface; without it the
	// saved interface language is used, and a system setting falls back to Chinese.
	app.get("/sessions/:id/export.md", (c) => {
		const session = store.getSession(c.req.param("id"));
		const requested = c.req.query("lang");
		if (requested !== undefined && requested !== "zh" && requested !== "en") {
			throw invalid("lang must be zh or en.", "lang");
		}
		const saved = readSettings(store).language;
		const language: ExportLanguage = requested ?? (saved === "en" ? "en" : "zh");
		const groupName = session.groupId ? store.getGroup(session.groupId).name : null;
		const markdown = sessionMarkdown({
			session,
			groupName,
			entries: store.allEntries(session.id),
			toolCalls: store.toolCallsForSession(session.id),
			language,
		});
		c.header("Content-Type", "text/markdown; charset=utf-8");
		c.header("Content-Disposition", contentDisposition(exportFileName(session.name)));
		return c.body(markdown);
	});

	app.get("/sessions/:id/queue", (c) => {
		const id = c.req.param("id");
		store.getSession(id);
		return c.json({ items: store.listQueue(id), nextCursor: null });
	});

	app.patch("/sessions/:id/queue/:queuedId", async (c) => {
		const fields = await readJson(c);
		const text = reqString(fields, "text", 100_000);
		if (text.trim().length === 0) throw invalid("The message cannot be empty.", "text");
		return c.json(store.updateQueued(c.req.param("id"), c.req.param("queuedId"), text));
	});

	app.delete("/sessions/:id/queue/:queuedId", (c) => {
		store.removeQueued(c.req.param("id"), c.req.param("queuedId"));
		return c.body(null, 204);
	});

	// --- search and settings ---

	app.get("/search", (c) => {
		const q = c.req.query("q") ?? "";
		if (q.length > 200) throw invalid("The search text can be at most 200 characters.", "q");
		const limit = optIntQuery(c, "limit") ?? 20;
		if (limit < 1 || limit > 100) throw invalid("limit must be from 1 to 100.", "limit");
		return c.json(store.search(q, limit));
	});

	app.get("/settings", (c) => c.json(readSettings(store)));

	app.patch("/settings", async (c) => {
		const fields = await readJson(c);
		const defaultModel = optObject(fields, "defaultModel");
		if (defaultModel) {
			const value: DefaultModel = {
				provider: reqString(defaultModel, "provider", 100),
				model: reqString(defaultModel, "model", 200),
				thinking: optEnum(defaultModel, "thinking", THINKING_LEVELS) ?? "medium",
			};
			deps.checkModel?.(value.provider, value.model);
			store.setSetting("defaultModel", value);
		}
		const rules = optArray(fields, "defaultRules");
		if (rules) store.setSetting("defaultRules", parseRules(rules));
		const theme = optEnum(fields, "theme", ["system", "light", "dark"] as const);
		if (theme) store.setSetting("theme", theme);
		const language = optEnum(fields, "language", ["system", "zh", "en"] as const);
		if (language) store.setSetting("language", language);
		const workspaces = optArray(fields, "workspaces");
		if (workspaces) {
			store.setSetting("workspaces", parseWorkspaces(workspaces, readSettings(store).workspaces));
		}
		return c.json(readSettings(store));
	});

	return app;
}
