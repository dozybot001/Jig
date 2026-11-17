package cn.tenonai.apps.yew.remote

import java.net.URLDecoder
import java.util.Base64

/**
 * What the pairing QR code on the computer carries: `yew://pair?r=…&d=…&k=…&s=…&n=…` (src/remote/protocol.ts).
 * A computer from before the rename to Yew writes `jig://pair?…` with the same fields; both are read.
 */
class PairingLink(
    val relay: String,
    val desktop: String,
    /** The computer's Noise static key. */
    val key: ByteArray,
    /** The one-time pairing secret. */
    val secret: String,
    val name: String,
) {
    companion object {
        private val PREFIXES = listOf("yew://pair?", "jig://pair?")

        /** Whether the text is meant as a pairing link, as the camera tells one QR code from another. */
        fun isLink(text: String): Boolean = PREFIXES.any(text::startsWith)

        fun parse(text: String): PairingLink? {
            val prefix = PREFIXES.firstOrNull(text::startsWith) ?: return null
            val values = text.removePrefix(prefix).split("&").mapNotNull { part ->
                val at = part.indexOf('=')
                if (at < 0) return@mapNotNull null
                runCatching { part.substring(0, at) to URLDecoder.decode(part.substring(at + 1), "UTF-8") }.getOrNull()
            }.toMap()
            val relay = values["r"]?.takeIf { it.isNotEmpty() } ?: return null
            val desktop = values["d"]?.takeIf { it.isNotEmpty() } ?: return null
            val key = values["k"]?.let(::base64Url)?.takeIf { it.size == 32 } ?: return null
            val secret = values["s"]?.takeIf { it.isNotEmpty() } ?: return null
            return PairingLink(relay, desktop, key, secret, values["n"].orEmpty())
        }
    }
}

fun base64Url(text: String): ByteArray? = runCatching { Base64.getUrlDecoder().decode(text.trimEnd('=')) }.getOrNull()

/** The computer this phone is paired with, kept with the phone's own key (data/Vault.kt). */
data class Pairing(
    val relay: String,
    val desktop: String,
    val desktopKey: ByteArray,
    val desktopName: String,
    /** This phone's id on the computer, from the handshake; with it the phone removes itself when it unpairs. */
    val deviceId: String?,
)
