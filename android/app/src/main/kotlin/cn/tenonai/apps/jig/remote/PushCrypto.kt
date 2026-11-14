package cn.tenonai.apps.jig.remote

import org.bouncycastle.crypto.InvalidCipherTextException

/**
 * A notification sealed for this phone (src/remote/push.ts), the form the computer hands to a push
 * service. The Android app gets its notifications as plain JSON inside the encrypted channel
 * (`GET /api/notes`), so it does not open sealed ones today; this stays checked against the
 * computer's fixed vector for a delivery path that carries them.
 *
 * key    = HKDF-SHA256(X25519(phone static, computer static), salt = empty, info = "jig-push/1"), 32 bytes
 * sealed = nonce (12 bytes) | ChaCha20-Poly1305 ciphertext | tag (16 bytes)
 */
object PushCrypto {
    private const val NONCE = 12
    private const val TAG = 16

    fun key(own: ByteArray, computer: ByteArray): ByteArray {
        // HKDF (RFC 5869) with an empty salt and one block of output.
        val pseudorandom = hmacSha256(ByteArray(32), Curve.dh(own, computer))
        return hmacSha256(pseudorandom, "jig-push/1".toByteArray(Charsets.US_ASCII), byteArrayOf(1))
    }

    fun open(sealed: ByteArray, key: ByteArray): ByteArray {
        if (sealed.size < NONCE + TAG) throw NoiseException("The notification is too short.")
        return try {
            chachaPoly(
                false, key, sealed.copyOfRange(0, NONCE), ByteArray(0), sealed.copyOfRange(NONCE, sealed.size),
            )
        } catch (_: InvalidCipherTextException) {
            throw NoiseException("The notification failed to decrypt.")
        }
    }
}
