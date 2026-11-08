/** Thin client for Jig's local API. Errors arrive as RFC 9457 problems with a request ID. */

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly requestId: string | undefined;
	readonly field: string | undefined;
	readonly provider: string | undefined;

	constructor(
		status: number,
		code: string,
		message: string,
		requestId?: string,
		field?: string,
		provider?: string,
	) {
		super(message);
		this.status = status;
		this.code = code;
		this.requestId = requestId;
		this.field = field;
		this.provider = provider;
	}
}

interface Problem {
	type?: string;
	title?: string;
	detail?: string;
	requestId?: string;
	field?: string;
	provider?: string;
}

export async function api<T = unknown>(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	path: string,
	body?: unknown,
	options: { idempotent?: boolean } = {},
): Promise<T> {
	const headers: Record<string, string> = {};
	if (body !== undefined) headers["Content-Type"] = "application/json";
	if (options.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();
	let response: Response;
	try {
		response = await fetch(path, {
			method,
			headers,
			credentials: "same-origin",
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	} catch {
		throw new ApiError(0, "network", "network");
	}
	if (response.status === 204) return undefined as T;
	const text = await response.text();
	if (!response.ok) {
		let problem: Problem = {};
		try {
			problem = JSON.parse(text) as Problem;
		} catch {
			// Not a problem document; fall back to the status line.
		}
		const code = problem.type?.split("/").pop() ?? "error";
		throw new ApiError(
			response.status,
			code,
			problem.detail ?? problem.title ?? response.statusText,
			problem.requestId ?? response.headers.get("X-Request-Id") ?? undefined,
			problem.field,
			problem.provider,
		);
	}
	return (text ? JSON.parse(text) : undefined) as T;
}

/** Follows `nextCursor` until a paginated list is complete. */
export async function all<T>(path: string): Promise<T[]> {
	const items: T[] = [];
	let cursor: string | null = null;
	do {
		const separator = path.includes("?") ? "&" : "?";
		const page: { items: T[]; nextCursor: string | null } = await api(
			"GET",
			`${path}${separator}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		);
		items.push(...page.items);
		cursor = page.nextCursor;
	} while (cursor);
	return items;
}
