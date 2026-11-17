import SwiftUI

/// The approval center on the phone: what every session waits on, in the Mac's order. Permission
/// requests and held letters are answered in the list; questions and decision cards open to answer.
struct CenterView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		NavigationStack {
			List {
				if let center = model.center {
					let permissions = center.approvals.filter { $0.kind == "permission" }
					let questions = center.approvals.filter { $0.kind == "question" }
					if !permissions.isEmpty {
						Section("Waiting for your permission") {
							ForEach(permissions) { PermissionRow(approval: $0) }
						}
					}
					if !questions.isEmpty {
						Section("Questions for you") {
							ForEach(questions) { approval in
								NavigationLink {
									QuestionView(approval: approval)
								} label: {
									CardHead(
										session: model.name(of: approval.sessionId),
										date: approval.createdAt,
										text: approval.line
									)
								}
							}
						}
					}
					if !center.cards.isEmpty {
						Section("Decisions for you") {
							ForEach(center.cards) { card in
								NavigationLink {
									DecisionView(card: card)
								} label: {
									CardHead(
										session: card.requestedBy.map(model.name(of:)) ?? "",
										date: card.createdAt,
										text: "#\(card.number) \(card.title)"
									)
								}
							}
						}
					}
					if !center.held.isEmpty {
						Section("Letters to release") {
							ForEach(center.held) { HeldLetterRow(letter: $0) }
						}
					}
				}
			}
			.overlay {
				if model.loaded, model.center?.count == 0 {
					ContentUnavailableView {
						Label {
							Text("Nothing is waiting for you")
						} icon: {
							Mascot(pose: .happy)
						}
					}
				}
			}
			.navigationTitle("Approvals")
			.refreshable { await model.refreshCenter() }
			.jigChrome()
		}
	}
}

/// A card's top line and its one sentence: who waits, since when, and on what.
struct CardHead: View {
	let session: String
	let date: Double
	let text: String

	var body: some View {
		VStack(alignment: .leading, spacing: 3) {
			HStack(spacing: 4) {
				if !session.isEmpty { Text(session) }
				Text("·")
				Text(Date(timeIntervalSince1970: date / 1000), format: .relative(presentation: .numeric, unitsStyle: .abbreviated))
			}
			.font(.caption)
			.foregroundStyle(.secondary)
			Text(text)
				.lineLimit(4)
		}
	}
}

/// A permission request with its answers: allow, always allow this kind when offered, decline.
struct PermissionRow: View {
	@Environment(AppModel.self) private var model
	let approval: ApprovalItem
	@State private var busy = false

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			CardHead(session: model.name(of: approval.sessionId), date: approval.createdAt, text: approval.line)
			if approval.request.description != nil, let summary = approval.request.summary {
				Text(summary)
					.font(.footnote.monospaced())
					.foregroundStyle(.secondary)
					.lineLimit(4)
			}
			if approval.request.mustConfirm == true {
				Tag(text: String(localized: "Asks every time"))
			}
			HStack(spacing: 8) {
				Button("Allow", systemImage: "checkmark") { act(.allowOnce) }
					.buttonStyle(CapsuleButton(kind: .primary))
				if approval.request.mustConfirm != true, approval.request.rememberRules?.isEmpty == false {
					Button("Always", systemImage: "checkmark.circle") { act(.allowAlways) }
						.buttonStyle(CapsuleButton(kind: .secondary))
				}
				Button("Decline", systemImage: "nosign") { act(.deny) }
					.buttonStyle(CapsuleButton(kind: .destructive))
			}
			.disabled(busy)
		}
		.padding(.vertical, 4)
	}

	private func act(_ decision: AppModel.Decision) {
		busy = true
		Task {
			await model.answer(approval.id, decision)
			busy = false
		}
	}
}

/// A letter held for the person: who wrote to whom, why it waits, and release or refuse.
struct HeldLetterRow: View {
	@Environment(AppModel.self) private var model
	let letter: LetterItem
	@State private var busy = false

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			CardHead(
				session: "\(letter.sender) → \(model.name(of: letter.toSession))",
				date: letter.createdAt,
				text: letter.summary
			)
			if !letter.body.isEmpty {
				Text(letter.body)
					.font(.footnote)
					.foregroundStyle(.secondary)
					.lineLimit(4)
			}
			HStack(spacing: 8) {
				Button("Release", systemImage: "checkmark") { settle(true) }
					.buttonStyle(CapsuleButton(kind: .primary))
				Button("Refuse", systemImage: "nosign") { settle(false) }
					.buttonStyle(CapsuleButton(kind: .destructive))
			}
			.disabled(busy)
		}
		.padding(.vertical, 4)
	}

	private func settle(_ release: Bool) {
		busy = true
		Task {
			await model.settle(letter.id, release: release)
			busy = false
		}
	}
}

