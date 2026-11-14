import SwiftUI

@main
struct JigApp: App {
	@UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
	@State private var model = AppModel()

	var body: some Scene {
		WindowGroup {
			RootView()
				.environment(model)
				.task { PushCenter.shared.model = model }
		}
	}
}

/// Not connected yet: how to connect. Connected: the three places of the app, settings over them.
struct RootView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.scenePhase) private var scenePhase

	var body: some View {
		@Bindable var model = model
		Group {
			if model.connected {
				TabView(selection: $model.tab) {
					SessionsView()
						.tabItem { Label("Sessions", systemImage: "bubble.left.and.bubble.right") }
						.tag(AppModel.Tab.sessions)
					CenterView()
						.tabItem { Label("Approvals", systemImage: "checkmark.seal") }
						.badge(model.center?.count ?? 0)
						.tag(AppModel.Tab.approvals)
					LettersView()
						.tabItem { Label("Letters", systemImage: "envelope") }
						.tag(AppModel.Tab.letters)
				}
				.task(id: model.isDemo) {
					await model.refreshAll()
					await model.followEvents()
				}
				.sheet(isPresented: $model.showingSettings) {
					SettingsView()
				}
				.alert(
					"That didn't go through",
					isPresented: Binding(get: { model.problem != nil }, set: { if !$0 { model.problem = nil } })
				) {
					Button("OK", role: .cancel) {}
				} message: {
					Text(model.problem ?? "")
				}
			} else {
				ConnectView()
			}
		}
		.onChange(of: scenePhase) { _, phase in
			// Back from the background, the lists may be stale and the connection gone.
			if phase == .active, model.connected {
				Task { await model.refreshAll() }
			}
		}
	}
}
