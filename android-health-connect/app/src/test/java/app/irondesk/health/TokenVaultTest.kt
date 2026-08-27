package app.irondesk.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class MemoryStore(private val map: MutableMap<String, String> = mutableMapOf()) : SecureStore {
    override fun get(key: String): String? = map[key]
    override fun put(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
    override fun keys(): Set<String> = map.keys
    override fun clear() = map.clear()
}

class TokenVaultTest {

    @Test fun `saves and reports pairing state`() {
        val vault = TokenVault(MemoryStore())
        assertFalse(vault.paired)
        vault.save("tok_abc", "Pixel 8", "dev-1", at = 1_700_000_000_000)
        assertTrue(vault.paired)
        assertEquals("tok_abc", vault.token)
        assertEquals("Pixel 8", vault.label)
        assertEquals("dev-1", vault.deviceId)
        assertEquals(1_700_000_000_000, vault.pairedAt)
        assertEquals(0L, vault.lastSyncAt)
    }

    @Test fun `clear removes the token`() {
        val vault = TokenVault(MemoryStore())
        vault.save("tok_abc", null, null)
        vault.markSynced(42)
        assertEquals(42L, vault.lastSyncAt)
        vault.clear()
        assertFalse(vault.paired)
        assertNull(vault.token)
    }

    @Test fun `migrates a legacy token and wipes the old copy`() {
        val legacy = MemoryStore().apply {
            put(TokenVault.LEGACY_KEY_TOKEN, "tok_old")
            put(TokenVault.LEGACY_KEY_LABEL, "Old phone")
            put(TokenVault.KEY_LAST_SYNC, "99")
        }
        val vault = TokenVault(MemoryStore())

        assertTrue(vault.migrateFrom(legacy))
        assertEquals("tok_old", vault.token)
        assertEquals("Old phone", vault.label)
        assertEquals(99L, vault.lastSyncAt)
        assertTrue(legacy.keys().isEmpty())
    }

    @Test fun `migration never overwrites a current token`() {
        val legacy = MemoryStore().apply { put(TokenVault.KEY_TOKEN, "tok_old") }
        val vault = TokenVault(MemoryStore()).apply { save("tok_new", "Phone", "dev-2") }

        assertFalse(vault.migrateFrom(legacy))
        assertEquals("tok_new", vault.token)
        assertTrue(legacy.keys().isEmpty())
    }

    @Test fun `migration is a no-op when there is nothing to move`() {
        assertFalse(TokenVault(MemoryStore()).migrateFrom(MemoryStore()))
    }
}
