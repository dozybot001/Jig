/**
 * Scripted model responses for deterministic tests (AGENTS.md: tests never call a real model).
 * Re-exported here so tests, like the rest of Jig, reach the model library only through this layer.
 */
export {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@earendil-works/pi-ai";
