import CryptoKit
import Foundation
import Security

/// The Mac this phone is paired with: kept in the keychain with the phone's own key.
struct Pairing: Codable, Sendable {
	let relay: String
	let desktop: String
	let desktopKey: Data
	var desktopName: String
	/// This phone's id on the Mac, from the handshake; with it the phone removes itself when it unpairs.
	var deviceId: String?
}

/// The phone's keychain items: its Noise private key and the pairing, this device only, never synced.
/// The app and its notification extension share them through one keychain access group, so the
/// extension can decrypt a notification while the app is not running.
enum Vault {
	private static let service = "cn.tenonai.apps.yew.remote"

	static func phoneKey() -> Curve25519.KeyAgreement.PrivateKey {
		if let key = existingPhoneKey() { return key }
		let key = Curve25519.KeyAgreement.PrivateKey()
		write("noise", key.rawRepresentation)
		return key
	}

	/// The key if there is one; the notification extension never makes a new one.
	static func existingPhoneKey() -> Curve25519.KeyAgreement.PrivateKey? {
		read("noise").flatMap { try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: $0) }
	}

	/// Unpairing: the pairing and the phone's own key both go; a new pairing starts with a new key.
	static func forget() {
		delete("pairing")
		delete("noise")
	}

	static var pairing: Pairing? {
		get { read("pairing").flatMap { try? JSONDecoder().decode(Pairing.self, from: $0) } }
		set {
			if let newValue, let data = try? JSONEncoder().encode(newValue) {
				write("pairing", data)
			} else {
				delete("pairing")
			}
		}
	}

	private static func query(_ account: String) -> [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: account,
		]
	}

	private static func read(_ account: String) -> Data? {
		var item: CFTypeRef?
		var request = query(account)
		request[kSecReturnData as String] = true
		guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess else { return nil }
		return item as? Data
	}

	private static func write(_ account: String, _ data: Data) {
		delete(account)
		var request = query(account)
		request[kSecValueData as String] = data
		// Readable after the first unlock, so a notification that arrives on a locked phone can be decrypted.
		request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
		SecItemAdd(request as CFDictionary, nil)
	}

	private static func delete(_ account: String) {
		SecItemDelete(query(account) as CFDictionary)
	}
}

extension Data {
	init?(base64URL text: String) {
		var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
		base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
		self.init(base64Encoded: base64)
	}
}
