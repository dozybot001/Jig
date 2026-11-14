import CryptoKit
import Foundation

/// Notifications from the Mac arrive sealed for this phone (src/remote/push.ts): the relay and Apple's
/// push service carry ciphertext only.
///
/// key    = HKDF-SHA256(X25519(phone static, Mac static), salt = empty, info = "jig-push/1"), 32 bytes
/// sealed = nonce (12 bytes) | ChaCha20-Poly1305 ciphertext | tag (16 bytes)
enum PushCrypto {
	static func key(own: Curve25519.KeyAgreement.PrivateKey, mac: Data) throws -> SymmetricKey {
		let shared = try own.sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: mac))
		return shared.hkdfDerivedSymmetricKey(
			using: SHA256.self, salt: Data(), sharedInfo: Data("jig-push/1".utf8), outputByteCount: 32)
	}

	static func open(_ sealed: Data, key: SymmetricKey) throws -> Data {
		try ChaChaPoly.open(ChaChaPoly.SealedBox(combined: sealed), using: key)
	}
}

/// What a notification says once decrypted (src/server/push.ts): one to show, or a list to take away.
struct PushNote: Decodable, Sendable {
	var id: String?
	var kind: String?
	var title: String?
	var body: String?
	/// The session to open when it is tapped; without one, the approval center.
	var session: String?
	/// For `many`: how many items it sums up.
	var n: Int?
	var code: String?
	var badge: Int?
	/// Ids of notifications that were handled and come off the screen.
	var clear: [String]?

	/// Decrypts the `e` field of a notification with this phone's key and its Mac's.
	init?(userInfo: [AnyHashable: Any]) {
		guard let text = userInfo["e"] as? String, let sealed = Data(base64Encoded: text),
			let own = Vault.existingPhoneKey(), let mac = Vault.pairing?.desktopKey,
			let key = try? PushCrypto.key(own: own, mac: mac),
			let plain = try? PushCrypto.open(sealed, key: key),
			let note = try? JSONDecoder().decode(PushNote.self, from: plain)
		else { return nil }
		self = note
	}
}
