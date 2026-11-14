// A tiny MCP server on standard streams for tests: two tools, one of which reports an error.
import { createInterface } from "node:readline";

const send = (message) =>
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
	const { id, method, params } = JSON.parse(line);
	if (id === undefined) return;
	if (method === "initialize") {
		send({
			id,
			result: {
				protocolVersion: params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "test", version: "1" },
			},
		});
	} else if (method === "tools/list") {
		send({
			id,
			result: {
				tools: [
					{
						name: "echo",
						description: "Says it back.",
						inputSchema: {
							type: "object",
							properties: { text: { type: "string" } },
							required: ["text"],
						},
					},
					{
						name: "env",
						description: "Reads one variable.",
						inputSchema: { type: "object", properties: { name: { type: "string" } } },
					},
					{ name: "bad name!", description: "Not offered." },
				],
			},
		});
	} else if (method === "tools/call" && params.name === "echo") {
		send({ id, result: { content: [{ type: "text", text: `echo: ${params.arguments.text}` }] } });
	} else if (method === "tools/call" && params.name === "env") {
		send({
			id,
			result: {
				content: [{ type: "text", text: process.env[params.arguments.name] ?? "(unset)" }],
				isError: params.arguments.name === "FAIL",
			},
		});
	} else {
		send({ id, error: { code: -32601, message: `no such method ${method}` } });
	}
});
