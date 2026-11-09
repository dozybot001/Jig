import SwiftUI

@main
struct JigApp: App {
	@State private var model = AppModel()

	var body: some Scene {
		WindowGroup {
			RootView()
				.environment(model)
		}
	}
}

/// Not connected yet: how to connect. Connected: the three places of the app.
struct RootView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		if model.connected {
			TabView {
				SessionsView()
					.tabItem { Label("Sessions", systemImage: "bubble.left.and.bubble.right") }
				CenterView()
					.tabItem { Label("Approvals", systemImage: "checkmark.seal") }
					.badge(model.center?.count ?? 0)
				LettersView()
					.tabItem { Label("Letters", systemImage: "envelope") }
			}
			.task { await model.refreshAll() }
		} else {
			ConnectView()
		}
	}
}
