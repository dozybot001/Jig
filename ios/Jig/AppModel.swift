import Foundation
import Observation

/// What the app knows about the Jig it is connected to, and the actions the screens take.
@MainActor
@Observable
final class AppModel {
	private(set) var client: JigClient?
	private(set) var sessions: [SessionSummary] = []
	private(set) var center: Center?
	private(set) var letters: [LetterItem] = []
	/// The Mac this phone is paired with, as the Mac names itself.
	private(set) var desktopName: String?
	var problem: String?

	private static let directKey = "directBase"

	init() {
		if let pairing = Vault.pairing {
			client = JigClient(transport: RelayTransport(channel: RelayChannel(pairing: pairing, key: Vault.phoneKey())))
			desktopName = pairing.desktopName
		}
		#if DEBUG
		// The cookie survives in the shared cookie store; the address is all the app has to remember.
		if let saved = UserDefaults.standard.string(forKey: Self.directKey), let base = URL(string: saved) {
			client = JigClient(transport: DirectTransport(base: base))
		}
		// `-JigDirectLink <link>` at launch connects at once (simulator runs and UI tests).
		if let link = UserDefaults.standard.string(forKey: "JigDirectLink") {
			Task { await connectDirect(link: link) }
		}
		// `-JigPairLink <jig://pair?…>` pairs through the relay at launch, as scanning would.
		if let link = UserDefaults.standard.string(forKey: "JigPairLink") {
			Task { await pair(with: link) }
		}
		#endif
	}

	var connected: Bool { client != nil }

	/// Sessions in the order the Mac's sidebar shows them: pinned first, then the rest.
	var orderedSessions: [SessionSummary] {
		sessions.filter(\.pinned) + sessions.filter { !$0.pinned }
	}

	func name(of sessionId: String) -> String {
		sessions.first { $0.id == sessionId }?.name ?? ""
	}

	#if DEBUG
	func connectDirect(link: String) async {
		do {
			let (client, base) = try await JigClient.direct(link: link)
			UserDefaults.standard.set(base.absoluteString, forKey: Self.directKey)
			self.client = client
			problem = nil
			await refreshAll()
		} catch {
			problem = error.localizedDescription
		}
	}
	#endif

	/// Pairs with the Mac whose QR code (or its link) this is: handshake with its secret, then keep it.
	func pair(with text: String) async {
		guard let link = PairingLink(text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
			problem = String(localized: "That is not a Jig pairing link.")
			return
		}
		var pairing = Pairing(relay: link.relay, desktop: link.desktop, desktopKey: link.key, desktopName: link.name)
		let channel = RelayChannel(pairing: pairing, key: Vault.phoneKey())
		do {
			let welcome = try await channel.connect(pairSecret: link.secret)
			pairing.desktopName = welcome.desktop
			Vault.pairing = pairing
			desktopName = welcome.desktop
			client = JigClient(transport: RelayTransport(channel: channel))
			problem = nil
			await refreshAll()
		} catch {
			problem = String(localized: "Pairing did not work. Show a new QR code on the Mac and scan it again.")
		}
	}

	func disconnect() {
		Vault.pairing = nil
		desktopName = nil
		UserDefaults.standard.removeObject(forKey: Self.directKey)
		client = nil
		sessions = []
		center = nil
		letters = []
	}

	func refreshAll() async {
		await refreshSessions()
		await refreshCenter()
		await refreshLetters()
	}

	func refreshSessions() async {
		await attempt { sessions = try await $0.get("/api/sessions?limit=200", as: Page<SessionSummary>.self).items }
	}

	func refreshCenter() async {
		await attempt { center = try await $0.get("/api/center", as: Center.self) }
	}

	func refreshLetters() async {
		await attempt { letters = try await $0.get("/api/letters?limit=100", as: Page<LetterItem>.self).items }
	}

	func transcript(of sessionId: String) async -> Transcript? {
		var result: Transcript?
		await attempt { result = try await $0.get("/api/sessions/\(sessionId)/transcript?limit=100", as: Transcript.self) }
		return result
	}

	func send(_ text: String, to sessionId: String) async -> Bool {
		var sent = false
		await attempt {
			try await $0.post("/api/sessions/\(sessionId)/messages", ["text": text])
			sent = true
		}
		return sent
	}

	enum Decision: String {
		case allowOnce = "allow_once"
		case allowAlways = "allow_always"
		case deny
	}

	/// Answers a permission request: allow once, always allow this kind, or decline.
	func answer(_ approvalId: String, _ decision: Decision) async {
		await attempt { try await $0.post("/api/approvals/\(approvalId)", ["decision": decision.rawValue]) }
		await refreshCenter()
	}

	struct Answer: Encodable, Sendable {
		let choices: [Int]
		let text: String?
	}

	private struct Answers: Encodable, Sendable {
		let answers: [Answer]
	}

	/// Answers a question card: the options picked and the person's own words, per question.
	func answer(_ approvalId: String, answers: [Answer]) async -> Bool {
		var done = false
		await attempt {
			try await $0.post("/api/approvals/\(approvalId)", Answers(answers: answers))
			done = true
		}
		await refreshCenter()
		return done
	}

	private struct Decide: Encodable, Sendable {
		let choice: Int?
		let note: String?
	}

	/// Sends the person's decision on a card; it goes back to the sessions that asked.
	func decide(_ cardId: String, choice: Int?, note: String?) async -> Bool {
		var done = false
		await attempt {
			try await $0.post("/api/cards/\(cardId)/decide", Decide(choice: choice, note: note))
			done = true
		}
		await refreshCenter()
		return done
	}

	/// Releases a held letter to its recipient, or refuses it.
	func settle(_ letterId: String, release: Bool) async {
		await attempt { try await $0.post("/api/letters/\(letterId)/\(release ? "release" : "refuse")", [String: String]()) }
		await refreshCenter()
		await refreshLetters()
	}

	/// Follows the Mac's event stream and refreshes what changed, so the lists stay current; reconnects
	/// after a drop. Runs while the app shows its main screens.
	func followEvents() async {
		while !Task.isCancelled {
			guard let client else { return }
			do {
				for try await event in client.events() where event.event == "global" {
					await changed(event.data)
				}
			} catch {}
			try? await Task.sleep(for: .seconds(3))
		}
	}

	private func changed(_ data: String) async {
		guard let type = (try? JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any])?["type"] as? String
		else { return }
		switch type {
		case "sessionSummary", "groups", "sessionsDeleted":
			await refreshSessions()
		case "approval", "card":
			await refreshCenter()
		case "letter":
			await refreshCenter()
			await refreshLetters()
		default:
			break
		}
	}

	private func attempt(_ work: (JigClient) async throws -> Void) async {
		guard let client else { return }
		do {
			try await work(client)
		} catch is CancellationError {
		} catch {
			problem = error.localizedDescription
		}
	}
}
