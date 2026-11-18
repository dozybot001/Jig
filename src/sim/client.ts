/**
 * Signs an evaluation's controller in to a running `yew serve`, as the person (docs/sim.md, section 1):
 * the one-time link `yew serve` prints is traded for the browser cookie, which stays in the controller.
 */

export interface SimClient {
	/** The service's address, such as http://127.0.0.1:4799. */
	readonly origin: string;
	/** A request to the local API as the person: the path starts with /api/, the body is sent as JSON. */
	request(method: string, path: string, body?: unknown): Promise<Response>;
}

/** The one-time sign-in token in what `yew serve` printed, or null when it has not printed it yet. */
export function signInToken(output: string): { port: number; token: string } | null {
	const link = /http:\/\/127\.0\.0\.1:(\d+)\/#t=([\w-]+)/.exec(output);
	return link ? { port: Number(link[1]), token: link[2] as string } : null;
}

/** Trades the token in `output` (what `yew serve` printed) for the cookie, and returns a client. */
export async function signIn(output: string): Promise<SimClient> {
	const found = signInToken(output);
	if (!found)
		throw new Error("No sign-in link in that output; wait until yew serve has printed it.");
	const origin = `http://127.0.0.1:${found.port}`;
	const exchange = await fetch(`${origin}/api/auth/exchange`, {
		method: "POST",
		headers: { "content-type": "application/json", origin },
		body: JSON.stringify({ token: found.token }),
	});
	if (exchange.status !== 204) {
		throw new Error(`Signing in failed (${exchange.status}): ${await exchange.text()}`);
	}
	const cookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0];
	if (!cookie) throw new Error("Signing in gave no cookie.");
	return {
		origin,
		request(method, path, body) {
			return fetch(`${origin}${path}`, {
				method,
				headers: {
					cookie,
					origin,
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		},
	};
}
