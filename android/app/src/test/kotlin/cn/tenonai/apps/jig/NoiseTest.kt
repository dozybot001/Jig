package cn.tenonai.apps.jig

import cn.tenonai.apps.jig.remote.Curve
import cn.tenonai.apps.jig.remote.NoiseCipher
import cn.tenonai.apps.jig.remote.NoiseException
import cn.tenonai.apps.jig.remote.NoiseInitiator
import cn.tenonai.apps.jig.remote.NoiseOpener
import cn.tenonai.apps.jig.remote.PairingLink
import cn.tenonai.apps.jig.remote.PushCrypto
import cn.tenonai.apps.jig.remote.noiseSeal
import java.security.MessageDigest
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

private fun hex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

/**
 * The phone's Noise IK against bytes written by the computer's own code
 * (android/scripts/noise-vectors.ts runs src/remote/noise.ts with fixed keys).
 */
class NoiseTest {
    private val v: JsonObject = Json.parseToJsonElement(
        checkNotNull(javaClass.getResourceAsStream("/noise-vectors.json")).reader().readText(),
    ).jsonObject

    private fun text(name: String) = v.getValue(name).jsonPrimitive.content
    private fun list(name: String) = v.getValue(name).jsonArray.map { it.jsonPrimitive.content }

    private fun handshake(): Pair<NoiseInitiator, ByteArray> {
        val initiator = NoiseInitiator(
            staticKey = hex(text("phonePrivate")),
            remoteStatic = hex(text("computerPublic")),
            prologue = "jig-remote/1:${text("desktop")}".toByteArray(),
            ephemeral = hex(text("phoneEphemeral")),
        )
        return initiator to initiator.writeFirst(text("hello").toByteArray())
    }

    @Test
    fun publicKeysMatchTheComputers() {
        assertEquals(text("computerPublic"), Curve.publicKeyOf(hex(text("computerPrivate"))).hex())
        assertEquals(text("phonePublic"), Curve.publicKeyOf(hex(text("phonePrivate"))).hex())
    }

    @Test
    fun handshakeMatchesTheComputerByteForByte() {
        val (initiator, first) = handshake()
        assertEquals(text("message1"), first.hex())
        val session = initiator.readSecond(hex(text("message2")))
        assertEquals(text("welcome"), session.payload.toString(Charsets.UTF_8))
        assertEquals(text("handshakeHash"), session.handshakeHash.hex())
    }

    @Test
    fun framesMatchTheComputerInBothDirections() {
        val (initiator, _) = handshake()
        val session = initiator.readSecond(hex(text("message2")))

        // Phone to computer: one request, then a message that takes three chunks.
        assertEquals(list("requestSealed"), noiseSeal(session.send, text("request").toByteArray()).map { it.hex() })
        val long = ByteArray(v.getValue("longLength").jsonPrimitive.int) { (it % 251).toByte() }
        val parts = noiseSeal(session.send, long)
        assertEquals(3, parts.size)
        assertEquals(
            list("longSealedSha256"),
            parts.map { MessageDigest.getInstance("SHA-256").digest(it).hex() },
        )

        // Computer to phone.
        val opener = NoiseOpener(session.receive)
        val opened = list("responseSealed").map { opener.open(hex(it)) }
        assertEquals(text("response"), opened.last()?.toString(Charsets.UTF_8))
    }

    @Test
    fun chunksJoinBackIntoOneMessage() {
        val key = ByteArray(32) { 7 }
        val long = ByteArray(200_000) { (it % 253).toByte() }
        val parts = noiseSeal(NoiseCipher(key), long)
        assertEquals(4, parts.size)
        val opener = NoiseOpener(NoiseCipher(key))
        for (part in parts.dropLast(1)) assertNull(opener.open(part))
        assertArrayEquals(long, opener.open(parts.last()))
        // An empty message is still one chunk.
        assertEquals(1, noiseSeal(NoiseCipher(key), ByteArray(0)).size)
    }

    @Test
    fun aChangedByteIsRefusedAndDoesNotMoveTheCounter() {
        val (initiator, _) = handshake()
        val session = initiator.readSecond(hex(text("message2")))
        val opener = NoiseOpener(session.receive)
        val good = hex(list("responseSealed").first())
        val forged = good.clone().also { it[3] = (it[3].toInt() xor 1).toByte() }
        assertThrows(NoiseException::class.java) { opener.open(forged) }
        assertNotNull(opener.open(good))
    }

    @Test
    fun aChangedHandshakeAnswerIsRefused() {
        val (initiator, _) = handshake()
        val forged = hex(text("message2")).also { it[40] = (it[40].toInt() xor 1).toByte() }
        assertThrows(NoiseException::class.java) { initiator.readSecond(forged) }
    }

    @Test
    fun aLowOrderKeyIsRefused() {
        assertThrows(NoiseException::class.java) { Curve.dh(hex(text("phonePrivate")), ByteArray(32)) }
        assertThrows(NoiseException::class.java) { Curve.dh(hex(text("phonePrivate")), ByteArray(31)) }
    }

    @Test
    fun pairingLinkIsReadAsTheComputerWritesIt() {
        val link = checkNotNull(PairingLink.parse(text("link")))
        assertEquals("wss://relay.tenonai.cn", link.relay)
        assertEquals(text("desktop"), link.desktop)
        assertEquals(text("computerPublic"), link.key.hex())
        assertEquals("c2VjcmV0", link.secret)
        assertEquals("书房的电脑 & Mac", link.name)
        assertNull(PairingLink.parse("https://example.com/?r=a&d=b&k=c&s=d"))
        assertNull(PairingLink.parse("jig://pair?r=wss://x&d=b&k=AAAA&s=d"))
        assertNull(PairingLink.parse("jig://pair?d=b&k=${text("computerPublic")}&s=d"))
    }

    // The vector of test/push.test.ts on the computer, also checked by the iPhone app.
    @Test
    fun sealedNotificationOpensWithTheFixedVector() {
        val computer = ByteArray(32) { 1 }
        val phone = ByteArray(32) { 2 }
        val key = PushCrypto.key(phone, Curve.publicKeyOf(computer))
        assertEquals("6b8f194238cae3afb991545fc73bc9ef0f4ac1fb92e6bd67ad924d580e318f4d", key.hex()) // gitleaks:allow
        assertArrayEquals(key, PushCrypto.key(computer, Curve.publicKeyOf(phone)))
        val sealed = Base64.getDecoder().decode(
            "AwMDAwMDAwMDAwMDB+tpFSbM9MdgSEpAPCVHoBuxkomSUYkChVi7sCkBKDLTEV3tKqnLNqbBb+DxF7V53Z3Jw99sz29PXii88JgcsCZI4s3k5pJzmPg6raQATNjwu19EyTotKOZeuygs5lVF1Kc=",
        )
        assertEquals(
            """{"v":1,"id":"n1","kind":"permission","title":"官网","body":"git push","badge":2}""",
            PushCrypto.open(sealed, key).toString(Charsets.UTF_8),
        )
        val changed = sealed.clone().also { it[14] = (it[14].toInt() xor 1).toByte() }
        assertThrows(NoiseException::class.java) { PushCrypto.open(changed, key) }
        val other = PushCrypto.key(ByteArray(32) { 9 }, Curve.publicKeyOf(computer))
        assertThrows(NoiseException::class.java) { PushCrypto.open(sealed, other) }
        assertThrows(NoiseException::class.java) { PushCrypto.open(ByteArray(8), key) }
    }
}
