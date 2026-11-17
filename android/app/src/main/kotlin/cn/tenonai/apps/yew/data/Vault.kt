package cn.tenonai.apps.yew.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import cn.tenonai.apps.yew.api.obj
import cn.tenonai.apps.yew.api.str
import cn.tenonai.apps.yew.remote.Curve
import cn.tenonai.apps.yew.remote.Pairing
import java.io.File
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * The phone's Noise private key and its pairing, on this device only. They are one small file in the
 * app's no-backup folder, encrypted (AES-256-GCM) with a key that is made in the Android Keystore and
 * never leaves it; the manifest also turns backup and device transfer off for the whole app. The key
 * needs no unlock each time, so the connection service can read it while the screen is locked.
 */
class Vault(context: Context) {
    private val file = File(context.noBackupFilesDir, "vault.bin")
    private var cached: JsonObject? = null

    /** The phone's key, made on first use. */
    @Synchronized
    fun phoneKey(): ByteArray = existingPhoneKey() ?: Curve.newPrivateKey().also { key ->
        write(buildJsonObject {
            put("noise", Base64.getEncoder().encodeToString(key))
            read().obj("pairing")?.let { put("pairing", it) }
        })
    }

    @Synchronized
    fun existingPhoneKey(): ByteArray? =
        read().str("noise")?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }?.takeIf { it.size == 32 }

    var pairing: Pairing?
        @Synchronized get() {
            val saved = read().obj("pairing") ?: return null
            return Pairing(
                relay = saved.str("relay") ?: return null,
                desktop = saved.str("desktop") ?: return null,
                desktopKey = saved.str("desktopKey")?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }
                    ?: return null,
                desktopName = saved.str("desktopName").orEmpty(),
                deviceId = saved.str("deviceId"),
            )
        }
        @Synchronized set(value) {
            write(buildJsonObject {
                read().str("noise")?.let { put("noise", it) }
                if (value != null) {
                    putJsonObject("pairing") {
                        put("relay", value.relay)
                        put("desktop", value.desktop)
                        put("desktopKey", Base64.getEncoder().encodeToString(value.desktopKey))
                        put("desktopName", value.desktopName)
                        value.deviceId?.let { put("deviceId", it) }
                    }
                }
            })
        }

    /** Unpairing: the pairing and the phone's own key both go; a new pairing starts with a new key. */
    @Synchronized
    fun forget() {
        file.delete()
        cached = JsonObject(emptyMap())
        runCatching { keyStore().deleteEntry(ALIAS) }
    }

    private fun read(): JsonObject {
        cached?.let { return it }
        // A file that cannot be opened (the Keystore key is gone, as after a restore) counts as no pairing.
        val value = runCatching {
            val bytes = file.readBytes()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV))
            Json.parseToJsonElement(cipher.doFinal(bytes, IV, bytes.size - IV).toString(Charsets.UTF_8)).jsonObject
        }.getOrDefault(JsonObject(emptyMap()))
        cached = value
        return value
    }

    private fun write(value: JsonObject) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val temp = File(file.parentFile, "vault.tmp")
        temp.writeBytes(cipher.iv + cipher.doFinal(value.toString().toByteArray()))
        if (!temp.renameTo(file)) throw java.io.IOException("could not save the pairing")
        cached = value
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(): SecretKey {
        (keyStore().getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ALIAS = "yew.vault"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV = 12
    }
}
