package app.irondesk.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingCodeTest {

    @Test fun `normalizes case spaces and dashes`() {
        assertEquals("ABCD2345", PairingCode.normalize("abcd-23 45"))
    }

    @Test fun `truncates to eight characters`() {
        assertEquals(8, PairingCode.normalize("ABCDEFGHJKLM").length)
    }

    @Test fun `accepts a well formed code`() {
        assertNull(PairingCode.validate("ABCD2345"))
        assertTrue(PairingCode.isValid("abcd-2345"))
    }

    @Test fun `rejects short codes with a countdown`() {
        assertEquals("Codes are 8 characters — 3 to go.", PairingCode.validate("ABCDE"))
    }

    @Test fun `rejects empty input`() {
        assertNotNull(PairingCode.validate("   "))
    }

    @Test fun `rejects ambiguous glyphs that the generator never emits`() {
        assertFalse(PairingCode.isValid("ABCD01IO"))
        assertTrue(PairingCode.validate("ABCD01IO")!!.contains("I/1"))
    }

    @Test fun `pretty groups in fours without changing the value`() {
        assertEquals("ABCD-2345", PairingCode.pretty("abcd2345"))
        assertEquals("ABC", PairingCode.pretty("abc"))
    }

    @Test fun `device names keep interior spaces and reject stubs`() {
        assertEquals("Pixel 8 Pro", DeviceName.normalize("Pixel 8 Pro"))
        assertNull(DeviceName.validate("Pixel 8"))
        assertNotNull(DeviceName.validate("P"))
        assertEquals(DeviceName.MAX, DeviceName.normalize("x".repeat(80)).length)
    }
}