/// Questions from a session: options to pick (the recommended one chosen to start with) and a line for
/// the person's own words; one button answers them all.
struct QuestionView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	let approval: ApprovalItem
	@State private var choices: [Set<Int>] = []
	@State private var texts: [String] = []
	@State private var busy = false

	var body: some View {
		let questions = approval.questions
		Form {
			ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
				Section {
					ForEach(Array((question.options ?? []).enumerated()), id: \.offset) { choice, option in
						OptionRow(
							option: option,
							recommended: choice == question.recommended,
							selected: chosen(index).contains(choice),
							multiple: question.multiple == true
						) {
							pick(index, choice, multiple: question.multiple == true)
						}
					}
					TextField(
						(question.options ?? []).isEmpty ? String(localized: "Your answer") : String(localized: "Something else…"),
						text: textBinding(index),
						axis: .vertical
					)
				} header: {
					Text(question.header.map { "\($0) · \(question.question)" } ?? question.question)
						.textCase(nil)
				} footer: {
					if question.multiple == true { Text("Pick any") }
				}
			}
		}
		.navigationTitle(model.name(of: approval.sessionId))
		.navigationBarTitleDisplayMode(.inline)
		.onAppear {
			guard choices.isEmpty else { return }
			choices = questions.map { question in
				question.recommended.flatMap { (question.options ?? []).indices.contains($0) ? [$0] : nil } ?? []
			}
			texts = questions.map { _ in "" }
		}
		.safeAreaInset(edge: .bottom) {
			Button {
				busy = true
				Task {
					let answers = questions.indices.map { index in
						let words = texts[index].trimmingCharacters(in: .whitespacesAndNewlines)
						return AppModel.Answer(choices: chosen(index).sorted(), text: words.isEmpty ? nil : words)
					}
					if await model.answer(approval.id, answers: answers) { dismiss() }
					busy = false
				}
			} label: {
				Text("Answer").frame(maxWidth: .infinity)
			}
			.buttonStyle(CapsuleButton(kind: .primary))
			.disabled(!ready || busy)
			.padding()
			.background(.bar)
		}
	}

	private func chosen(_ index: Int) -> Set<Int> {
		choices.indices.contains(index) ? choices[index] : []
	}

	private var ready: Bool {
		approval.questions.indices.allSatisfy { index in
			!chosen(index).isEmpty
				|| !(texts.indices.contains(index) ? texts[index] : "").trimmingCharacters(in: .whitespaces).isEmpty
		}
	}

	private func pick(_ index: Int, _ choice: Int, multiple: Bool) {
		guard choices.indices.contains(index) else { return }
		if multiple {
			if choices[index].contains(choice) { choices[index].remove(choice) } else { choices[index].insert(choice) }
		} else {
			choices[index] = [choice]
		}
	}

	private func textBinding(_ index: Int) -> Binding<String> {
		Binding(
			get: { texts.indices.contains(index) ? texts[index] : "" },
			set: { value in
				guard texts.indices.contains(index) else { return }
				texts[index] = value
				// Own words replace the picked option of a one-choice question.
				if !value.isEmpty, approval.questions[index].multiple != true { choices[index] = [] }
			}
		)
	}
}

/// A decision card: the question, its context, the options with the recommended one chosen, a note.
struct DecisionView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	let card: CardItem
	@State private var choice: Int?
	@State private var note = ""
	@State private var busy = false

	var body: some View {
		Form {
			Section {
				Text(card.title)
					.font(.headline)
				HStack(spacing: 6) {
					if let deadline = card.deadline { Tag(text: String(localized: "Due \(deadline)")) }
					if let undoable = card.undoable {
						Tag(text: undoable ? String(localized: "Can be undone") : String(localized: "Can't be undone"), warning: !undoable)
					}
				}
				if !card.context.isEmpty {
					Text(LocalizedStringKey(card.context))
						.foregroundStyle(.secondary)
				}
			} header: {
				Text("#\(card.number) · \(card.requestedBy.map(model.name(of:)) ?? "")")
			}
			if !card.options.isEmpty {
				Section("Options") {
					ForEach(Array(card.options.enumerated()), id: \.offset) { index, option in
						OptionRow(option: option, recommended: index == card.recommended, selected: choice == index, multiple: false) {
							choice = index
						}
					}
				}
			}
			Section {
				TextField(card.options.isEmpty ? String(localized: "Your answer") : String(localized: "Add a note (optional)"), text: $note, axis: .vertical)
			}
		}
		.navigationTitle("Decision")
		.navigationBarTitleDisplayMode(.inline)
		.onAppear { choice = choice ?? card.recommended }
		.safeAreaInset(edge: .bottom) {
			Button {
				busy = true
				Task {
					let words = note.trimmingCharacters(in: .whitespacesAndNewlines)
					if await model.decide(card.id, choice: choice, note: words.isEmpty ? nil : words) { dismiss() }
					busy = false
				}
			} label: {
				Text("Send").frame(maxWidth: .infinity)
			}
			.buttonStyle(CapsuleButton(kind: .primary))
			.disabled((choice == nil && note.trimmingCharacters(in: .whitespaces).isEmpty) || busy)
			.padding()
			.background(.bar)
		}
	}
}

