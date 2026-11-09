import SwiftUI

/// The approval center on the phone: what every session waits on, in the Mac's order.
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
							ForEach(permissions) { approval in
								PermissionRow(approval: approval)
							}
						}
					}
					if !questions.isEmpty {
						Section("Questions for you") {
							ForEach(questions) { approval in
								ItemRow(session: model.name(of: approval.sessionId), text: approval.line)
							}
						}
					}
					if !center.cards.isEmpty {
						Section("Decisions for you") {
							ForEach(center.cards) { card in
								ItemRow(session: card.requestedBy.map(model.name(of:)) ?? "", text: "#\(card.number) \(card.title)")
							}
						}
					}
					if !center.held.isEmpty {
						Section("Letters to release") {
							ForEach(center.held) { letter in
								ItemRow(session: letter.fromName, text: letter.summary)
							}
						}
					}
				}
			}
			.overlay {
				if model.center?.count == 0 {
					ContentUnavailableView("Nothing is waiting for you", systemImage: "checkmark.seal")
				}
			}
			.navigationTitle("Approvals")
			.refreshable { await model.refreshCenter() }
		}
	}
}

/// A permission request with its two answers; "always allow" stays on the Mac for now.
struct PermissionRow: View {
	@Environment(AppModel.self) private var model
	let approval: ApprovalItem

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			ItemRow(session: model.name(of: approval.sessionId), text: approval.line)
			if let summary = approval.request.summary, approval.request.description != nil {
				Text(summary)
					.font(.footnote.monospaced())
					.foregroundStyle(.secondary)
					.lineLimit(3)
			}
			HStack {
				Button("Allow", systemImage: "checkmark") {
					Task { await model.answer(approval.id, allow: true) }
				}
				.buttonStyle(.borderedProminent)
				Button("Decline", systemImage: "nosign", role: .destructive) {
					Task { await model.answer(approval.id, allow: false) }
				}
				.buttonStyle(.bordered)
			}
			.controlSize(.regular)
		}
		.padding(.vertical, 4)
	}
}

struct ItemRow: View {
	let session: String
	let text: String

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			if !session.isEmpty {
				Text(session)
					.font(.caption)
					.foregroundStyle(.secondary)
			}
			Text(text)
				.lineLimit(3)
		}
	}
}
