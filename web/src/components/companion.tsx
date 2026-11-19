import { openCenter, openSettings, selectSession } from "../actions.ts";
import {
	activeToolPose,
	type CompanionLine,
	type CompanionMood,
	companionMood,
} from "../companion.ts";
import { t, useLang } from "../i18n.ts";
import { centerCount, setState, triggerReaction, useAppState } from "../state.ts";
import { Mascot } from "./mascot.tsx";
import { useNow } from "./ui.tsx";

/** When Yew opened in this tab: the mascot greets during the first minute. */
const OPENED_AT = Date.now();

function lineText(line: CompanionLine): string {
	switch (line.kind) {
		case "waiting":
			return line.count === 1
				? t("companion_waiting_one")
				: t("companion_waiting", { n: line.count });
		case "clear":
			return t(line.night ? "companion_night" : "companion_clear");
		case "update":
			return t("companion_update", { v: line.version });
		case "restart":
			return t("companion_restart");
		default:
			return line.name
				? t(`companion_${line.kind}_named`, { name: line.name })
				: t(`companion_${line.kind}`, { n: line.count });
	}
}

export function moodText(mood: CompanionMood): string {
	const line = lineText(mood.line);
	return mood.greeting
		? t("companion_greet", { greeting: t(`companion_${mood.greeting}`), line })
		: line;
}

/**
 * The mascot at the foot of the sidebar (blueprint, section 12). Her bubble says the one thing that
 * matters most now; when it names a place, the bubble is a button that goes there. The picture is
 * decoration and screen readers skip it; a bubble that goes nowhere is skipped too, since the sidebar
 * already says the same.
 */
export function Companion() {
	useLang();
	const enabled = useAppState((state) => state.settings?.mascot !== false);
	const sessions = useAppState((state) => state.sessions);
	const center = useAppState((state) => state.center);
	const schedules = useAppState((state) => state.schedules);
	const page = useAppState((state) => state.page);
	const selectedId = useAppState((state) => state.selectedId);
	const updates = useAppState((state) => state.updates);
	const transcript = useAppState((state) => state.transcript);
	const reaction = useAppState((state) => state.reaction);
	// Often enough to end the greeting about on time; the pose itself changes every ten minutes.
	const now = useNow(15_000);
	if (!enabled) return null;
	const waiting = centerCount(center);
	const liveSessions = Object.values(sessions);
	const mood = companionMood({
		sessions: liveSessions,
		waiting,
		permission: Object.values(center.approvals).some((approval) => approval.kind === "permission"),
		onDuty: schedules?.some((schedule) => schedule.enabled) ?? false,
		now,
		hour: new Date(now).getHours(),
		openedAt: OPENED_AT,
		update:
			updates?.restart || updates?.job?.state === "installed"
				? { kind: "restart", version: updates.installed.version }
				: updates?.available && updates.latest
					? { kind: "update", version: updates.latest.version }
					: null,
	});
	const activeReaction =
		reaction && reaction.until > now && (waiting === 0 || reaction.priority) ? reaction : null;
	const text = activeReaction ? t(activeReaction.key, activeReaction.params) : moodText(mood);
	// Where you already are, the bubble only talks.
	const here =
		(mood.target?.kind === "center" && page === "center") ||
		(mood.target?.kind === "session" && page === null && mood.target.id === selectedId);
	const target = activeReaction || here ? null : mood.target;
	const openWorking =
		page === null && selectedId !== null && sessions[selectedId]?.status === "working";
	const liveTool = openWorking ? activeToolPose(transcript?.toolCalls) : null;
	// The home page already waves at you from the middle.
	const basePose =
		mood.line.kind === "working" && liveTool
			? liveTool
			: page === null && selectedId === null && mood.pose === "greeting"
				? "happy"
				: mood.pose;
	const pose = activeReaction ? activeReaction.pose : basePose;
	const go = () => {
		setState({ drawerOpen: false });
		if (target?.kind === "center") openCenter("pending");
		else if (target?.kind === "session") void selectSession(target.id);
		else if (target?.kind === "about") openSettings("about");
	};
	const poke = () => {
		const active = liveSessions.filter((session) => session.archivedAt === null);
		const busyCount = active.filter((session) => session.status === "working").length;
		const dutyCount = schedules?.filter((schedule) => schedule.enabled).length ?? 0;
		if (busyCount > 0) {
			triggerReaction("fired-up", "companion_poke_busy", { params: { n: busyCount }, ms: 2800 });
		} else if (dutyCount > 0) {
			triggerReaction("on-duty", "companion_poke_duty", { params: { n: dutyCount }, ms: 2800 });
		} else {
			triggerReaction("tea", "companion_poke_ready", { params: { n: active.length }, ms: 2800 });
		}
	};
	return (
		<div className="companion">
			<button
				type="button"
				className="companion-mascot-btn"
				onClick={poke}
				aria-hidden="true"
				tabIndex={-1}
			>
				<Mascot key={pose} pose={pose} height={76} className="companion-mascot" />
			</button>
			{target ? (
				<button type="button" className="companion-bubble companion-go" onClick={go}>
					{text}
				</button>
			) : (
				<p className="companion-bubble" aria-hidden="true">
					{text}
				</p>
			)}
		</div>
	);
}
