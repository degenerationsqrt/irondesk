package app.irondesk.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SyncQueueTest {

    @get:Rule val temp = TemporaryFolder()

    private fun queue(max: Int = 5) = SyncQueue(temp.newFolder(), maxEntries = max)

    /** Stand-in for the Keystore codec: reversible, and detectably "encrypted". */
    private object ReversingCodec : Codec {
        override fun encode(plain: String): String = "enc:" + plain.reversed()
        override fun decode(blob: String): String? =
            if (blob.startsWith("enc:")) blob.removePrefix("enc:").reversed() else null
    }

    @Test fun `enqueues and replays oldest first`() {
        val q = queue()
        assertTrue(q.enqueue("{\"a\":1}", at = 1_000))
        assertTrue(q.enqueue("{\"a\":2}", at = 2_000))
        assertEquals(2, q.size)
        assertEquals("{\"a\":1}", q.entries().first().read())
    }

    @Test fun `identical payloads are not queued twice`() {
        val q = queue()
        assertTrue(q.enqueue("{\"a\":1}", at = 1_000))
        assertFalse(q.enqueue("{\"a\":1}", at = 5_000))
        assertEquals(1, q.size)
    }

    @Test fun `removing an entry drains it`() {
        val q = queue()
        q.enqueue("{\"a\":1}", at = 1_000)
        q.remove(q.entries().first())
        assertEquals(0, q.size)
    }

    @Test fun `cap drops the oldest batches`() {
        val q = queue(max = 2)
        q.enqueue("{\"a\":1}", at = 1_000)
        q.enqueue("{\"a\":2}", at = 2_000)
        q.enqueue("{\"a\":3}", at = 3_000)
        assertEquals(2, q.size)
        assertEquals(listOf("{\"a\":2}", "{\"a\":3}"), q.entries().map { it.read() })
    }

    @Test fun `clear empties the outbox`() {
        val q = queue()
        q.enqueue("{\"a\":1}", at = 1_000)
        q.clear()
        assertEquals(0, q.size)
    }

    @Test fun `payloads are stored through the codec and read back`() {
        val dir = temp.newFolder()
        val q = SyncQueue(dir, codec = ReversingCodec)
        q.enqueue("{\"a\":1}", at = 1_000)

        val file = dir.listFiles()!!.single()
        assertFalse(file.readText().contains("{\"a\":1}"))
        assertEquals("{\"a\":1}", q.entries().single().read())
    }

    @Test fun `dedupe still works on the plaintext under encryption`() {
        val q = SyncQueue(temp.newFolder(), codec = ReversingCodec)
        assertTrue(q.enqueue("{\"a\":1}", at = 1_000))
        assertFalse(q.enqueue("{\"a\":1}", at = 9_000))
        assertEquals(1, q.size)
    }

    @Test fun `a corrupt blob reads as null instead of crashing`() {
        val dir = temp.newFolder()
        val q = SyncQueue(dir, codec = ReversingCodec)
        q.enqueue("{\"a\":1}", at = 1_000)
        dir.listFiles()!!.single().writeText("garbage")

        assertEquals(1, q.size)
        assertNull(q.entries().single().read())
    }
}
