package cn.tenonai.apps.yew.remote

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.InvalidCipherTextException
import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.math.ec.rfc7748.X25519

// Noise_IK_25519_ChaChaPoly_SHA256, the phone's side, matching src/remote/noise.ts on the computer byte
// for byte (Noise Protocol Framework, revision 34). Bouncy Castle supplies X25519 and
// ChaCha20-Poly1305, the platform SHA-256 and HMAC; nothing here is home-made cryptography beyond the
// framework's own construction.

class NoiseException(message: String) : Exception(message)

private const val KEY_LENGTH = 32
private const val TAG_LENGTH = 16

/** A Noise message is at most 65535 bytes (section 3). */
const val MAX_NOISE_MESSAGE = 65535

/** Raw X25519 keys, 32 bytes each, as the computer exchanges them. */
object Curve {
    fun newPrivateKey(): ByteArray = ByteArray(KEY_LENGTH).also { X25519.generatePrivateKey(SecureRandom(), it) }

    fun publicKeyOf(privateKey: ByteArray): ByteArray =
        ByteArray(KEY_LENGTH).also { X25519.generatePublicKey(privateKey, 0, it, 0) }

    fun dh(privateKey: ByteArray, publicKey: ByteArray): ByteArray {
        if (publicKey.size != KEY_LENGTH) throw NoiseException("A public key has the wrong length.")
        val shared = ByteArray(KEY_LENGTH)
        // A low-order point gives all zeros; refuse it rather than key a channel with it.
        if (!X25519.calculateAgreement(privateKey, 0, publicKey, 0, shared, 0)) {
            throw NoiseException("A public key is not usable.")
        }
        return shared
    }
}

internal fun chachaPoly(encrypt: Boolean, key: ByteArray, nonce: ByteArray, ad: ByteArray, input: ByteArray): ByteArray {
    val cipher = ChaCha20Poly1305()
    cipher.init(encrypt, AEADParameters(KeyParameter(key), TAG_LENGTH * 8, nonce, ad))
    val output = ByteArray(cipher.getOutputSize(input.size))
    val written = cipher.processBytes(input, 0, input.size, output, 0)
    cipher.doFinal(output, written)
    return output
}

/** One direction of an encrypted channel (Noise CipherState). */
class NoiseCipher(private val key: ByteArray? = null) {
    private var counter = 0L

    /** The ChaChaPoly nonce: 32 bits of zeros, then the counter as a little-endian 64-bit number. */
    private fun nonce(): ByteArray {
        val bytes = ByteArray(12)
        for (i in 0 until 8) bytes[4 + i] = (counter ushr (8 * i)).toByte()
        return bytes
    }

    fun encrypt(ad: ByteArray, plaintext: ByteArray): ByteArray {
        val key = key ?: return plaintext
        if (counter == Long.MAX_VALUE) throw NoiseException("The channel ran out of nonces.")
        val sealed = chachaPoly(true, key, nonce(), ad, plaintext)
        counter += 1
        return sealed
    }

    fun decrypt(ad: ByteArray, ciphertext: ByteArray): ByteArray {
        val key = key ?: return ciphertext
        if (ciphertext.size < TAG_LENGTH) throw NoiseException("A message is too short.")
        val plaintext = try {
            chachaPoly(false, key, nonce(), ad, ciphertext)
        } catch (_: InvalidCipherTextException) {
            throw NoiseException("A message failed to decrypt.")
        }
        // The counter moves only after a message decrypts, so a forged one cannot desynchronize it.
        counter += 1
        return plaintext
    }
}

private fun sha256(vararg parts: ByteArray): ByteArray {
    val digest = MessageDigest.getInstance("SHA-256")
    for (part in parts) digest.update(part)
    return digest.digest()
}

internal fun hmacSha256(key: ByteArray, vararg parts: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    for (part in parts) mac.update(part)
    return mac.doFinal()
}

/** HKDF as Noise defines it (section 4.3), with two outputs. */
private fun hkdf(chainingKey: ByteArray, input: ByteArray): Pair<ByteArray, ByteArray> {
    val temp = hmacSha256(chainingKey, input)
    val first = hmacSha256(temp, byteArrayOf(1))
    val second = hmacSha256(temp, first, byteArrayOf(2))
    return first to second
}

/** Noise SymmetricState (section 5.2). */
private class SymmetricState {
    // The protocol name is exactly 32 bytes, so it is the initial hash as it is.
    var h: ByteArray = "Noise_IK_25519_ChaChaPoly_SHA256".toByteArray(Charsets.US_ASCII)
    private var chainingKey = h
    private var cipher = NoiseCipher()

