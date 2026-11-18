/**
 * Yew Harness's own address, which sessions' tools keep off: the browser (mcp.ts) and open_url
 * (tools/web.ts). Opening it could put a decision in front of a tool that acts for the session.
 */
export const LOOPBACK =
	/^(?:127(?:\.\d{1,3}){3}|localhost\.?|\[::1\]|\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\])$/i;

/**
 * Whether a text names an address of Yew Harness itself: this computer at Yew Harness's port, as
 * written (127.0.0.1:4777, localhost:4777) or in a form a browser reads as the same place
 * (http://127.1:4777, http:\\localhost:4777, view-source: and blob: addresses).
 */
export function namesHarness(text: string, port: number): boolean {
	const plain = new RegExp(`(?:127(?:\\.\\d{1,3}){3}|localhost\\.?|\\[::1\\]):${port}(?!\\d)`, "i");
	if (plain.test(text)) return true;
	for (const [candidate] of text.matchAll(/[a-z][a-z0-9+.-]*:[/\\]{2}[^\s"'<>()]*/gi)) {
		try {
			const url = new URL(candidate);
			if (url.port === String(port) && LOOPBACK.test(url.hostname)) return true;
		} catch {
			// Not an address a browser would open.
		}
	}
	return false;
}
