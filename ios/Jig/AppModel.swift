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

	/// Allow once or decline a permission request, from the approval center or a session.
	func answer(_ approvalId: String, allow: Bool) async {
		await attempt {
			try await $0.post("/api/approvals/\(approvalId)", ["decision": allow ? "allow_once" : "deny"])
		}
		await refreshCenter()
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
