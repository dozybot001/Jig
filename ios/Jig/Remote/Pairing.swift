import Foundation

/// What the pairing QR code on the Mac carries: `yew://pair?r=…&d=…&k=…&s=…&n=…` (src/remote/protocol.ts).
struct PairingLink: Sendable {
	let relay: String
	let desktop: String
	/// The Mac's Noise static key.
	let key: Data
	/// The one-time pairing secret.
	let secret: String
	let name: String

	/// Whether the text starts the way a pairing link does: `yew://pair?`, or `jig://pair?` from a Mac that
	/// still runs a version from before the rename.
	static func looksLikeOne(_ text: String) -> Bool {
		text.hasPrefix("yew://pair?") || text.hasPrefix("jig://pair?")
	}

	init?(_ text: String) {
		guard Self.looksLikeOne(text), let parts = URLComponents(string: text)?.queryItems else { return nil }
		let value = { (name: String) in parts.first { $0.name == name }?.value }
		guard let relay = value("r"), let desktop = value("d"), let key = value("k").flatMap(Data.init(base64URL:)),
			key.count == 32, let secret = value("s")
		else { return nil }
		self.relay = relay
		self.desktop = desktop
		self.key = key
		self.secret = secret
		name = value("n") ?? ""
	}
}
