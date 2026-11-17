import type {
	AssistantMessage,
	ModelMessage,
	ToolCallBlock,
	ToolResultMessage,
} from "../../shared/messages.ts";
import { messageText } from "../../shared/messages.ts";
import type { Entry, UsageTotals } from "../../shared/types.ts";
import { isJigNote } from "../from-jig.ts";

export const SUMMARY_HEADING =
	"[Summary of the earlier conversation, written by Yew when it shortened the context]";
export const REQUEST_HEADING =
	"[The latest message to you before that summary, word for word; it is still what you are working on]";
/** What Yew puts in front of its own messages to the model, which are stored like the person's. */
export const YEW_NOTE = "[From Yew, not from the person]";

/** Whether a stored message is one of Yew's own notes (or Jig's, from before the rename). */
export const isOwnNote = (text: string): boolean => text.startsWith(YEW_NOTE) || isJigNote(text);

function placeholder(call: ToolCallBlock, timestamp: number): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text: "This call did not run." }],
		isError: true,
		timestamp,
	};
}

/**
 * Turns stored entries into what the model sees. Providers require each tool call to be answered right
 * after the message that made it, so results are placed there whatever order they were stored in, and a
 * call without a result (after a crash, say) gets a placeholder. Notices are for the person only.
 */
export function toModelMessages(entries: Entry[]): ModelMessage[] {
	const results = new Map<string, ToolResultMessage>();
	for (const entry of entries) {
		if (entry.role === "toolResult" && !results.has(entry.message.toolCallId)) {
			results.set(entry.message.toolCallId, entry.message);
		}
	}
	const out: ModelMessage[] = [];
	for (const entry of entries) {
		switch (entry.role) {
			case "compaction":
				out.push({
					role: "user",
					content: entry.compaction.request
						? `${SUMMARY_HEADING}\n\n${entry.compaction.summary}\n\n${REQUEST_HEADING}\n\n${entry.compaction.request}`
						: `${SUMMARY_HEADING}\n\n${entry.compaction.summary}`,
					timestamp: entry.compaction.timestamp,
				});
				break;
			case "system":
			case "user":
				out.push(entry.message);
				break;
			case "assistant": {
				const message = entry.message;
				if (message.content.length === 0) break;
				out.push(message);
				for (const block of message.content) {
					if (block.type !== "toolCall") continue;
					out.push(results.get(block.id) ?? placeholder(block, message.timestamp));
				}
				break;
			}
			default:
				break;
		}
	}
	return out;
}

/** An interrupted response may end in a half-written tool call; keep the text and drop the call. */
export function sanitizeInterrupted(message: AssistantMessage): AssistantMessage {
	if (message.stopReason !== "aborted" && message.stopReason !== "error") return message;
	return { ...message, content: message.content.filter((block) => block.type !== "toolCall") };
}

const TOOL_RESULT_CHARS = 2000;

/** The transcript as plain text for the summary request; tool results are cut short (prior-art 4.4). */
export function transcriptForSummary(entries: Entry[]): string {
	const lines: string[] = [];
	for (const entry of entries) {
		if (entry.role === "compaction") {
			lines.push(`## Earlier summary\n${entry.compaction.summary}`);
			if (entry.compaction.request) lines.push(`## Person\n${entry.compaction.request}`);
		} else if (entry.role === "user") lines.push(`## Person\n${messageText(entry.message)}`);
		else if (entry.role === "system") lines.push(`## Update from Yew\n${entry.message.content}`);
		else if (entry.role === "assistant") {
			const text = entry.message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			if (text) lines.push(`## Agent\n${text}`);
			for (const block of entry.message.content) {
				if (block.type === "toolCall")
					lines.push(`## Tool call: ${block.name}\n${JSON.stringify(block.arguments)}`);
			}
		} else if (entry.role === "toolResult") {
			let text = messageText(entry.message);
			if (text.length > TOOL_RESULT_CHARS) text = `${text.slice(0, TOOL_RESULT_CHARS)}\n[cut]`;
			lines.push(
				`## Tool result: ${entry.message.toolName}${entry.message.isError ? " (error)" : ""}\n${text}`,
			);
		}
	}
	return lines.join("\n\n");
}

/** Rough token count (four characters per token), used to choose what compaction keeps. */
export function estimateTokens(entry: Entry): number {
	return Math.ceil(JSON.stringify(entry).length / 4);
}

/** What a response used, as Yew adds it up. */
export function usageTotals(message: AssistantMessage): UsageTotals {
	const usage = message.usage;
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		cost: usage.cost.total,
	};
}
