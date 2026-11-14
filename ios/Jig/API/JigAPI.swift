import Foundation

// Jig's local API as the iPhone app reads it: the same endpoints the web interface uses on the Mac.
// Only the fields the app shows are decoded; the rest is ignored.

struct SessionSummary: Decodable, Identifiable, Hashable, Sendable {
	let id: String
	let name: String
	let kind: String
	let cwd: String?
	let status: String
	let pinned: Bool
	let unread: Int
	let groupId: String?
	let parentId: String?
	/// The sequence number of the session's last event; the event stream resumes after it.
	let eventSeq: Int?
}

struct Page<Item: Decodable & Sendable>: Decodable, Sendable {
	let items: [Item]
	let nextCursor: String?
}

struct Transcript: Decodable, Sendable {
	let session: SessionSummary
	let entries: [Entry]
}

/// One entry of a session's record, reduced to what a phone shows: who spoke, the text, the tools an
/// answer used, and the letter a message came in.
struct Entry: Decodable, Identifiable, Sendable {
	enum Kind: Sendable { case user, assistant, notice, other }

	let id: String
	let seq: Int
	let kind: Kind
	let text: String
	/// The tools the assistant called in this message, by name, in order.
	let tools: [String]
	/// The letter this message delivered, when it came from another session.
	let letter: LetterRef?

	private enum Keys: String, CodingKey { case id, seq, role, message, notice, letter }

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: Keys.self)
		id = try container.decode(String.self, forKey: .id)
		seq = try container.decodeIfPresent(Int.self, forKey: .seq) ?? 0
		letter = try? container.decodeIfPresent(LetterRef.self, forKey: .letter)
		switch try container.decode(String.self, forKey: .role) {
		case "user":
			kind = .user
			text = try container.decode(MessageText.self, forKey: .message).text
			tools = []
		case "assistant":
			kind = .assistant
			let message = try container.decode(MessageText.self, forKey: .message)
			text = message.text
			tools = message.tools
		case "notice":
			kind = .notice
			text = (try? container.decode(Notice.self, forKey: .notice))?.text ?? ""
			tools = []
		default:
			kind = .other
			text = ""
			tools = []
		}
	}

	private struct Notice: Decodable {
		let text: String?
	}
}

/// A message's text blocks joined, and the tools it called; also the shape of an answer still being
/// written (the event stream's draft).
struct MessageText: Decodable, Sendable {
	let text: String
	let tools: [String]

	private enum Keys: String, CodingKey { case content }
	private struct Block: Decodable {
		let type: String
		let text: String?
		let name: String?
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: Keys.self)
		if let plain = try? container.decode(String.self, forKey: .content) {
			text = plain
			tools = []
			return
		}
		let blocks = (try? container.decode([Block].self, forKey: .content)) ?? []
		text = blocks.compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n\n")
		tools = blocks.compactMap { $0.type == "toolCall" ? $0.name : nil }
	}
}

/// Who sent a letter into a session, and what kind it is.
struct LetterRef: Decodable, Sendable {
	let kind: String
	let from: From
	let summary: String
	let body: String

	struct From: Decodable, Sendable {
		/// session, person, cli, or jig (a scheduled task).
		let kind: String?
		let name: String
	}

	var sender: String { Sender.name(kind: from.kind, name: from.name) }
}

/// What the approval center waits on: permission requests and questions, decision cards, held letters.
struct Center: Decodable, Sendable {
	let approvals: [ApprovalItem]
	let cards: [CardItem]
	let held: [LetterItem]

	var count: Int { approvals.count + cards.count + held.count }
}

struct Option: Decodable, Hashable, Sendable {
	let label: String
	let detail: String?

	private enum Keys: String, CodingKey { case label, detail }

	/// Options come as objects, or as plain strings in questions asked before options had details.
	init(from decoder: Decoder) throws {
		if let label = try? decoder.singleValueContainer().decode(String.self) {
			self.label = label
			detail = nil
			return
		}
		let container = try decoder.container(keyedBy: Keys.self)
		label = try container.decode(String.self, forKey: .label)
		detail = try container.decodeIfPresent(String.self, forKey: .detail)
	}
}

struct Question: Decodable, Sendable {
	let question: String
	let header: String?
	let options: [Option]?
	let recommended: Int?
	let multiple: Bool?
}

struct ApprovalItem: Decodable, Identifiable, Sendable {
	let id: String
	let sessionId: String
	let kind: String
	let createdAt: Double
	let request: Request

	struct Request: Decodable, Sendable {
		let tool: String?
		let summary: String?
		let description: String?
		let mustConfirm: Bool?
		let reasons: [String]?
		let rememberRules: [Rule]?
		let questions: [Question]?
		let question: String?
		let options: [Option]?
		let fromReply: Bool?
	}

	struct Rule: Decodable, Sendable {
		let tool: String
		let pattern: String?
	}

	/// The questions, whichever form they were saved in (src/shared/types.ts questionsOf).
	var questions: [Question] {
		if let questions = request.questions, !questions.isEmpty { return questions }
		return [Question(question: request.question ?? "", header: nil, options: request.options, recommended: nil, multiple: nil)]
	}

	/// The line the list shows: what the session wants to do, or its first question.
	var line: String {
		if kind == "question" { return questions.first?.question ?? "" }
		return request.description ?? request.summary ?? request.tool ?? ""
	}
}

struct CardItem: Decodable, Identifiable, Sendable {
	let id: String
	let number: Int
	let title: String
	let context: String
	let options: [Option]
	let recommended: Int?
	let deadline: String?
	let undoable: Bool?
	let requestedBy: String?
	let createdBy: String?
	let createdAt: Double
}

struct LetterItem: Decodable, Identifiable, Sendable {
	let id: String
	let fromKind: String?
	let fromName: String
	let toSession: String
	let kind: String
	let summary: String
	let body: String
	let status: String
	let statusReason: String?
	let createdAt: Double

	var sender: String { Sender.name(kind: fromKind, name: fromName) }
}

/// An RFC 9457 problem from Jig, shown to the person as it came.
/// Something a session saved for the person to look at (src/shared/types.ts).
struct ArtifactItem: Decodable, Identifiable, Hashable, Sendable {
	let id: String
	let sessionId: String
	let name: String
	let kind: String
	let version: Int
	let updatedAt: Double
}

struct JigProblem: Error, Decodable, LocalizedError {
	let title: String
	let detail: String?

	var errorDescription: String? { detail ?? title }
}
