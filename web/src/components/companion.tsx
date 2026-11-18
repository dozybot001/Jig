import { openCenter, selectSession } from "../actions.ts";
import { type CompanionLine, type CompanionMood, companionMood } from "../companion.ts";
import { t, useLang } from "../i18n.ts";
import { centerCount, setState, useAppState } from "../state.ts";
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
	// Often enough to end the greeting about on time; the pose itself changes every ten minutes.
	const now = useNow(15_000);
	if (!enabled) return null;
	const mood = companionMood({
		sessions: Object.values(sessions),
		waiting: centerCount(center),
		permission: Object.values(center.approvals).some((approval) => approval.kind === "permission"),
		onDuty: schedules?.some((schedule) => schedule.enabled) ?? false,
		now,
		hour: new Date(now).getHours(),
		openedAt: OPENED_AT,
	});
	const text = moodText(mood);
	// Where you already are, the bubble only talks.
	const here =
		(mood.target?.kind === "center" && page === "center") ||
		(mood.target?.kind === "session" && page === null && mood.target.id === selectedId);
	const target = here ? null : mood.target;
	// The home page already waves at you from the middle.
	const pose =
		page === null && selectedId === null && mood.pose === "greeting" ? "happy" : mood.pose;
	const go = () => {
		setState({ drawerOpen: false });
		if (target?.kind === "center") openCenter("pending");
		else if (target?.kind === "session") void selectSession(target.id);
	};
	return (
		<div className="companion">
			<Mascot key={pose} pose={pose} height={76} className="companion-mascot" />
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
