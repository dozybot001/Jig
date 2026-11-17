import CryptoKit
import Foundation

// Noise_IK_25519_ChaChaPoly_SHA256, the phone's side, matching src/remote/noise.ts on the Mac byte for
// byte (Noise Protocol Framework, revision 34). CryptoKit supplies X25519, ChaCha20-Poly1305 and
// SHA-256; nothing here is home-made cryptography beyond the framework's own construction.

enum NoiseError: Error {
	case shortMessage, unusableKey, decryptFailed, outOfNonces
}

/// One direction of an encrypted channel (Noise CipherState).
struct NoiseCipher: Sendable {
	private let key: SymmetricKey?
	private var counter: UInt64 = 0

	init(key: SymmetricKey? = nil) {
		self.key = key
	}

	private static func nonce(_ counter: UInt64) throws -> ChaChaPoly.Nonce {
		var bytes = Data(count: 4)
		withUnsafeBytes(of: counter.littleEndian) { bytes.append(contentsOf: $0) }
		return try ChaChaPoly.Nonce(data: bytes)
	}

	mutating func encrypt(ad: Data, _ plaintext: Data) throws -> Data {
		guard let key else { return plaintext }
		guard counter < UInt64.max else { throw NoiseError.outOfNonces }
		let box = try ChaChaPoly.seal(plaintext, using: key, nonce: Self.nonce(counter), authenticating: ad)
		counter += 1
		return box.ciphertext + box.tag
	}

	mutating func decrypt(ad: Data, _ ciphertext: Data) throws -> Data {
		guard let key else { return ciphertext }
		guard ciphertext.count >= 16 else { throw NoiseError.shortMessage }
		let bytes = Data(ciphertext)
		let box = try ChaChaPoly.SealedBox(
			nonce: Self.nonce(counter),
			ciphertext: bytes.prefix(bytes.count - 16),
			tag: bytes.suffix(16)
		)
		guard let plaintext = try? ChaChaPoly.open(box, using: key, authenticating: ad) else {
			throw NoiseError.decryptFailed
		}
		// The counter moves only after a message decrypts, so a forged one cannot desynchronize it.
		counter += 1
		return plaintext
	}
}

private func hmac(_ key: Data, _ parts: Data...) -> Data {
	var code = HMAC<SHA256>(key: SymmetricKey(data: key))
	for part in parts { code.update(data: part) }
	return Data(code.finalize())
}

/// HKDF as Noise defines it (section 4.3), with two outputs.
private func hkdf(_ chainingKey: Data, _ input: Data) -> (Data, Data) {
	let temp = hmac(chainingKey, input)
	let first = hmac(temp, Data([1]))
	let second = hmac(temp, first, Data([2]))
	return (first, second)
}

private func dh(_ key: Curve25519.KeyAgreement.PrivateKey, _ publicKey: Data) throws -> Data {
	guard publicKey.count == 32 else { throw NoiseError.unusableKey }
	let shared = try key.sharedSecretFromKeyAgreement(with: .init(rawRepresentation: publicKey))
	let raw = shared.withUnsafeBytes { Data($0) }
	// A low-order point gives all zeros; refuse it rather than key a channel with it.
	guard raw.contains(where: { $0 != 0 }) else { throw NoiseError.unusableKey }
	return raw
}

/// Noise SymmetricState (section 5.2).
private struct SymmetricState {
	var h = Data("Noise_IK_25519_ChaChaPoly_SHA256".utf8)
	var chainingKey: Data
	var cipher = NoiseCipher()

	init() {
		// The protocol name is exactly 32 bytes, so it is the initial hash as it is.
		chainingKey = h
	}

	mutating func mixHash(_ data: Data) {
		var hasher = SHA256()
		hasher.update(data: h)
		hasher.update(data: data)
		h = Data(hasher.finalize())
	}

	mutating func mixKey(_ input: Data) {
		let (chaining, key) = hkdf(chainingKey, input)
		chainingKey = chaining
		cipher = NoiseCipher(key: SymmetricKey(data: key))
	}

