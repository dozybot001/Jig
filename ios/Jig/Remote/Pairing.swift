import Foundation

/// What the pairing QR code on the Mac carries: `jig://pair?r=…&d=…&k=…&s=…&n=…` (src/remote/protocol.ts).
struct PairingLink: Sendable {
	let relay: String
	let desktop: String
	/// The Mac's Noise static key.
	let key: Data
	/// The one-time pairing secret.
	let secret: String
	let name: String

	init?(_ text: String) {
		guard text.hasPrefix("jig://pair?"), let parts = URLComponents(string: text)?.queryItems else { return nil }
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
