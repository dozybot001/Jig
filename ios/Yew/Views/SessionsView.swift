import SwiftUI

/// All sessions, pinned first, with what each is doing; tap one to read and write in it.
struct SessionsView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		@Bindable var model = model
		NavigationStack(path: $model.sessionPath) {
			List(model.orderedSessions) { session in
				NavigationLink(value: session) {
					SessionRow(session: session)
				}
			}
			.overlay {
				if model.loaded, model.sessions.isEmpty {
					ContentUnavailableView("No sessions yet", systemImage: "bubble.left.and.bubble.right")
				}
			}
			.navigationTitle("Sessions")
			.navigationDestination(for: SessionSummary.self) { session in
				SessionView(session: session)
			}
			.refreshable { await model.refreshAll() }
			.yewChrome()
		}
	}
}

struct SessionRow: View {
	let session: SessionSummary

	var body: some View {
		HStack(spacing: 10) {
			Image(systemName: session.cwd == nil ? "bubble.left" : "chevron.left.forwardslash.chevron.right")
				.foregroundStyle(.secondary)
				.frame(width: 22)
				.accessibilityHidden(true)
			Text(session.name)
				.lineLimit(1)
			if session.pinned {
				Image(systemName: "pin.fill")
					.font(.caption2)
					.foregroundStyle(.secondary)
					.accessibilityLabel("Pinned")
			}
			Spacer()
			StatusMark(session: session)
		}
		.padding(.vertical, 2)
	}
}

/// Waiting, working and errors show as a dot; an idle session shows its unread count.
struct StatusMark: View {
	let session: SessionSummary

	var body: some View {
		switch session.status {
		case "waiting":
			dot(.orange, label: "Waiting for you")
		case "working":
			dot(.secondary, label: "Working")
		case "error", "needs_review":
			dot(.red, label: "Needs a look")
		default:
			if session.unread > 0 {
				Text("\(session.unread)")
					.font(.caption.monospacedDigit())
					.foregroundStyle(.secondary)
					.accessibilityLabel("\(session.unread) unread")
			}
		}
	}

	private func dot(_ color: Color, label: LocalizedStringKey) -> some View {
		Circle()
			.fill(color)
			.frame(width: 8, height: 8)
			.accessibilityLabel(label)
	}
}