/// One option to pick: a round mark (or a square one when several may be picked), the label, what it
/// leads to, and the recommended tag.
struct OptionRow: View {
	let option: Option
	let recommended: Bool
	let selected: Bool
	let multiple: Bool
	let pick: () -> Void

	var body: some View {
		Button(action: pick) {
			HStack(alignment: .firstTextBaseline, spacing: 10) {
				Image(systemName: multiple
					? (selected ? "checkmark.square.fill" : "square")
					: (selected ? "largecircle.fill.circle" : "circle"))
					.foregroundStyle(selected ? Color.yewGreen : Color.secondary)
				VStack(alignment: .leading, spacing: 2) {
					HStack(spacing: 6) {
						Text(option.label).foregroundStyle(.primary)
						if recommended { Tag(text: String(localized: "Recommended")) }
					}
					if let detail = option.detail {
						Text(detail).font(.footnote).foregroundStyle(.secondary)
					}
				}
			}
			.contentShape(Rectangle())
		}
		.accessibilityAddTraits(selected ? .isSelected : [])
	}
}

/// A small label with a border, such as "Recommended" or "Can't be undone".
struct Tag: View {
	let text: String
	var warning = false

	var body: some View {
		Text(text)
			.font(.caption2.weight(.medium))
			.padding(.horizontal, 6)
			.padding(.vertical, 2)
			.foregroundStyle(warning ? Color.red : Color.secondary)
			.overlay(RoundedRectangle(cornerRadius: 5).stroke(warning ? Color.red : Color.secondary.opacity(0.4)))
	}
}

/// Yew's buttons, as on the Mac (web/src/styles/app.css): the main one on a soft grey fill, the others
/// outlined. Never a white fill in dark mode.
struct CapsuleButton: ButtonStyle {
	enum Kind { case primary, secondary, destructive }
	let kind: Kind

	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.body.weight(.medium))
			.labelStyle(.titleAndIcon)
			.foregroundStyle(foreground)
			.padding(.horizontal, 16)
			.frame(minHeight: 44)
			.background(kind == .primary ? Color.jigPrimary : Color.clear, in: Capsule())
			.overlay {
				if kind != .primary { Capsule().stroke(Color.jigControl) }
			}
			.opacity(configuration.isPressed ? 0.7 : 1)
	}

	private var foreground: Color {
		switch kind {
		case .primary: .jigOnPrimary
		case .secondary: .primary
		case .destructive: .red
		}
	}
}

extension Color {
	/// The Mac's `--primary`, `--on-primary` and `--control`, light and dark.
	static let jigPrimary = adaptive(light: 0xE6, dark: 0x38)
	static let jigOnPrimary = adaptive(light: 0x0D, dark: 0xF2)
	static let jigControl = adaptive(light: 0xDC, dark: 0x36)
	/// Yew's ink, for the leaf of the mark and the wordmark: dark green, and pale in dark mode.
	static let yewInk = adaptive(rgb: 0x1F3A2E, dark: 0xE3E8E4)
	/// Yew's green, for the option picked: the one colour besides black, white and grey.
	static let yewGreen = adaptive(rgb: 0x2F7D4F, dark: 0x3F9C66)

	private static func adaptive(light: Int, dark: Int) -> Color {
		Color(uiColor: UIColor { traits in
			UIColor(white: CGFloat(traits.userInterfaceStyle == .dark ? dark : light) / 255, alpha: 1)
		})
	}

	private static func adaptive(rgb light: Int, dark: Int) -> Color {
		Color(uiColor: UIColor { traits in
			let value = traits.userInterfaceStyle == .dark ? dark : light
			return UIColor(
				red: CGFloat(value >> 16 & 0xFF) / 255,
				green: CGFloat(value >> 8 & 0xFF) / 255,
				blue: CGFloat(value & 0xFF) / 255,
				alpha: 1
			)
		})
	}
}
