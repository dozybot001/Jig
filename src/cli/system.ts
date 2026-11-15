import { conflict } from "../server/errors.ts";
import type { SystemControl } from "../server/http/system.ts";
import {
	type AppHost,
	appInstalled,
	appPath,
	installApp,
	realAppHost,
	uninstallApp,
} from "./app.ts";
import {
	installService,
	realServiceHost,
	type ServiceHost,
	serviceAtLogin,
	serviceFile,
	serviceSupported,
	uninstallService,
} from "./service.ts";

export interface SystemControlOptions {
	/** Jig's data folder. */
	home: string;
	env: Record<string, string | undefined>;
	service?: ServiceHost;
	app?: AppHost;
}

/**
 * The settings' two switches, on the functions behind `jig service` and `jig app`. Unlike the
 * commands, the start-at-login switch does not start or stop Jig now: the Jig that serves the
 * settings keeps running as it was started, and only the next login changes.
 */
export function systemControl(options: SystemControlOptions): SystemControl {
	const service = options.service ?? realServiceHost();
	const app = options.app ?? realAppHost();
	const canStart = serviceSupported(service);
	const canLaunch = app.platform === "darwin";
	return {
		status: () => ({
			startAtLogin: {
				supported: canStart,
				on: canStart && serviceAtLogin(service),
				file: canStart ? serviceFile(service) : null,
			},
			launcher: {
				supported: canLaunch,
				on: canLaunch && appInstalled(app),
				path: canLaunch ? appPath(app) : null,
			},
		}),
		setStartAtLogin(on) {
			if (!on) {
				uninstallService(service, { stop: false });
				return;
			}
			const { code, file } = installService(service, options.home, options.env, { start: false });
			if (code !== 0) {
				throw conflict(
					`The system did not accept the service (exit ${code ?? "none"}). The file is at ${file}.`,
					undefined,
					"service-failed",
				);
			}
		},
		setLauncher(on) {
			if (on) installApp(app, options.home, options.env);
			else uninstallApp(app);
		},
	};
}
