// Computer control may not act on Yew Harness itself (founder, 11-18; computer-guard.ts). The screen
// is given by the test; nothing reads the real one or acts on it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	apiToScreen,
	checkAction,
	harnessWindow,
	keepComputerOffHarness,
	type ScreenState,
} from "../src/server/computer-guard.ts";

const screen = (windows: ScreenState["windows"], cursor = { x: 10, y: 10 }): ScreenState => ({
	screen: { w: 1440, h: 900 },
	cursor,
	windows,
});
const yew = { owner: "Yew Harness", name: "Yew Harness", x: 0, y: 0, w: 720, h: 900 };
const editor = { owner: "Code", name: "main.swift — Yew", x: 720, y: 0, w: 720, h: 900 };
const chrome = (name: string | null) => ({
	owner: "Google Chrome",
	name,
	x: 0,
	y: 0,
	w: 1440,
	h: 900,
});

describe("computer control and Yew Harness's own window", () => {
	test("Yew Harness's window and pages are told by owner and title; an unreadable browser is unknown", () => {
		assert.equal(harnessWindow(yew), "harness");
		assert.equal(harnessWindow(chrome("(3) Yew Harness - Google Chrome")), "harness");
		assert.equal(harnessWindow(chrome("Inbox - Google Chrome")), null);
		assert.equal(harnessWindow(chrome(null)), "unknown");
		assert.equal(harnessWindow(editor), null);
	});

	test("keys go to the front window: refused when it is Yew Harness", () => {
		assert.equal(checkAction({ action: "type", text: "y" }, screen([yew, editor])).ok, false);
		assert.equal(checkAction({ action: "key", text: "Return" }, screen([editor, yew])).ok, true);
	});

	test("a click is checked where it lands, in the screenshot's scale", () => {
		// 1440×900 is downscaled for the model; its coordinates are scaled back up the same way.
		const scale = apiToScreen({ w: 1440, h: 900 });
		assert.ok(scale > 1);
		const inEditor = { action: "left_click", coordinate: [Math.ceil(1000 / scale), 100] };
		const inYew = { action: "left_click", coordinate: [100, 100] };
		assert.equal(checkAction(inEditor, screen([editor, yew])).ok, true);
		assert.equal(checkAction(inYew, screen([editor, yew])).ok, false);
		// Without a place it lands where the pointer is; a drag is checked at both ends.
		assert.equal(checkAction({ action: "left_click" }, screen([yew], { x: 50, y: 50 })).ok, false);
		const drag = { action: "left_click_drag", coordinate: [Math.ceil(1000 / scale), 100] };
		assert.equal(checkAction(drag, screen([editor, yew], { x: 50, y: 50 })).ok, false);
		// An action it does not know acts, so it is checked too.
		assert.equal(checkAction({ action: "triple_click" }, screen([yew], { x: 5, y: 5 })).ok, false);
	});

	test("looking and moving the pointer are not checked", async () => {
		let read = 0;
		const reader = async () => {
			read++;
			return screen([yew]);
		};
		assert.equal(await keepComputerOffHarness({ action: "get_screenshot" }, reader), null);
		assert.equal(
			await keepComputerOffHarness({ action: "mouse_move", coordinate: [5, 5] }, reader),
			null,
		);
		assert.equal(read, 0);
	});

	test("a browser whose page cannot be read is not acted on, nor is a screen that cannot be read", async () => {
		const unknown = await keepComputerOffHarness({ action: "type", text: "x" }, async () =>
			screen([chrome(null)]),
		);
		assert.match(unknown ?? "", /Screen Recording/);
		const blind = await keepComputerOffHarness({ action: "type", text: "x" }, async () => null);
		assert.match(blind ?? "", /could not read what is on the screen/);
	});
});
