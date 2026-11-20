import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";

/**
 * Tracks IME composition state, including the macOS WebKit/WKWebView quirk where `compositionend`
 * fires immediately before the confirming `Enter` `keydown` with `isComposing === false`.
 */
export interface ImeState {
	composing: boolean;
	endedAt: number;
}

const WEBKIT_POST_COMPOSITION_MS = 100;

/** True when a keyboard event belongs to an IME candidate selection rather than a final command. */
export function isImeEvent(event: ReactKeyboardEvent | KeyboardEvent, state?: ImeState): boolean {
	const native = "nativeEvent" in event ? event.nativeEvent : event;
	if (native.isComposing || native.keyCode === 229) return true;
	if (state?.composing) return true;
	if (
		state &&
		state.endedAt > 0 &&
		performance.now() - state.endedAt < WEBKIT_POST_COMPOSITION_MS
	) {
		return true;
	}
	return false;
}

/** Provides composition handlers and an `isComposing(event)` check for text inputs and textareas. */
export function useImeGuard() {
	const state = useRef<ImeState>({ composing: false, endedAt: 0 });
	return {
		onCompositionStart: () => {
			state.current.composing = true;
		},
		onCompositionEnd: () => {
			state.current.composing = false;
			state.current.endedAt = performance.now();
		},
		isComposing: (event: ReactKeyboardEvent | KeyboardEvent) => isImeEvent(event, state.current),
	};
}
