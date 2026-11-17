/**
 * A stand-in model endpoint for looking at how Yew shows failed requests, without a real provider:
 * it speaks the OpenAI chat API, refuses the first requests of every answer with "503 overloaded"
 * and then answers. Add it in a throwaway Yew (new YEW_HOME, YEW_KEYCHAIN=off) as a custom provider
 * with the base URL http://127.0.0.1:<port>/v1 and no key.
 *
 *   node scripts/flaky-provider.ts [port] [failures before each answer]
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8799);
const failures = Number(process.argv[3] ?? 3);
let failed = 0;

createServer((req, res) => {
	req.resume();
	req.on("end", () => {
		if (failed < failures) {
			failed++;
			res.writeHead(503, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: { message: "The service is overloaded", type: "error" } }));
			return;
		}
		failed = 0;
		const meta = { id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky" };
		const chunk = (body: object) => res.write(`data: ${JSON.stringify(body)}\n\n`);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		chunk({
			...meta,
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "Answered after the failures." },
					finish_reason: null,
				},
			],
		});
		chunk({
			...meta,
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		});
		res.end("data: [DONE]\n\n");
	});
}).listen(port, "127.0.0.1", () => {
	process.stderr.write(
		`flaky provider at http://127.0.0.1:${port}/v1 (${failures} failures before each answer)\n`,
	);
});
