import SwiftUI

/// One session: its record and a field to write to it. While it works, the record refreshes.
struct SessionView: View {
	@Environment(AppModel.self) private var model
	let session: SessionSummary
	@State private var entries: [Entry] = []
	@State private var status = ""
	@State private var draft = ""
	@State private var sending = false

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 14) {
					ForEach(entries.filter { $0.kind != .other && !$0.text.isEmpty }) { entry in
						EntryView(entry: entry).id(entry.id)
					}
				}
				.padding()
			}
			.defaultScrollAnchor(.bottom)
			.onChange(of: entries.count) {
				if let last = entries.last { proxy.scrollTo(last.id, anchor: .bottom) }
			}
		}
		.safeAreaInset(edge: .bottom) { composer }
		.navigationTitle(session.name)
		.navigationBarTitleDisplayMode(.inline)
		.refreshable { await load() }
		.task {
			// Without the event stream yet, follow a working session by reading it again.
			while !Task.isCancelled {
				await load()
				try? await Task.sleep(for: status == "working" ? .seconds(2) : .seconds(10))
			}
		}
	}

	private var composer: some View {
		HStack(alignment: .bottom, spacing: 8) {
			TextField("Message", text: $draft, axis: .vertical)
				.lineLimit(1...6)
				.padding(.horizontal, 12)
				.padding(.vertical, 8)
				.background(.background.secondary, in: RoundedRectangle(cornerRadius: 18))
			Button {
				let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
				guard !text.isEmpty else { return }
				sending = true
				Task {
					if await model.send(text, to: session.id) {
						draft = ""
						await load()
					}
					sending = false
				}
			} label: {
				Image(systemName: "arrow.up.circle.fill")
					.font(.system(size: 30))
			}
			.disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
			.accessibilityLabel("Send")
		}
		.padding(.horizontal)
		.padding(.vertical, 8)
		.background(.bar)
	}

	private func load() async {
		guard let transcript = await model.transcript(of: session.id) else { return }
		entries = transcript.entries
		status = transcript.session.status
	}
}

struct EntryView: View {
	let entry: Entry

	var body: some View {
		switch entry.kind {
		case .user:
			Text(entry.text)
				.padding(.horizontal, 12)
				.padding(.vertical, 8)
				.background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
				.frame(maxWidth: .infinity, alignment: .trailing)
		case .assistant:
			Text(LocalizedStringKey(entry.text))
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
		case .notice:
			Text(entry.text)
				.font(.footnote)
				.foregroundStyle(.secondary)
				.frame(maxWidth: .infinity)
		case .other:
			EmptyView()
		}
	}
}