	mutating func encryptAndHash(_ plaintext: Data) throws -> Data {
		let ciphertext = try cipher.encrypt(ad: h, plaintext)
		mixHash(ciphertext)
		return ciphertext
	}

	mutating func decryptAndHash(_ ciphertext: Data) throws -> Data {
		let plaintext = try cipher.decrypt(ad: h, ciphertext)
		mixHash(ciphertext)
		return plaintext
	}

	func split() -> (NoiseCipher, NoiseCipher) {
		let (first, second) = hkdf(chainingKey, Data())
		return (NoiseCipher(key: SymmetricKey(data: first)), NoiseCipher(key: SymmetricKey(data: second)))
	}
}

/// The phone's side of Noise IK: it knows the Mac's static key from the pairing QR code.
struct NoiseInitiator {
	private var state = SymmetricState()
	private let staticKey: Curve25519.KeyAgreement.PrivateKey // gitleaks:allow (a type, not a key)
	private let ephemeral: Curve25519.KeyAgreement.PrivateKey
	private let remoteStatic: Data

	init(
		staticKey: Curve25519.KeyAgreement.PrivateKey,
		remoteStatic: Data,
		prologue: Data,
		ephemeral: Curve25519.KeyAgreement.PrivateKey = .init()
	) {
		self.staticKey = staticKey
		self.remoteStatic = Data(remoteStatic)
		self.ephemeral = ephemeral
		state.mixHash(prologue)
		state.mixHash(self.remoteStatic)
	}

	/// Message 1: `e, es, s, ss` and the payload.
	mutating func writeFirst(_ payload: Data) throws -> Data {
		let e = ephemeral.publicKey.rawRepresentation
		state.mixHash(e)
		state.mixKey(try dh(ephemeral, remoteStatic))
		let encryptedStatic = try state.encryptAndHash(staticKey.publicKey.rawRepresentation)
		state.mixKey(try dh(staticKey, remoteStatic))
		let encryptedPayload = try state.encryptAndHash(payload)
		return e + encryptedStatic + encryptedPayload
	}

	/// Message 2: `e, ee, se`; returns the Mac's payload and the two directions.
	mutating func readSecond(_ message: Data) throws -> (payload: Data, send: NoiseCipher, receive: NoiseCipher) {
		let bytes = Data(message)
		guard bytes.count >= 32 + 16 else { throw NoiseError.shortMessage }
		let remoteEphemeral = Data(bytes.prefix(32))
		state.mixHash(remoteEphemeral)
		state.mixKey(try dh(ephemeral, remoteEphemeral))
		state.mixKey(try dh(staticKey, remoteEphemeral))
		let payload = try state.decryptAndHash(Data(bytes.dropFirst(32)))
		let (first, second) = state.split()
		return (payload, first, second)
	}
}

/// The most a transport message carries: one Noise message less the tag and the chunk flag.
private let chunkSize = 65535 - 16 - 1

/// Encrypts an application message of any length as one or more Noise messages.
func noiseSeal(_ cipher: inout NoiseCipher, _ message: Data) throws -> [Data] {
	let bytes = Data(message)
	var parts: [Data] = []
	var offset = 0
	repeat {
		let end = min(offset + chunkSize, bytes.count)
		var plain = Data([end >= bytes.count ? 1 : 0])
		plain.append(bytes[offset..<end])
		parts.append(try cipher.encrypt(ad: Data(), plain))
		offset = end
	} while offset < bytes.count
	return parts
}

/// Joins decrypted chunks back into application messages.
struct NoiseOpener {
	var cipher: NoiseCipher
	private var pending = Data()

	init(cipher: NoiseCipher) {
		self.cipher = cipher
	}

	/// A whole message when the last chunk of one arrives, otherwise nil.
	mutating func open(_ ciphertext: Data) throws -> Data? {
		let plain = try cipher.decrypt(ad: Data(), ciphertext)
		guard let flag = plain.first else { throw NoiseError.shortMessage }
		pending.append(plain.dropFirst())
		guard flag == 1 else { return nil }
		defer { pending = Data() }
		return pending
	}
}
