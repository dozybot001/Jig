/**
 * What a provider says is left on the account behind an API key. Only providers that document a
 * balance endpoint for an ordinary API key are here; for the others the person looks in the
 * provider's own console. Jig shows the provider's numbers as they come and does no arithmetic of
 * its own on them.
 *
 * - DeepSeek: https://api-docs.deepseek.com/api/get-user-balance
 * - Moonshot (Kimi), mainland China: https://platform.kimi.com/docs/api/balance
 */
import { JigError } from "../errors.ts";

export interface BalanceAmount {
	/** ISO 4217 code, as the provider names it. */
	currency: string;
	/** What can be spent. Kept as the provider's own text, so no digits are lost. */
	total: string;
	/** The part the provider gave away (trial credit, vouchers), when it says. */
	granted?: string;
	/** The part the person paid in, when it says. */
	paid?: string;
}

export interface Balance {
	amounts: BalanceAmount[];
	/** Whether the provider says the balance is enough to call the API, when it says. */
	available?: boolean;
}

interface Reader {
	url: string;
	read(body: unknown): Balance;
}

type Json = Record<string, unknown>;
const text = (value: unknown): string | undefined =>
	typeof value === "string" || typeof value === "number" ? String(value) : undefined;

const READERS: Record<string, Reader> = {
	deepseek: {
		url: "https://api.deepseek.com/user/balance",
		read(body) {
			const data = body as { is_available?: unknown; balance_infos?: Json[] };
			const amounts = (data.balance_infos ?? []).flatMap((info): BalanceAmount[] => {
				const total = text(info.total_balance);
				const currency = text(info.currency);
				if (!total || !currency) return [];
				const granted = text(info.granted_balance);
				const paid = text(info.topped_up_balance);
				return [{ currency, total, ...(granted ? { granted } : {}), ...(paid ? { paid } : {}) }];
			});
			return {
				amounts,
				...(typeof data.is_available === "boolean" ? { available: data.is_available } : {}),
			};
		},
	},
	"moonshotai-cn": {
		url: "https://api.moonshot.cn/v1/users/me/balance",
		read(body) {
			const data = ((body as Json).data ?? {}) as Json;
			const total = text(data.available_balance);
			if (!total) return { amounts: [] };
			const granted = text(data.voucher_balance);
			const paid = text(data.cash_balance);
			return {
				amounts: [
					{ currency: "CNY", total, ...(granted ? { granted } : {}), ...(paid ? { paid } : {}) },
				],
				available: Number(total) > 0,
			};
		},
	},
};

/** Whether Jig can ask this provider for the balance. */
export function hasBalance(provider: string): boolean {
	return provider in READERS;
}

/** Asks the provider. `urls` replaces the providers' addresses in tests. */
export async function readBalance(
	provider: string,
	key: string,
	version: string,
	urls: Record<string, string> = {},
): Promise<Balance> {
	const reader = READERS[provider];
	if (!reader) {
		throw new JigError(
			"no-balance",
			404,
			`${provider} has no way to ask for the balance with an API key. Look in its console.`,
			{ provider },
		);
	}
	let response: Response;
	try {
		response = await fetch(urls[provider] ?? reader.url, {
			headers: {
				Authorization: `Bearer ${key}`,
				Accept: "application/json",
				"User-Agent": `jig/${version}`,
			},
			signal: AbortSignal.timeout(15_000),
		});
	} catch (error) {
		throw new JigError(
			"provider-unreachable",
			502,
			`Could not reach ${provider}: ${(error as Error).message}`,
			{ provider },
		);
	}
	if (!response.ok) {
		// The body may repeat what was sent; only the status goes on.
		throw new JigError(
			"provider-refused",
			502,
			`${provider} answered ${response.status} to the balance request.`,
			{ provider, status: response.status },
		);
	}
	const balance = reader.read(await response.json().catch(() => ({})));
	if (balance.amounts.length === 0) {
		throw new JigError(
			"provider-refused",
			502,
			`${provider} answered, but not with a balance Jig can read.`,
			{ provider },
		);
	}
	return balance;
}
