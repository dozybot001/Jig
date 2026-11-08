import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { boot } from "./actions.ts";
import { SessionView } from "./components/session.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { Button } from "./components/ui.tsx";
import { t, useLang } from "./i18n.ts";
import { useAppState } from "./state.ts";
import "./styles/app.css";

function App() {
	useLang();
	const phase = useAppState((state) => state.phase);
	const failure = useAppState((state) => state.failure);
	const connection = useAppState((state) => state.connection);
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
			<div className="app">
				<Sidebar />
				<SessionView />
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
