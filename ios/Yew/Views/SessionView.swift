import SwiftUI

/// One session: its record, kept current from the Mac's event stream, and a field to write to it.
/// While the session works, the answer appears as it is written, and the send button stops it.
struct SessionView: View {
	@Environment(AppModel.self) private var model
	let session: SessionSummary
	@State private var entries: [Entry] = []
	@State private var status: String
	@State private var draft: MessageText?
	@State private var message = ""
	@State private var sending = false
	@State private var loaded = false

	init(session: SessionSummary) {
		self.session = session
		_status = State(initialValue: session.status)
	}

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 14) {
					ForEach(Step.steps(of: entries)) { step in
						StepView(step: step).id(step.id)
					}
					if let draft, !draft.text.isEmpty {
						AnswerText(text: draft.text)
					}
					if status == "working" {
						Label("Working…", systemImage: "ellipsis")
							.font(.footnote)
							.foregroundStyle(.secondary)
							.symbolEffect(.variableColor.iterative)
					}
					Color.clear.frame(height: 1).id("end")
				}
				.padding()
			}
			.defaultScrollAnchor(.bottom)
			.onChange(of: entries.count) { proxy.scrollTo("end", anchor: .bottom) }
			.onChange(of: draft?.text.count) { proxy.scrollTo("end", anchor: .bottom) }
			.overlay {
				if loaded && entries.isEmpty {
					ContentUnavailableView("No messages yet", systemImage: "bubble.left")
				}
			}
		}
		.safeAreaInset(edge: .bottom) { composer }
		.toolbar(.hidden, for: .tabBar)
		.navigationTitle(session.name)
		.navigationBarTitleDisplayMode(.inline)
		.task { await follow() }
	}

	private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

	private var composer: some View {
		HStack(alignment: .bottom, spacing: 8) {
			TextField("Message", text: $message, axis: .vertical)
				.lineLimit(1...6)
				.padding(.horizontal, 14)
				.padding(.vertical, 10)
				.background(.background.secondary, in: RoundedRectangle(cornerRadius: 20))
			if status == "working" && trimmed.isEmpty {
				Button {
					Task { await model.stop(session.id) }
				} label: {
					Image(systemName: "stop.circle.fill")
						.font(.system(size: 32))
						.frame(width: 44, height: 44)
				}
				.accessibilityLabel("Stop")
			} else {
				Button(action: send) {
					Image(systemName: "arrow.up.circle.fill")
						.font(.system(size: 32))
						.frame(width: 44, height: 44)
				}
				.disabled(trimmed.isEmpty || sending)
				.accessibilityLabel("Send")
			}
		}
		.tint(.primary)
		.padding(.horizontal)
		.padding(.vertical, 6)
		.background(.bar)
	}

	private func send() {
		let text = trimmed
		guard !text.isEmpty else { return }
		sending = true
		Task {
			if await model.send(text, to: session.id) {
				message = ""
				await load()
			}
			sending = false
		}
	}

	@discardableResult
	private func load() async -> Int? {
		guard let transcript = await model.transcript(of: session.id) else { return nil }
		entries = transcript.entries
		status = transcript.session.status
		loaded = true
		return transcript.session.eventSeq
	}

	/// Reads the record, then follows the session's events from where it ends; after a drop, reads it
	/// again and picks up from there.
	private func follow() async {
		while !Task.isCancelled {
			let after = await load()
			guard let client = model.client else { return }
			do {
				for try await event in client.events(session: session.id, after: after) {
					switch event.event {
					case "session": apply(event.data)
					case "live": applyLive(event.data)
					case "reset": await load()
					default: break
					}
				}
			} catch is CancellationError {
				return
			} catch {}
			try? await Task.sleep(for: .seconds(3))
		}
	}

	private struct Kind: Decodable { let type: String }
	private struct EntryEvent: Decodable { let entry: Entry }
	private struct SessionEvent: Decodable { let session: SessionSummary }
	private struct DraftEvent: Decodable { let draft: MessageText }

	private func apply(_ data: String) {
		let json = Data(data.utf8)
		let decoder = JSONDecoder()
		guard let kind = try? decoder.decode(Kind.self, from: json) else { return }
		switch kind.type {
		case "entry":
			guard let entry = try? decoder.decode(EntryEvent.self, from: json).entry else { return }
			if let index = entries.firstIndex(where: { $0.id == entry.id }) {
				entries[index] = entry
			} else {
				entries.append(entry)
			}
			if entry.kind == .assistant { draft = nil }
		case "session":
			if let summary = try? decoder.decode(SessionEvent.self, from: json).session { status = summary.status }
		default:
			break
		}
	}

	private func applyLive(_ data: String) {
		let json = Data(data.utf8)
		guard let kind = try? JSONDecoder().decode(Kind.self, from: json) else { return }
		if kind.type == "draft" {
			draft = try? JSONDecoder().decode(DraftEvent.self, from: json).draft
		} else if kind.type == "draftCleared" {
			draft = nil
		}
	}
}

/// What the phone shows of a record: messages, letters and notices, and the tools a stretch of work
/// used, counted in one line (as the Mac's run summary does).
enum Step: Identifiable {
	case user(Entry)
	case letter(Entry, LetterRef)
	case answer(Entry)
	case tools(id: String, names: [String])
	case notice(Entry)

