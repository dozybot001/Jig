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
}

struct Page<Item: Decodable & Sendable>: Decodable, Sendable {
	let items: [Item]
	let nextCursor: String?
}

struct Transcript: Decodable, Sendable {
	let session: SessionSummary
	let entries: [Entry]
}

/// One entry of a session's record, reduced to what a phone shows: who spoke and the text.
struct Entry: Decodable, Identifiable, Sendable {
	enum Kind: Sendable { case user, assistant, notice, other }

	let id: String
	let kind: Kind
	let text: String

	private enum Keys: String, CodingKey { case id, role, message, notice }

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: Keys.self)
		id = try container.decode(String.self, forKey: .id)
		switch try container.decode(String.self, forKey: .role) {
		case "user":
			kind = .user
			text = try container.decode(Message.self, forKey: .message).text
		case "assistant":
			kind = .assistant
			text = try container.decode(Message.self, forKey: .message).text
		case "notice":
			kind = .notice
			text = (try? container.decode(Notice.self, forKey: .notice))?.text ?? ""
		default:
			kind = .other
			text = ""
		}
	}

	private struct Message: Decodable {
		let text: String
		private enum Keys: String, CodingKey { case content }
		private struct Block: Decodable {
			let type: String
			let text: String?
		}

		init(from decoder: Decoder) throws {
			let container = try decoder.container(keyedBy: Keys.self)
			if let plain = try? container.decode(String.self, forKey: .content) {
				text = plain
				return
			}
			let blocks = (try? container.decode([Block].self, forKey: .content)) ?? []
			text = blocks.compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n\n")
		}
	}

	private struct Notice: Decodable {
		let text: String?
	}
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
	let fromName: String
	let toSession: String
	let kind: String
	let summary: String
	let body: String
	let status: String
	let statusReason: String?
	let createdAt: Double
}

/// An RFC 9457 problem from Jig, shown to the person as it came.
struct JigProblem: Error, Decodable, LocalizedError {
	let title: String
	let detail: String?

	var errorDescription: String? { detail ?? title }
}
