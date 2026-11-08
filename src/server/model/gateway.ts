/**
 * The model layer: the only place that imports the model library (AGENTS.md). Everything else talks to
 * models through `ModelGateway` and the message types in `src/shared/messages.ts`.
 */
import {
	type Api,
	type AuthContext,
	type Context,
	type Credential,
	type CredentialStore,
	clampThinkingLevel,
	createModels,
	createProvider,
	getSupportedThinkingLevels,
	isContextOverflow,
	type ThinkingLevel as LibraryThinkingLevel,
	type Message,
	type Model,
	type MutableModels,
	type Provider,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { AssistantMessage, JsonObject, ModelMessage } from "../../shared/messages.ts";
import type { ThinkingLevel } from "../../shared/types.ts";
import { invalid, JigError } from "../errors.ts";
import type { KeyStore } from "../keys.ts";

// Compile-time guarantees that Jig's stored message shapes and the library's stay interchangeable.
type Assert<T extends true> = T;
export type _MessagesFitLibrary = Assert<ModelMessage extends Message ? true : false>;
export type _LibraryResultFitsJig = Assert<
	import("@earendil-works/pi-ai").AssistantMessage extends AssistantMessage ? true : false
>;

export type Region = "cn" | "global" | "custom";

export interface ProviderInfo {
	id: string;
	name: string;
	region: Region;
	baseUrl: string;
	keyRequired: boolean;
	custom: boolean;
}

export interface ModelInfo {
	provider: string;
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	/** Thinking levels this model accepts, "off" included when it can answer without thinking. */
	thinkingLevels: ThinkingLevel[];
	input: ("text" | "image")[];
	/** US dollars per million tokens. */
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface ToolSpec {
	name: string;
	description: string;
	parameters: JsonObject;
}

export interface ModelRequest {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	systemPrompt: string;
	messages: ModelMessage[];
	tools: ToolSpec[];
	signal?: AbortSignal;
	/** Lets providers that support it route and cache by session. */
	sessionId?: string;
}

/** An OpenAI-compatible endpoint the person adds: another vendor, or a model running locally. */
export interface CustomProviderConfig {
	id: string;
	name: string;
	baseUrl: string;
	keyRequired: boolean;
	models: {
		id: string;
		name?: string;
		contextWindow: number;
		maxTokens: number;
		reasoning?: boolean;
		input?: ("text" | "image")[];
		cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
	}[];
}

/** Providers registered in mainland China; the default comes from this list (spec 21.6). */
const CN_PROVIDERS = new Set([
	"deepseek",
	"moonshotai-cn",
	"zai-coding-cn",
	"minimax-cn",
	"qwen-token-plan-cn",
	"xiaomi",
	"xiaomi-token-plan-cn",
	"ant-ling",
]);

/**
 * Built-in providers Jig does not offer: they sign in through an account or a cloud SDK instead of an
 * API key, or need extra account configuration. Jig only uses API keys (docs/prior-art.md, section 3).
 */
const HIDDEN_PROVIDERS = new Set([
	"amazon-bedrock",
	"google-vertex",
	"azure",
	"openai-codex",
	"github-copilot",
	"radius",
	"typesafe",
	"cloudflare-workers-ai",
	"cloudflare-ai-gateway",
]);

/** Sent to keyless local servers, which ignore it; the OpenAI client needs some value. */
const KEYLESS = "jig-no-key";

/** Keys come only from the keychain: never from environment variables or files (AGENTS.md). */
const NO_AMBIENT_AUTH: AuthContext = {
	env: async () => undefined,
	fileExists: async () => false,
};

class KeychainCredentials implements CredentialStore {
	readonly #keys: KeyStore;

	constructor(keys: KeyStore) {
		this.#keys = keys;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		const key = await this.#keys.get(providerId);
		return key ? { type: "api_key", key } : undefined;
	}

	async list() {
		return [];
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		const current = await this.read(providerId);
		const next = await fn(current);
		if (next?.type === "api_key" && next.key) await this.#keys.set(providerId, next.key);
		return next ?? current;
	}

	async delete(providerId: string): Promise<void> {
		await this.#keys.delete(providerId);
	}
}

function customProvider(config: CustomProviderConfig): Provider {
	return createProvider({
		id: config.id,
		name: config.name,
		baseUrl: config.baseUrl,
		auth: {
			apiKey: {
				name: `${config.name} API key`,
				resolve: async ({ credential }) => {
					if (credential?.key) return { auth: { apiKey: credential.key }, source: "keychain" };
					return config.keyRequired ? undefined : { auth: { apiKey: KEYLESS }, source: "none" };
				},
			},
		},
		models: config.models.map(
			(model): Model<"openai-completions"> => ({
				id: model.id,
				name: model.name ?? model.id,
				api: "openai-completions",
				provider: config.id,
				baseUrl: config.baseUrl,
				reasoning: model.reasoning ?? false,
				input: model.input ?? ["text"],
				cost: {
					input: model.cost?.input ?? 0,
					output: model.cost?.output ?? 0,
					cacheRead: model.cost?.cacheRead ?? 0,
					cacheWrite: model.cost?.cacheWrite ?? 0,
				},
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
			}),
		),
		api: openAICompletionsApi(),
	});
}

function toInfo(model: Model<Api>): ModelInfo {
	const levels = model.reasoning ? (getSupportedThinkingLevels(model) as ThinkingLevel[]) : ["off"];
	return {
		provider: model.provider,
		id: model.id,
		name: model.name,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		reasoning: model.reasoning,
		thinkingLevels: levels as ThinkingLevel[],
		input: model.input.filter(
			(kind): kind is "text" | "image" => kind === "text" || kind === "image",
		),
		cost: {
			input: model.cost.input,
			output: model.cost.output,
			cacheRead: model.cost.cacheRead,
			cacheWrite: model.cost.cacheWrite,
		},
	};
}

export interface GatewayOptions {
	keys: KeyStore;
	/** Jig's version, sent as `User-Agent: jig/<version>`. */
	version: string;
	custom?: CustomProviderConfig[];
	/** Replaces the built-in providers; tests pass the library's faux provider here. */
	providers?: Provider[];
}

export class ModelGateway {
	readonly #models: MutableModels;
	readonly #keys: KeyStore;
	readonly #custom = new Map<string, CustomProviderConfig>();

	constructor(options: GatewayOptions) {
		this.#keys = options.keys;
		this.#models = createModels({
			credentials: new KeychainCredentials(options.keys),
			authContext: NO_AMBIENT_AUTH,
			// No attribution headers, and our own User-Agent (AGENTS.md "数据在本机").
			identity: { userAgent: { custom: `jig/${options.version}` }, attribution: null },
		});
		const providers = options.providers ?? builtinProviders();
		for (const provider of providers) {
			if (!HIDDEN_PROVIDERS.has(provider.id)) this.#models.setProvider(provider);
		}
		this.setCustomProviders(options.custom ?? []);
	}

	setCustomProviders(configs: CustomProviderConfig[]): void {
		for (const id of this.#custom.keys()) this.#models.deleteProvider(id);
		this.#custom.clear();
		for (const config of configs) {
			if (this.#models.getProvider(config.id)) {
				throw invalid(`${config.id} is already a built-in provider.`, "id");
			}
			this.#custom.set(config.id, config);
			this.#models.setProvider(customProvider(config));
		}
	}

	providers(): ProviderInfo[] {
		return this.#models.getProviders().map((provider) => {
			const custom = this.#custom.get(provider.id);
			return {
				id: provider.id,
				name: provider.name,
				region: custom ? "custom" : CN_PROVIDERS.has(provider.id) ? "cn" : "global",
				baseUrl: provider.baseUrl ?? custom?.baseUrl ?? "",
				keyRequired: custom ? custom.keyRequired : true,
				custom: custom !== undefined,
			};
		});
	}

	provider(id: string): ProviderInfo | undefined {
		return this.providers().find((provider) => provider.id === id);
	}

	models(provider?: string): ModelInfo[] {
		return this.#models.getModels(provider).map(toInfo);
	}

	model(provider: string, id: string): ModelInfo | undefined {
		const model = this.#models.getModel(provider, id);
		return model ? toInfo(model) : undefined;
	}

	/** Throws a 400 error when the provider or model is unknown. */
	check(provider: string, id: string): void {
		if (!this.#models.getProvider(provider)) {
			throw invalid(`Unknown provider: ${provider}.`, "provider");
		}
		if (!this.#models.getModel(provider, id)) {
			throw invalid(`${provider} has no model ${id}.`, "model");
		}
	}

	saveKey(provider: string, key: string): Promise<void> {
		return this.#keys.set(provider, key);
	}

	deleteKey(provider: string): Promise<boolean> {
		return this.#keys.delete(provider);
	}

	async hasKey(provider: string): Promise<boolean> {
		const custom = this.#custom.get(provider);
		if (custom && !custom.keyRequired) return true;
		return (await this.#keys.get(provider)) !== null;
	}

	/**
	 * Streams one model response. `onDraft` sees the response so far after each update; it is the same
	 * object every time and keeps changing, so copy it if you keep it. Resolves with the final message,
	 * whose stopReason is "error" or "aborted" when the request failed or was stopped.
	 */
	async stream(
		request: ModelRequest,
		onDraft?: (draft: AssistantMessage) => void,
	): Promise<AssistantMessage> {
		const model = this.#models.getModel(request.provider, request.model);
		if (!model) throw invalid(`${request.provider} has no model ${request.model}.`, "model");
		if (!(await this.hasKey(request.provider))) {
			throw new JigError(
				"missing-api-key",
				400,
				`There is no API key for ${request.provider}. Add one in Settings, or run: jig key set ${request.provider}`,
				{ provider: request.provider },
			);
		}
		const context: Context = {
			systemPrompt: request.systemPrompt,
			messages: request.messages,
			tools: request.tools,
		};
		const options: SimpleStreamOptions = { cacheRetention: "short" };
		if (request.signal) options.signal = request.signal;
		if (request.sessionId) options.sessionId = request.sessionId;
		if (model.reasoning && request.thinking !== "off") {
			const level = clampThinkingLevel(model, request.thinking);
			if (level !== "off") options.reasoning = level as LibraryThinkingLevel;
		}
		const stream = this.#models.streamSimple(model, context, options);
		for await (const event of stream) {
			if (onDraft && "partial" in event) onDraft(event.partial);
		}
		return await stream.result();
	}

	/** True when a failed response means the conversation no longer fits the model's context window. */
	isContextOverflow(message: AssistantMessage, provider: string, model: string): boolean {
		const info = this.#models.getModel(provider, model);
		return isContextOverflow(
			message as import("@earendil-works/pi-ai").AssistantMessage,
			info?.contextWindow,
		);
	}
}
