import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { boot } from "./actions.ts";
import { CenterPage } from "./components/center.tsx";
import { SchedulesPage } from "./components/schedules.tsx";
import { SessionView } from "./components/session.tsx";
import { SettingsDialogs } from "./components/settings.tsx";
import { Sidebar, SidebarRail, useNarrow } from "./components/sidebar.tsx";
import { Button } from "./components/ui.tsx";
import { t, useLang } from "./i18n.ts";
import { centerCount, setState, useAppState } from "./state.ts";
import "./styles/app.css";

function App() {
	useLang();
	const phase = useAppState((state) => state.phase);
	const failure = useAppState((state) => state.failure);
	const connection = useAppState((state) => state.connection);
	const collapsed = useAppState((state) => state.sidebarCollapsed);
	const drawerOpen = useAppState((state) => state.drawerOpen);
	const waiting = useAppState((state) => centerCount(state.center));
	const page = useAppState((state) => state.page);
	const narrow = useNarrow();
	// The tab's title carries the approval center's count, so it shows in the tab strip.
	useEffect(() => {
		document.title = waiting > 0 ? `(${waiting}) Jig` : "Jig";
	}, [waiting]);
	// The drawer closes with Escape, like a dialog.
	useEffect(() => {
		if (!drawerOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setState({ drawerOpen: false });
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [drawerOpen]);
	if (phase === "loading") {
		return (
			<div className="center-page" aria-busy="true">
				<p>{t("loading")}</p>
			</div>
		);
	}
	if (phase === "signin") {
		return (
			<div className="center-page">
				<div>
					<h1>{t("signInTitle")}</h1>
					<p>{t("signInBody")}</p>
				</div>
			</div>
		);
	}
	if (phase === "failed") {
		return (
			<div className="center-page">
				<div>
					<h1>{t("errorTitle")}</h1>
					<p>{failure === "network" ? t("connectionLost") : failure}</p>
					<Button variant="primary" onClick={() => window.location.reload()}>
						{t("retry")}
					</Button>
				</div>
			</div>
		);
	}
	return (
		<>
			{connection === "connecting" && (
				<div className="banner" role="status">
					{t("connectionLost")}
				</div>
			)}
			<div
				className={`app${!narrow && collapsed ? " app-collapsed" : ""}${narrow && drawerOpen ? " sidebar-open" : ""}`}
			>
				{!narrow && collapsed ? <SidebarRail /> : <Sidebar />}
				{narrow && drawerOpen && (
					<div
						className="drawer-backdrop"
						aria-hidden="true"
						onClick={() => setState({ drawerOpen: false })}
					/>
				)}
				{page === "center" ? (
					<CenterPage />
				) : page === "schedules" ? (
					<SchedulesPage />
				) : (
					<SessionView />
				)}
				<SettingsDialogs />
			</div>
		</>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
	void boot();
}
