import { Relay } from "./relay.ts";

// Jig's relay as a service: `node relay/main.ts`. PORT (default 8790) and HOST (default 0.0.0.0) come
// from the environment; TLS ends at the reverse proxy in front of it (server deployment standard).
const port = Number(process.env.PORT ?? 8790);
const relay = new Relay({ port, host: process.env.HOST ?? "0.0.0.0" });
const bound = await relay.listen();
process.stderr.write(`Jig relay listening on ${bound}\n`);

// A line of counts every ten minutes: connections only, never content (M3 plan, section 5).
const counts = setInterval(() => {
	const { desktops, phones } = relay.counts;
	process.stderr.write(`connected: ${desktops} Macs, ${phones} phones\n`);
}, 600_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		clearInterval(counts);
		void relay.close().then(() => process.exit(0));
	});
}
