import { execFile } from "node:child_process";
import type { JsonObject } from "../shared/messages.ts";

/**
 * Computer control may not act on Yew Harness itself (founder, 11-18: 「电脑操控不能操控自己的界面」;
 * spec 21.7): a click, a drag, a scroll or a key that would land in Yew Harness's window or in a
 * browser window showing its page is refused before it runs, in every permission mode. Otherwise
 * it could press "Allow" on a decision for the person. Taking screenshots and moving the pointer
 * still work.
 *
 * Before each action Yew reads what is on the screen: the windows in front-to-back order with their
 * owners, titles and places, the main screen's size and the pointer. Yew Harness's page is titled
 * "Yew Harness" (with the approval center's count in front), in its own window and in a browser.
 * Where a browser window's title cannot be read (macOS gives titles only with the Screen Recording
 * permission), it may be showing Yew Harness, so it is not acted on either.
 */
export interface ScreenWindow {
	owner: string;
	name: string | null;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ScreenState {
	screen: { w: number; h: number };
	cursor: { x: number; y: number };
	/** On-screen windows of the normal layer, the front one first. */
	windows: ScreenWindow[];
}

/** What the screen check found for an action: nothing in the way, or why it is refused. */
export type ScreenCheck = { ok: true } | { ok: false; reason: string };

const BROWSERS = new Set([
	"Google Chrome",
	"Google Chrome Canary",
	"Chromium",
	"Safari",
	"Safari Technology Preview",
	"Arc",
	"Firefox",
	"Microsoft Edge",
	"Brave Browser",
	"Opera",
	"Vivaldi",
	"Orion",
]);

/** Whether a window is Yew Harness's, or a browser window whose page cannot be told. */
export function harnessWindow(window: ScreenWindow): "harness" | "unknown" | null {
	if (window.owner === "Yew Harness" || window.owner === "Yew") return "harness";
	if (window.name !== null && window.name.includes("Yew Harness")) return "harness";
	if (window.name === null && BROWSERS.has(window.owner)) return "unknown";
	return null;
}

/**
 * computer-use-mcp gets coordinates in the space of its downscaled screenshot and scales them up to
 * the main screen's points the same way (its tools/computer.js): this is that scale.
 */
export function apiToScreen(screen: { w: number; h: number }): number {
	const longEdge = Math.max(screen.w, screen.h);
	const pixels = screen.w * screen.h;
	const edge = longEdge > 1568 ? 1568 / longEdge : 1;
	const area = pixels > 1.15 * 1024 * 1024 ? Math.sqrt((1.15 * 1024 * 1024) / pixels) : 1;
	return 1 / Math.min(edge, area);
}

/** What only looks, or only moves the pointer; every other action acts on a window. */
const LOOKING = new Set(["get_screenshot", "get_cursor_position", "mouse_move", "wait"]);
/** Actions that go to the front window: keys and typed text. */
const KEYBOARD = new Set(["key", "type", "hold_key"]);

/** The front window under a point, if any. */
function windowAt(state: ScreenState, x: number, y: number): ScreenWindow | null {
	return state.windows.find((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) ?? null;
}

/** Checks one action of computer control against what is on the screen now. */
export function checkAction(args: JsonObject, state: ScreenState): ScreenCheck {
	const action = typeof args.action === "string" ? args.action : "";
	const affected: (ScreenWindow | null)[] = [];
	if (LOOKING.has(action)) return { ok: true };
	if (KEYBOARD.has(action)) affected.push(state.windows[0] ?? null);
	else {
		// Any other action, a new one included, acts where the pointer is or where it is sent.
		const scale = apiToScreen(state.screen);
		const coordinate = Array.isArray(args.coordinate) ? args.coordinate : null;
		const point =
			coordinate && typeof coordinate[0] === "number" && typeof coordinate[1] === "number"
				? { x: Math.round(coordinate[0] * scale), y: Math.round(coordinate[1] * scale) }
				: null;
		// A click without a place lands where the pointer is; a drag starts there.
		if (!point || action === "left_click_drag") {
			affected.push(windowAt(state, state.cursor.x, state.cursor.y));
		}
		if (point) affected.push(windowAt(state, point.x, point.y));
	}
	for (const window of affected) {
		const kind = window ? harnessWindow(window) : null;
		if (kind === "harness") {
			return {
				ok: false,
				reason:
					"computer: this step would act on Yew Harness itself (its window, or a browser window showing it). Computer control may not do that, in any permission mode: decisions there are the person's. Act on another window, or ask the person.",
			};
		}
		if (kind === "unknown") {
			return {
				ok: false,
				reason: `computer: Yew Harness cannot read which page this ${window?.owner ?? "browser"} window shows (that needs the Screen Recording permission), so it may be Yew Harness itself; computer control does not act on it. Give the program that runs Yew Harness the Screen Recording permission, or act on another window.`,
			};
		}
	}
	return { ok: true };
}

/** Reads the screen on macOS with JavaScript for Automation (CoreGraphics through its bridge). */
const MAC_SCRIPT = `ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run() {
	const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID));
	const windows = [];
	for (let i = 0; i < list.count; i++) {
		const w = list.objectAtIndex(i);
		if (ObjC.unwrap(w.objectForKey('kCGWindowLayer')) !== 0) continue;
		const b = w.objectForKey('kCGWindowBounds');
		const name = w.objectForKey('kCGWindowName');
		windows.push({
			owner: String(ObjC.unwrap(w.objectForKey('kCGWindowOwnerName')) || ''),
			name: name.isNil() ? null : String(ObjC.unwrap(name)),
			x: ObjC.unwrap(b.objectForKey('X')), y: ObjC.unwrap(b.objectForKey('Y')),
			w: ObjC.unwrap(b.objectForKey('Width')), h: ObjC.unwrap(b.objectForKey('Height')),
		});
	}
	const d = $.CGDisplayBounds($.CGMainDisplayID());
	const loc = $.CGEventGetLocation($.CGEventCreate(null));
	return JSON.stringify({ screen: { w: d.size.width, h: d.size.height }, cursor: { x: loc.x, y: loc.y }, windows });
}`;

const run = (file: string, args: string[]): Promise<string | null> =>
	new Promise((resolve) => {
		execFile(file, args, { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? null : stdout),
		);
	});

/** On X11 with xdotool: the Yew Harness windows by title, the front window and the pointer. */
async function readLinux(): Promise<ScreenState | null> {
	const pointer = await run("xdotool", ["getmouselocation", "--shell"]);
	const front = await run("xdotool", ["getactivewindow", "getwindowname"]);
	const display = await run("xdotool", ["getdisplaygeometry"]);
	if (pointer === null || front === null || display === null) return null;
	const at = (key: string) => Number(new RegExp(`^${key}=(-?\\d+)$`, "m").exec(pointer)?.[1]);
	const [w, h] = display.trim().split(/\s+/).map(Number);
	const windows: ScreenWindow[] = [];
	// The front window first: keys go there.
	windows.push({ owner: "", name: front.trim(), x: 0, y: 0, w: 0, h: 0 });
	const found = (await run("xdotool", ["search", "--onlyvisible", "--name", "Yew Harness"])) ?? "";
	for (const id of found.split(/\s+/).filter(Boolean)) {
		const geometry = await run("xdotool", ["getwindowgeometry", "--shell", id]);
		if (!geometry) continue;
		const value = (key: string) => Number(new RegExp(`^${key}=(-?\\d+)$`, "m").exec(geometry)?.[1]);
		windows.push({
			owner: "",
			name: "Yew Harness",
			x: value("X"),
			y: value("Y"),
			w: value("WIDTH"),
			h: value("HEIGHT"),
		});
	}
	return {
		screen: { w: w ?? 0, h: h ?? 0 },
		cursor: { x: at("X"), y: at("Y") },
		windows,
	};
}

/** What is on the screen now; null when it cannot be read. */
export async function readScreen(
	platform: NodeJS.Platform = process.platform,
): Promise<ScreenState | null> {
	if (platform === "darwin") {
		const out = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_SCRIPT]);
		if (out === null) return null;
		try {
			return JSON.parse(out) as ScreenState;
		} catch {
			return null;
		}
	}
	if (platform === "linux") return readLinux();
	return null;
}

/** The check before a computer control action: refused when the screen cannot be read. */
export async function keepComputerOffHarness(
	args: JsonObject,
	read: () => Promise<ScreenState | null> = () => readScreen(),
): Promise<string | null> {
	const action = typeof args.action === "string" ? args.action : "";
	if (LOOKING.has(action)) return null;
	const state = await read();
	if (!state) {
		return "computer: Yew Harness could not read what is on the screen, so it cannot tell whether this step would act on Yew Harness itself; computer control does not act now.";
	}
	const check = checkAction(args, state);
	return check.ok ? null : check.reason;
}