	var id: String {
		switch self {
		case .user(let entry), .letter(let entry, _), .answer(let entry), .notice(let entry): entry.id
		case .tools(let id, _): "tools-\(id)"
		}
	}

	static func steps(of entries: [Entry]) -> [Step] {
		var steps: [Step] = []
		var tools: [String] = []
		var toolsId = ""
		func flush() {
			if !tools.isEmpty { steps.append(.tools(id: toolsId, names: tools)) }
			tools = []
		}
		for entry in entries {
			switch entry.kind {
			case .assistant:
				if tools.isEmpty { toolsId = entry.id }
				tools += entry.tools
				if !entry.text.isEmpty {
					flush()
					steps.append(.answer(entry))
				}
			case .user:
				flush()
				if let letter = entry.letter {
					steps.append(.letter(entry, letter))
				} else if !entry.text.isEmpty {
					steps.append(.user(entry))
				}
			case .notice:
				flush()
				if !entry.text.isEmpty { steps.append(.notice(entry)) }
			case .other:
				break
			}
		}
		flush()
		return steps
	}
}

struct StepView: View {
	let step: Step

	var body: some View {
		switch step {
		case .user(let entry):
			Text(entry.text)
				.textSelection(.enabled)
				.padding(.horizontal, 14)
				.padding(.vertical, 10)
				.background(.background.secondary, in: RoundedRectangle(cornerRadius: 18))
				.frame(maxWidth: .infinity, alignment: .trailing)
				.padding(.leading, 40)
		case .letter(_, let letter):
			VStack(alignment: .leading, spacing: 6) {
				Label(LetterKind.line(from: letter.sender, kind: letter.kind), systemImage: "envelope")
					.font(.footnote)
					.foregroundStyle(.secondary)
				Text(letter.body)
					.textSelection(.enabled)
			}
			.padding(12)
			.frame(maxWidth: .infinity, alignment: .leading)
			.overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.yewControl))
		case .answer(let entry):
			AnswerText(text: entry.text)
		case .tools(_, let names):
			Label(ToolSummary.line(names), systemImage: "wrench.and.screwdriver")
				.font(.footnote)
				.foregroundStyle(.secondary)
		case .notice(let entry):
			Text(entry.text)
				.font(.footnote)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
				.frame(maxWidth: .infinity)
		}
	}
}

/// An answer's text, with its inline Markdown (bold, code, links) shown as such.
struct AnswerText: View {
	let text: String

	var body: some View {
		Group {
			if let styled = try? AttributedString(
				markdown: text,
				options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
			) {
				Text(styled)
			} else {
				Text(text)
			}
		}
		.textSelection(.enabled)
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

/// "Ran 2 commands, made 1 edit": the tools a stretch of work used, by kind, in the Mac's wording.
enum ToolSummary {
	static func line(_ names: [String]) -> String {
		var counts: [String: Int] = [:]
		for name in names { counts[kind(of: name), default: 0] += 1 }
		let order = ["read", "edit", "write", "search", "shell", "web", "letter", "session", "card", "other"]
		// "Read 1 file, ran 2 commands": only the first part keeps its capital (Chinese has none).
		return order.compactMap { kind in counts[kind].map { text(kind, $0) } }
			.enumerated()
			.map { index, part in index == 0 ? part : part.prefix(1).lowercased() + part.dropFirst() }
			.joined(separator: String(localized: ", "))
	}

	private static func kind(of tool: String) -> String {
		switch tool {
		case "read", "edit", "write": tool
		case "grep", "glob": "search"
		case "shell", "shell_job": "shell"
		case "web_fetch": "web"
		case "send_letter": "letter"
		case "open_session": "session"
		case "post_card", "update_card", "withdraw_card": "card"
		default: "other"
		}
	}

	private static func text(_ kind: String, _ n: Int) -> String {
		switch kind {
		case "read": String(localized: "Read \(n) files")
		case "edit": String(localized: "Made \(n) edits")
		case "write": String(localized: "Wrote \(n) files")
		case "search": String(localized: "Searched \(n) times")
		case "shell": String(localized: "Ran \(n) commands")
		case "web": String(localized: "Fetched \(n) pages")
		case "letter": String(localized: "Wrote \(n) letters")
		case "session": String(localized: "Opened \(n) sessions")
		case "card": String(localized: "Changed the approval center \(n) times")
		default: String(localized: "\(n) other steps")
		}
	}
}

/// Who wrote a letter, as the Mac names them: a session by its name, you, the command line, or a
/// scheduled task.
enum Sender {
	static func name(kind: String?, name: String) -> String {
		switch kind {
		case "person": String(localized: "You")
		case "cli": String(localized: "Command line")
		case "yew": String(localized: "Scheduled task “\(name)”")
		default: name
		}
	}
}

/// "Main · Request": who a letter is from and what kind it is, as the Mac's letter cards show it.
enum LetterKind {
	static func line(from name: String, kind: String) -> String {
		"\(name) · \(label(kind))"
	}

	static func label(_ kind: String) -> String {
		switch kind {
		case "request": String(localized: "Request")
		case "report": String(localized: "Report")
		case "decision": String(localized: "Decision")
		default: String(localized: "Notice")
		}
	}
}
