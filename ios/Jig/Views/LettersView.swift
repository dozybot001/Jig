import SwiftUI

/// Every letter between sessions, newest first, one line each.
struct LettersView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		NavigationStack {
			List(model.letters) { letter in
				VStack(alignment: .leading, spacing: 2) {
					Text("\(letter.fromName) → \(model.name(of: letter.toSession))")
						.font(.caption)
						.foregroundStyle(.secondary)
					Text(letter.summary)
						.lineLimit(2)
				}
			}
			.overlay {
				if model.letters.isEmpty {
					ContentUnavailableView("No letters yet", systemImage: "envelope")
				}
			}
			.navigationTitle("Letters")
			.refreshable { await model.refreshLetters() }
		}
	}
}
