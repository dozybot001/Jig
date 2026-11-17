/**
 * Signing in to MCP servers in the browser (blueprint 6.11, item 40), as the MCP authorization spec
 * describes it with OAuth 2.1. Jig finds the server's authorization server (RFC 9728 and RFC 8414),
 * registers itself as a client where the server allows that (RFC 7591), or uses the client the person
 * made for it (Google's servers), and sends the person's browser to sign in with PKCE and a state.
 * The browser comes back to http://127.0.0.1:<port>/oauth/callback with a code, which Jig trades for
 * tokens. Tokens and registered clients are secrets: they are kept in the system keychain, never in
 * mcp.json, the database or logs.
 */
import { createHash, randomBytes } from "node:crypto";
import type { KeyStore } from "./keys.ts";

/** What mcp.json may say about signing in to an HTTP server. */
export interface OAuthSettings {
	/** A client the person made, for servers that do not let Jig register one (Google's). */
	clientId?: string;
	clientSecret?: string;
	/** Scopes to ask for; otherwise the server's own default. */
	scopes?: string[];
}

interface Endpoints {
	issuer: string;
	authorization: string;
	token: string;
	registration?: string;
}

/** What is kept for one server, in the keychain. */
interface Saved {
	/** The server's address the sign-in is for. */
	resource: string;
	endpoints: Endpoints;
	client: { id: string; secret?: string; redirectUri: string; registered: boolean };
	tokens?: { access: string; refresh?: string; expiresAt?: number };
}

interface Pending {
	server: string;
	verifier: string;
	saved: Saved;
	createdAt: number;
}

/** The server answered that it wants a signed-in request. */
export class SignInRequired extends Error {
	readonly challenge: string | null;
	constructor(challenge: string | null) {
		super("the server asks you to sign in");
		this.challenge = challenge;
	}
}

export interface McpAuthOptions {
	keys: KeyStore;
	/** Where the browser comes back to: http://127.0.0.1:<port>/oauth/callback. */
	redirectUri: string;
	version: string;
	fetch?: typeof fetch;
	now?: () => number;
}

/** How long a started sign-in waits for the browser to come back. */
const PENDING_MS = 10 * 60 * 1000;
const REQUEST_MS = 20_000;

const b64url = (bytes: Buffer) => bytes.toString("base64url");

/** A parameter of a WWW-Authenticate challenge, such as resource_metadata or scope. */
function param(challenge: string | null, name: string): string | null {
	if (!challenge) return null;
	return new RegExp(`${name}="([^"]*)"`).exec(challenge)?.[1] ?? null;
}

function tokensFrom(answer: Record<string, unknown>, now: number, previousRefresh?: string) {
	const expires = Number(answer.expires_in);
	const refresh = typeof answer.refresh_token === "string" ? answer.refresh_token : previousRefresh;
	return {
		access: String(answer.access_token),
		...(refresh ? { refresh } : {}),
		...(Number.isFinite(expires) && expires > 0 ? { expiresAt: now + expires * 1000 } : {}),
	};
}

export class McpAuth {
	readonly #keys: KeyStore;
	readonly #redirect: string;
	readonly #version: string;
	readonly #fetch: typeof fetch;
	readonly #now: () => number;
	readonly #pending = new Map<string, Pending>();
	readonly #refreshing = new Map<string, Promise<string | null>>();

	constructor(options: McpAuthOptions) {
		this.#keys = options.keys;
		this.#redirect = options.redirectUri;
		this.#version = options.version;
		this.#fetch = options.fetch ?? fetch;
		this.#now = options.now ?? Date.now;
	}

