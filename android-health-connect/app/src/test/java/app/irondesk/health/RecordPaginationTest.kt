package app.irondesk.health

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class RecordPaginationTest {
    @Test fun `follows pages and permits an exact complete limit`() = runBlocking {
        val tokens = mutableListOf<String?>()
        val result = readCompletePages(3) { token ->
            tokens += token
            if (token == null) RecordPage(listOf(1, 2), "next") else RecordPage(listOf(3), null)
        }
        assertEquals(listOf(1, 2, 3), result)
        assertEquals(listOf(null, "next"), tokens)
    }

    @Test fun `never returns a silently truncated range`() {
        assertThrows(IllegalStateException::class.java) {
            runBlocking { readCompletePages(2) { RecordPage(listOf(1, 2), "more") } }
        }
        assertThrows(IllegalStateException::class.java) {
            runBlocking { readCompletePages(2) { RecordPage(listOf(1, 2, 3), null) } }
        }
    }

    @Test fun `repeated empty continuation page cannot loop forever`() {
        var requests = 0
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                readCompletePages<Int>(10) { requests++; RecordPage(emptyList(), "same") }
            }
        }
        assertEquals(2, requests)
    }
}
