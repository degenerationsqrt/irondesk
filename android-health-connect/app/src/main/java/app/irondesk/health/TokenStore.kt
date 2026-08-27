package app.irondesk.health

import android.content.Context

/**
 * Minimal key/value contract so the vault logic (including migration) is
 * testable on the JVM without the Keystore.
 */
interface SecureStore {
    fun get(key: String): String?
    fun put(key: String, value: String?)
    fun keys(): Set<String>
    fun clear()
}

/**
 * App-private SharedPreferences holding values encrypted by [Codec].
 *
 * A value that fails to decrypt (corrupt blob, or a Keystore key the OS
 * invalidated) is removed and reported as absent — it is never returned as if
 * it were plaintext, so an unreadable token can't look valid.
 */
class CodecStore(
    context: Context,
    name: String = "irondesk-device-v2",
    private val codec: Codec,
) : SecureStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun get(key: String): String? {
        val blob = prefs.getString(key, null) ?: return null
        val plain = codec.decode(blob)
        if (plain == null) {
            prefs.edit().remove(key).apply()
            return null
        }
        return plain
    }

    override fun put(key: String, value: String?) {
        val editor = prefs.edit()
        if (value == null) {
            editor.remove(key)
        } else {
            val blob = codec.encode(value)
            if (blob == null) editor.remove(key) else editor.putString(key, blob)
        }
        editor.apply()
    }

    override fun keys(): Set<String> = prefs.all.keys
    override fun clear() { prefs.edit().clear().apply() }
}

/** The pre-encryption plaintext prefs file written by the first build. */
class PlainStore(context: Context, name: String) : SecureStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
    override fun keys(): Set<String> = prefs.all.keys
    override fun clear() { prefs.edit().clear().apply() }
}

/**
 * Holds the pairing result. Only a device token lives here — never IronDesk
 * account credentials. The token authorises adding health records to one
 * account and nothing else, and it is revocable from either side.
 */
class TokenVault(private val store: SecureStore) {

    val token: String? get() = store.get(KEY_TOKEN)?.takeIf { it.isNotBlank() }
    val label: String? get() = store.get(KEY_LABEL)
    val deviceId: String? get() = store.get(KEY_DEVICE_ID)
    val pairedAt: Long get() = store.get(KEY_PAIRED_AT)?.toLongOrNull() ?: 0L
    val lastSyncAt: Long get() = store.get(KEY_LAST_SYNC)?.toLongOrNull() ?: 0L
    val paired: Boolean get() = !token.isNullOrEmpty()

    fun save(token: String, label: String?, deviceId: String?, at: Long = System.currentTimeMillis()) {
        store.put(KEY_TOKEN, token)
        store.put(KEY_LABEL, label ?: "Android phone")
        store.put(KEY_DEVICE_ID, deviceId)
        store.put(KEY_PAIRED_AT, at.toString())
    }

    fun markSynced(at: Long = System.currentTimeMillis()) = store.put(KEY_LAST_SYNC, at.toString())

    /** Local unlink. The account-side link is revoked over the network first. */
    fun clear() = store.clear()

    /**
     * One-time move of the plaintext token written by the very first build into
     * this vault. The legacy copy is wiped so nothing lingers on disk.
     *
     * There is intentionally no migration path for the unpublished intermediate
     * EncryptedSharedPreferences build — it never shipped.
     */
    fun migrateFrom(legacy: SecureStore): Boolean {
        if (paired) { legacy.clear(); return false }
        val legacyToken = legacy.get(KEY_TOKEN) ?: legacy.get(LEGACY_KEY_TOKEN) ?: return false
        if (legacyToken.isBlank()) { legacy.clear(); return false }
        save(
            token = legacyToken,
            label = legacy.get(KEY_LABEL) ?: legacy.get(LEGACY_KEY_LABEL),
            deviceId = legacy.get(KEY_DEVICE_ID),
            at = legacy.get(KEY_PAIRED_AT)?.toLongOrNull() ?: System.currentTimeMillis(),
        )
        legacy.get(KEY_LAST_SYNC)?.toLongOrNull()?.let { markSynced(it) }
        legacy.clear()
        return true
    }

    companion object {
        const val KEY_TOKEN = "device_token"
        const val KEY_LABEL = "device_label"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_PAIRED_AT = "paired_at"
        const val KEY_LAST_SYNC = "last_sync_at"

        // Names used by the very first build before this vault existed.
        const val LEGACY_KEY_TOKEN = "token"
        const val LEGACY_KEY_LABEL = "label"
        const val LEGACY_PREFS = "irondesk"

        const val KEY_ALIAS = "irondesk-device-key"

        fun onDevice(context: Context): TokenVault =
            TokenVault(CodecStore(context, codec = KeystoreCodec(KEY_ALIAS)))
                .also { it.migrateFrom(PlainStore(context, LEGACY_PREFS)) }
    }
}
