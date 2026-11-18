/**
 * What Yew at the foot of the sidebar says (blueprint, section 12): the one thing that matters most
 * right now, in this order: things waiting for the person, a session that failed, a session that
 * finished and waits for review, sessions at work, a new version; otherwise that nothing waits. In the first minute
 * after the interface opens she greets first. Her pose follows what she says: holding a card when a
 * permission waits, and on duty when nothing does but scheduled tasks are on (blueprint, section 11).
 */
import type { Session } from "../../src/shared/types.ts";
import type { MascotPose } from "./poses.ts";

export type Greeting = "morning" | "afternoon" | "evening";

export type CompanionLine =
	| { kind: "waiting"; count: number }
	| { kind: "error" | "review" | "working"; count: number; name: string | null }
	/** A new version to install, or one installed that a restart takes up (blueprint, "版本与更新"). */
	| { kind: "update" | "restart"; version: string }
	| { kind: "clear"; night: boolean };

/** Where clicking the bubble goes; null when it names nothing to go to. */
export type CompanionTarget =
	| { kind: "center" }
	| { kind: "session"; id: string }
	| { kind: "about" }
	| null;

export interface CompanionMood {
	pose: MascotPose;
	greeting: Greeting | null;
	line: CompanionLine;
	target: CompanionTarget;
}

/** How long after Yew opens the mascot greets before what she says. */
export const GREETING_MS = 60_000;

/**
 * The poses each line may take; one is picked per ten minutes, so she changes now and then but never
 * flickers. New poses join these lists.
 */
export const POSES: Record<
	"waiting" | "error" | "review" | "working" | "clear" | "night",
	MascotPose[]
> = {
	waiting: ["greeting", "stamp", "pointing", "halt", "pout"],
	error: ["sorry", "bow", "teary"],
	review: ["gift", "giftbox", "proud"],
	working: ["thinking", "writing", "typing", "clipboard", "magnifier", "books", "fired-up"],
	clear: ["happy", "tea", "stretch", "peek", "branch"],
	night: ["sleepy", "nap", "pajamas", "dozing"],
};

const SLOT_MS = 10 * 60_000;

function pick(list: MascotPose[], now: number): MascotPose {
	return list[Math.floor(now / SLOT_MS) % list.length] as MascotPose;
}

export function greetingFor(hour: number): Greeting | null {
	if (hour >= 5 && hour < 12) return "morning";
	if (hour >= 12 && hour < 18) return "afternoon";
	if (hour >= 18 && hour < 23) return "evening";
	return null;
}

export function isNight(hour: number): boolean {
	return hour >= 23 || hour < 5;
}

export function companionMood(input: {
	sessions: Iterable<Session>;
	/** Approvals, questions, decision cards and held letters waiting for the person. */
	waiting: number;
	/** Whether a permission request is among what waits. */
	permission?: boolean;
	/** Whether a scheduled task is on, so something is still watched when nothing else goes on. */
	onDuty?: boolean;
	now: number;
	/** The local hour, 0 to 23. */
	hour: number;
	/** When Yew opened in this tab. */
	openedAt: number;
	/** A version installed but not running yet, or a newer one on npm (blueprint, "版本与更新"). */
	update?: { kind: "update" | "restart"; version: string } | null;
}): CompanionMood {
	const { now, hour } = input;
	const greeting = now - input.openedAt < GREETING_MS ? greetingFor(hour) : null;
	if (input.waiting > 0) {
		return {
			pose: greeting ? "greeting" : input.permission ? "permission" : pick(POSES.waiting, now),
			greeting,
			line: { kind: "waiting", count: input.waiting },
			target: { kind: "center" },
		};
	}
	const live = [...input.sessions]
		.filter((session) => session.archivedAt === null)
		.sort((a, b) => b.updatedAt - a.updatedAt);
	for (const kind of ["error", "review", "working"] as const) {
		const status = kind === "review" ? "needs_review" : kind;
		const matching = live.filter((session) => session.status === status);
		const only = matching.length === 1 ? (matching[0] as Session) : null;
		if (matching.length > 0) {
			return {
				pose: pick(POSES[kind], now),
				greeting,
				line: { kind, count: matching.length, name: only?.name ?? null },
				target: only ? { kind: "session", id: only.id } : null,
			};
		}
	}
	if (input.update) {
		return {
			pose: greeting ? "greeting" : input.update.kind === "update" ? "giftbox" : "waking",
			greeting,
			line: input.update,
			target: { kind: "about" },
		};
	}
	const night = isNight(hour);
	return {
		pose: greeting
			? "greeting"
			: input.onDuty
				? "on-duty"
				: night
					? pick(POSES.night, now)
					: pick(POSES.clear, now),
		greeting,
		line: { kind: "clear", night },
		target: null,
	};
}