	async #load(server: string): Promise<Saved | null> {
		const raw = await this.#keys.get(server);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as Saved;
		} catch {
			return null;
		}
	}

	async #save(server: string, saved: Saved): Promise<void> {
		await this.#keys.set(server, JSON.stringify(saved));
	}

	/** Whether Jig holds a sign-in for this server at this address. */
	async signedIn(server: string, resource: string): Promise<boolean> {
		const saved = await this.#load(server);
		return Boolean(saved?.tokens && saved.resource === resource);
	}

	/** A current access token for the server, refreshed shortly before it runs out; null without one. */
	async bearer(server: string, resource: string): Promise<string | null> {
		const saved = await this.#load(server);
		if (!saved?.tokens || saved.resource !== resource) return null;
		const { tokens } = saved;
		if (!tokens.expiresAt || tokens.expiresAt - 60_000 > this.#now()) return tokens.access;
		if (!tokens.refresh) return null;
		let running = this.#refreshing.get(server);
		if (!running) {
			running = this.#refresh(server, saved, tokens.refresh).finally(() =>
				this.#refreshing.delete(server),
			);
			this.#refreshing.set(server, running);
		}
		return running;
	}

	async #refresh(server: string, saved: Saved, refresh: string): Promise<string | null> {
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refresh,
			client_id: saved.client.id,
			resource: saved.resource,
		});
		if (saved.client.secret) body.set("client_secret", saved.client.secret);
		const answer = await this.#form(saved.endpoints.token, body);
		if (!answer || typeof answer.access_token !== "string") {
			// The sign-in no longer works: the person signs in again.
			const { tokens: _gone, ...rest } = saved;
			await this.#save(server, rest);
			return null;
		}
		const tokens = tokensFrom(answer, this.#now(), refresh);
		await this.#save(server, { ...saved, tokens });
		return tokens.access;
	}

	/**
	 * Starts signing in to a server and returns the address the person's browser opens. `challenge` is
	 * the server's WWW-Authenticate header from its refusal, when there was one.
	 */
	async begin(
		server: string,
		resource: string,
		settings: OAuthSettings = {},
		challenge: string | null = null,
	): Promise<string> {
		const found = await this.#discover(resource, challenge);
		const saved = await this.#load(server);
		let client: Saved["client"];
		if (settings.clientId) {
			client = {
				id: settings.clientId,
				...(settings.clientSecret ? { secret: settings.clientSecret } : {}),
				redirectUri: this.#redirect,
				registered: false,
			};
		} else if (
			saved?.client.registered &&
			saved.resource === resource &&
			saved.client.redirectUri === this.#redirect &&
			saved.endpoints.issuer === found.endpoints.issuer
		) {
			client = saved.client;
		} else {
			client = await this.#register(found.endpoints);
		}
		const verifier = b64url(randomBytes(32));
		const state = b64url(randomBytes(24));
		const url = new URL(found.endpoints.authorization);
		const scopes = settings.scopes?.length ? settings.scopes.join(" ") : found.scope;
		const params: Record<string, string> = {
			response_type: "code",
			client_id: client.id,
			redirect_uri: client.redirectUri,
			code_challenge: b64url(createHash("sha256").update(verifier).digest()),
			code_challenge_method: "S256",
			state,
			resource,
			...(scopes ? { scope: scopes } : {}),
		};
		// Google gives a refresh token only when asked for offline access with consent.
		if (new URL(found.endpoints.issuer).host === "accounts.google.com") {
			params.access_type = "offline";
			params.prompt = "consent";
		}
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		const now = this.#now();
		for (const [key, pending] of this.#pending) {
			if (now - pending.createdAt > PENDING_MS) this.#pending.delete(key);
		}
		this.#pending.set(state, {
			server,
			verifier,
			saved: {
				resource,
				endpoints: found.endpoints,
				client,
				...(saved?.tokens && saved.resource === resource ? { tokens: saved.tokens } : {}),
			},
			createdAt: now,
		});
		return url.toString();
	}

	/** The browser came back with a code: trade it for tokens. Resolves with the server's name. */
	async complete(state: string, code: string | null, error: string | null): Promise<string> {
		const pending = this.#pending.get(state);
		this.#pending.delete(state);
		if (!pending || this.#now() - pending.createdAt > PENDING_MS) {
			throw new Error("This sign-in is not valid any more. Start it again from Jig.");
		}
		if (error || !code) throw new Error(`The sign-in was not completed (${error ?? "no code"}).`);
		const { saved } = pending;
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: saved.client.redirectUri,
			client_id: saved.client.id,
			code_verifier: pending.verifier,
			resource: saved.resource,
		});
		if (saved.client.secret) body.set("client_secret", saved.client.secret);
		const answer = await this.#form(saved.endpoints.token, body);
		if (!answer || typeof answer.access_token !== "string") {
			throw new Error("The server did not give Jig a token.");
		}
		await this.#save(pending.server, { ...saved, tokens: tokensFrom(answer, this.#now()) });
		return pending.server;
	}

	/** Forgets the sign-in and the registered client. */
	async forget(server: string): Promise<void> {
		await this.#keys.delete(server);
	}

	async #json(url: string): Promise<Record<string, unknown> | null> {
		try {
			const response = await this.#fetch(url, {
				headers: { Accept: "application/json", "User-Agent": `jig/${this.#version}` },
				signal: AbortSignal.timeout(REQUEST_MS),
			});
			if (!response.ok) return null;
			return (await response.json()) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	async #form(url: string, body: URLSearchParams): Promise<Record<string, unknown> | null> {
		try {
			const response = await this.#fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
					"User-Agent": `jig/${this.#version}`,
				},
				body,
				signal: AbortSignal.timeout(REQUEST_MS),
			});
			if (!response.ok) return null;
			return (await response.json()) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	/** Where to sign in for a server, from its protected-resource metadata and its issuer's metadata. */
	async #discover(
		resource: string,
		challenge: string | null,
	): Promise<{ endpoints: Endpoints; scope: string | null }> {
		const at = new URL(resource);
		const path = at.pathname === "/" ? "" : at.pathname;
		const metadataUrls = [
			param(challenge, "resource_metadata"),
			`${at.origin}/.well-known/oauth-protected-resource${path}`,
			`${at.origin}/.well-known/oauth-protected-resource`,
		].filter((url): url is string => Boolean(url));
		let metadata: Record<string, unknown> | null = null;
		for (const url of metadataUrls) {
			metadata = await this.#json(url);
			if (metadata) break;
		}
		const servers = metadata?.authorization_servers;
		const issuer =
			Array.isArray(servers) && typeof servers[0] === "string" ? servers[0] : at.origin;
		const base = new URL(issuer);
		const issuerPath = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
		const candidates = [
			`${base.origin}/.well-known/oauth-authorization-server${issuerPath}`,
			`${base.origin}/.well-known/openid-configuration${issuerPath}`,
			`${base.origin}${issuerPath}/.well-known/openid-configuration`,
		];
		for (const url of candidates) {
			const found = await this.#json(url);
			if (
				found &&
				typeof found.authorization_endpoint === "string" &&
				typeof found.token_endpoint === "string"
			) {
				return {
					endpoints: {
						issuer,
						authorization: found.authorization_endpoint,
						token: found.token_endpoint,
						...(typeof found.registration_endpoint === "string"
							? { registration: found.registration_endpoint }
							: {}),
					},
					scope: param(challenge, "scope"),
				};
			}
		}
		throw new Error("The server did not say where to sign in.");
	}

	/** Registers Jig as a public client of the authorization server (RFC 7591). */
	async #register(endpoints: Endpoints): Promise<Saved["client"]> {
		if (!endpoints.registration) {
			throw new Error(
				"This server only accepts clients registered in advance. Add its client ID and secret to its entry in mcp.json.",
			);
		}
		let answer: Record<string, unknown> | null = null;
		try {
			const response = await this.#fetch(endpoints.registration, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					"User-Agent": `jig/${this.#version}`,
				},
				body: JSON.stringify({
					client_name: "Jig",
					redirect_uris: [this.#redirect],
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
					token_endpoint_auth_method: "none",
					software_version: this.#version,
				}),
				signal: AbortSignal.timeout(REQUEST_MS),
			});
			if (response.ok) answer = (await response.json()) as Record<string, unknown>;
		} catch {
			answer = null;
		}
		if (!answer || typeof answer.client_id !== "string") {
			throw new Error("The server did not let Jig register to sign in.");
		}
		return {
			id: answer.client_id,
			...(typeof answer.client_secret === "string" ? { secret: answer.client_secret } : {}),
			redirectUri: this.#redirect,
			registered: true,
		};
	}
}
