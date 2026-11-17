import SwiftUI

/// Every letter between sessions, newest first, one line each; tap one to read it whole.
struct LettersView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		NavigationStack {
			List(model.letters) { letter in
				NavigationLink {
					LetterView(letter: letter)
				} label: {
					VStack(alignment: .leading, spacing: 3) {
						Text("\(letter.sender) → \(model.name(of: letter.toSession))")
							.font(.footnote)
							.foregroundStyle(.secondary)
						Text(letter.summary)
							.lineLimit(2)
						if let status = LetterStatus.text(letter.status) {
							Text(status)
								.font(.footnote)
								.foregroundStyle(.secondary)
						}
					}
				}
			}
			.overlay {
				if model.loaded, model.letters.isEmpty {
					ContentUnavailableView("No letters yet", systemImage: "envelope")
				}
			}
			.navigationTitle("Letters")
			.refreshable { await model.refreshLetters() }
			.yewChrome()
		}
	}
}

/// One letter in full: who wrote to whom, what kind, when, and its text.
struct LetterView: View {
	@Environment(AppModel.self) private var model
	let letter: LetterItem

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 12) {
				Text(LetterKind.line(from: letter.sender, kind: letter.kind))
					.font(.footnote)
					.foregroundStyle(.secondary)
				Text("To \(model.name(of: letter.toSession)) · \(Date(timeIntervalSince1970: letter.createdAt / 1000).formatted(date: .abbreviated, time: .shortened))")
					.font(.footnote)
					.foregroundStyle(.secondary)
				if let status = LetterStatus.text(letter.status) {
					Text(status)
						.font(.footnote)
						.foregroundStyle(.secondary)
				}
				Text(letter.body)
					.textSelection(.enabled)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding()
		}
		.navigationTitle(letter.summary)
		.navigationBarTitleDisplayMode(.inline)
	}
}

/// What became of a letter, when it did not simply arrive.
enum LetterStatus {
	static func text(_ status: String) -> String? {
		switch status {
		case "held": String(localized: "Held for you")
		case "refused": String(localized: "Refused")
		case "dropped": String(localized: "Dropped")
		default: nil
		}
	}
}