    fun mixHash(data: ByteArray) {
        h = sha256(h, data)
    }

    fun mixKey(input: ByteArray) {
        val (chaining, key) = hkdf(chainingKey, input)
        chainingKey = chaining
        cipher = NoiseCipher(key)
    }

    fun encryptAndHash(plaintext: ByteArray): ByteArray = cipher.encrypt(h, plaintext).also(::mixHash)

    fun decryptAndHash(ciphertext: ByteArray): ByteArray = cipher.decrypt(h, ciphertext).also { mixHash(ciphertext) }

    fun split(): Pair<NoiseCipher, NoiseCipher> {
        val (first, second) = hkdf(chainingKey, ByteArray(0))
        return NoiseCipher(first) to NoiseCipher(second)
    }
}

/** A finished handshake: the computer's payload and the two directions. */
class NoiseSession(
    val payload: ByteArray,
    val send: NoiseCipher,
    val receive: NoiseCipher,
    /** The same on both ends, and unique to this handshake. */
    val handshakeHash: ByteArray,
)

/** The phone's side of Noise IK: it knows the computer's static key from the pairing QR code. */
class NoiseInitiator(
    private val staticKey: ByteArray,
    private val remoteStatic: ByteArray,
    prologue: ByteArray,
    private val ephemeral: ByteArray = Curve.newPrivateKey(),
) {
    private val state = SymmetricState()

    init {
        state.mixHash(prologue)
        state.mixHash(remoteStatic)
    }

    /** Message 1: `e, es, s, ss` and the payload. */
    fun writeFirst(payload: ByteArray): ByteArray {
        val e = Curve.publicKeyOf(ephemeral)
        state.mixHash(e)
        state.mixKey(Curve.dh(ephemeral, remoteStatic))
        val encryptedStatic = state.encryptAndHash(Curve.publicKeyOf(staticKey))
        state.mixKey(Curve.dh(staticKey, remoteStatic))
        val encryptedPayload = state.encryptAndHash(payload)
        val message = e + encryptedStatic + encryptedPayload
        if (message.size > MAX_NOISE_MESSAGE) throw NoiseException("A handshake message is too long.")
        return message
    }

    /** Message 2: `e, ee, se`. */
    fun readSecond(message: ByteArray): NoiseSession {
        if (message.size < KEY_LENGTH + TAG_LENGTH) throw NoiseException("A message is too short.")
        val remoteEphemeral = message.copyOfRange(0, KEY_LENGTH)
        state.mixHash(remoteEphemeral)
        state.mixKey(Curve.dh(ephemeral, remoteEphemeral))
        state.mixKey(Curve.dh(staticKey, remoteEphemeral))
        val payload = state.decryptAndHash(message.copyOfRange(KEY_LENGTH, message.size))
        val (first, second) = state.split()
        return NoiseSession(payload, first, second, state.h)
    }
}

/** The most a transport message carries: one Noise message less the tag and the chunk flag. */
private const val CHUNK = MAX_NOISE_MESSAGE - TAG_LENGTH - 1

/** Encrypts an application message of any length as one or more Noise messages. */
fun noiseSeal(cipher: NoiseCipher, message: ByteArray): List<ByteArray> {
    val parts = mutableListOf<ByteArray>()
    var offset = 0
    do {
        val end = minOf(offset + CHUNK, message.size)
        val plain = ByteArray(1 + end - offset)
        plain[0] = if (end >= message.size) 1 else 0
        message.copyInto(plain, 1, offset, end)
        parts.add(cipher.encrypt(ByteArray(0), plain))
        offset = end
    } while (offset < message.size)
    return parts
}

/** Joins decrypted chunks back into application messages. */
class NoiseOpener(private val cipher: NoiseCipher, private val limit: Int = 16 * 1024 * 1024) {
    private val pending = mutableListOf<ByteArray>()
    private var size = 0

    /** A whole message when the last chunk of one arrives, otherwise null. */
    fun open(ciphertext: ByteArray): ByteArray? {
        if (ciphertext.size > MAX_NOISE_MESSAGE) throw NoiseException("A message is too long.")
        val plain = cipher.decrypt(ByteArray(0), ciphertext)
        if (plain.isEmpty()) throw NoiseException("A chunk is empty.")
        size += plain.size - 1
        if (size > limit) throw NoiseException("A message is too large.")
        pending.add(plain.copyOfRange(1, plain.size))
        if (plain[0].toInt() != 1) return null
        val message = ByteArray(size)
        var offset = 0
        for (part in pending) {
            part.copyInto(message, offset)
            offset += part.size
        }
        pending.clear()
        size = 0
        return message
    }
}
