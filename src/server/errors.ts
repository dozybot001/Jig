/** Domain errors; the HTTP layer maps each to an RFC 9457 problem type. */
export class JigError extends Error {
	readonly code: string;
	readonly status: number;
	readonly details: Record<string, unknown> | undefined;

	constructor(code: string, status: number, message: string, details?: Record<string, unknown>) {
		super(message);
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export const notFound = (what: string, id: string) =>
	new JigError("not-found", 404, `${what} ${id} does not exist.`);

export const invalid = (message: string, field?: string) =>
	new JigError("invalid-request", 400, message, field ? { field } : undefined);

export const conflict = (message: string, details?: Record<string, unknown>) =>
	new JigError("conflict", 409, message, details);
