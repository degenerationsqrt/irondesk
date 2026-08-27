package app.irondesk.health

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * At-rest protection for the device token and the queued payloads.
 *
 * Deliberately a tiny primitive rather than `androidx.security:security-crypto`
 * (deprecated): a single AES-256/GCM key lives in the AndroidKeyStore and never
 * leaves it, and the ciphertext is stored in ordinary app-private storage.
 *
 * [Codec] is an interface so every consumer stays unit-testable on the JVM.
 */
interface Codec {
    /** Never throws: callers treat a failure as "no usable value". */
    fun encode(plain: String): String?

    /** Returns null for a corrupt blob or a key invalidated by the OS. */
    fun decode(blob: String): String?
}

/** Test/JVM double. Also used as the fallback when the Keystore is unusable. */
object PlainCodec : Codec {
    override fun encode(plain: String): String = plain
    override fun decode(blob: String): String = blob
}

/**
 * AES-256/GCM with a fresh 12-byte IV per encryption. Blob layout is
 * `v1:<base64(iv)>:<base64(ciphertext||tag)>` so a format change is detectable
 * instead of being misread as data.
 */
class KeystoreCodec(private val alias: String) : Codec {

    override fun encode(plain: String): String? = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        "$PREFIX:${b64(cipher.iv)}:${b64(body)}"
    } catch (e: GeneralSecurityException) {
        null
    } catch (e: IllegalStateException) {
        null
    }

    override fun decode(blob: String): String? {
        val parts = blob.split(':')
        if (parts.size != 3 || parts[0] != PREFIX) return null
        return try {
            val iv = unb64(parts[1]) ?: return null
            val body = unb64(parts[2]) ?: return null
            if (iv.size != IV_BYTES) return null
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(body), Charsets.UTF_8)
        } catch (e: GeneralSecurityException) {
            // Wrong tag, corrupt blob, or a key the OS invalidated. Not a crash,
            // and explicitly not "the value is fine".
            null
        } catch (e: IllegalStateException) {
            null
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun unb64(value: String): ByteArray? =
        try { Base64.decode(value, Base64.NO_WRAP) } catch (e: IllegalArgumentException) { null }

    private companion object {
        const val PREFIX = "v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
