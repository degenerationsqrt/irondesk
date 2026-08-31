package app.irondesk.mobile.preview.workout

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class WorkoutJournalTest {
    @get:Rule val temp = TemporaryFolder()

    private object PlainCodec : SensitiveCodec {
        override fun encode(plain: ByteArray): ByteArray = plain.copyOf()
        override fun decode(blob: ByteArray): ByteArray = blob.copyOf()
    }

    private object ReversingCodec : SensitiveCodec {
        override fun encode(plain: ByteArray): ByteArray = byteArrayOf(0x5a) + plain.reversedArray()
        override fun decode(blob: ByteArray): ByteArray? =
            if (blob.firstOrNull() == 0x5a.toByte()) blob.drop(1).toByteArray().reversedArray() else null
    }

    private object OversizedCodec : SensitiveCodec {
        override fun encode(plain: ByteArray): ByteArray = ByteArray(8 * 1024 * 1024 + 1)
        override fun decode(blob: ByteArray): ByteArray = blob.copyOf()
    }

    private fun started(at: Long = 1_000) = SessionStarted(
        eventId = "session-1:start",
        sessionId = "session-1",
        occurredAtEpochMillis = at,
        title = "Lower Strength",
    )

    private fun set(eventId: String = "mutation-1", number: Int = 1) = SetLogged(
        eventId = eventId,
        sessionId = "session-1",
        occurredAtEpochMillis = 2_000L + number,
        exerciseId = "back-squat",
        exerciseName = "Back Squat",
        setNumber = number,
        weightKg = 100.0,
        reps = 5,
        rpe = 8.0,
    )

    @Test fun `binary codec round trips a valid workout`() {
        val events = listOf(started(), set(), SessionFinished("finish-1", "session-1", 3_000))
        assertEquals(events, WorkoutEventBinaryCodec.decode(WorkoutEventBinaryCodec.encode(events)))
    }

    @Test fun `journal restores an encrypted active workout`() {
        val file = File(temp.root, "journal.bin")
        val journal = WorkoutJournal(file, ReversingCodec)
        assertEquals(AppendResult.APPENDED, journal.append(started()))
        assertEquals(AppendResult.APPENDED, journal.append(set()))

        val loaded = WorkoutJournal(file, ReversingCodec).load() as JournalLoad.Ready
        assertEquals(WorkoutStatus.ACTIVE, loaded.snapshot.status)
        assertEquals(1, loaded.snapshot.sets.size)
        assertEquals("mutation-1", loaded.snapshot.sets.single().mutationId)
        assertFalse(String(file.readBytes(), Charsets.UTF_8).contains("Lower Strength"))
    }

    @Test fun `same client mutation is idempotent`() {
        val journal = WorkoutJournal(File(temp.root, "journal.bin"), PlainCodec)
        journal.append(started())
        assertEquals(AppendResult.APPENDED, journal.append(set()))
        assertEquals(AppendResult.DUPLICATE, journal.append(set()))
        val loaded = journal.load() as JournalLoad.Ready
        assertEquals(1, loaded.snapshot.sets.size)
    }

    @Test fun `reused mutation id with different payload is a conflict`() {
        val file = File(temp.root, "journal.bin")
        val journal = WorkoutJournal(file, PlainCodec)
        journal.append(started())
        journal.append(set())
        val before = file.readBytes()

        assertEquals(AppendResult.CONFLICT, journal.append(set(number = 2)))
        assertArrayEquals(before, file.readBytes())
        assertEquals(1, (journal.load() as JournalLoad.Ready).snapshot.sets.size)
    }

    @Test fun `separate journal instances serialize concurrent appends`() {
        val file = File(temp.root, "journal.bin")
        WorkoutJournal(file, PlainCodec).append(started())
        val first = WorkoutJournal(file, PlainCodec)
        val second = WorkoutJournal(file, PlainCodec)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)

        try {
            val left = pool.submit<List<AppendResult>> {
                start.await()
                (1..20 step 2).map { first.append(set("mutation-$it", it)) }
            }
            val right = pool.submit<List<AppendResult>> {
                start.await()
                (2..20 step 2).map { second.append(set("mutation-$it", it)) }
            }
            start.countDown()

            assertTrue(left.get(10, TimeUnit.SECONDS).all { it == AppendResult.APPENDED })
            assertTrue(right.get(10, TimeUnit.SECONDS).all { it == AppendResult.APPENDED })
            val loaded = WorkoutJournal(file, PlainCodec).load() as JournalLoad.Ready
            assertEquals(20, loaded.snapshot.sets.size)
            assertEquals((1..20).toSet(), loaded.snapshot.sets.map { it.setNumber }.toSet())
        } finally {
            pool.shutdownNow()
        }
    }

    @Test fun `finished workout rejects a later set without changing disk`() {
        val file = File(temp.root, "journal.bin")
        val journal = WorkoutJournal(file, PlainCodec)
        journal.append(started())
        journal.append(set())
        journal.append(SessionFinished("finish-1", "session-1", 3_000))
        val before = file.readBytes()

        assertEquals(AppendResult.INVALID, journal.append(set("mutation-2", 2)))
        assertArrayEquals(before, file.readBytes())
        assertEquals(WorkoutStatus.FINISHED, (journal.load() as JournalLoad.Ready).snapshot.status)
    }

    @Test fun `corruption is explicit and is never overwritten by append`() {
        val file = File(temp.root, "journal.bin").apply { writeText("not a journal") }
        val journal = WorkoutJournal(file, ReversingCodec)
        val before = file.readBytes()

        assertTrue(journal.load() is JournalLoad.Corrupt)
        assertEquals(AppendResult.CORRUPT, journal.append(started()))
        assertArrayEquals(before, file.readBytes())
    }

    @Test fun `oversized encrypted journal is rejected before replacement`() {
        val file = File(temp.root, "journal.bin")
        val journal = WorkoutJournal(file, OversizedCodec)

        assertEquals(AppendResult.TOO_LARGE, journal.append(started()))
        assertFalse(file.exists())
    }

    @Test fun `reducer ignores an exact replay but preserves all unique mutations`() {
        val snapshot = WorkoutReducer.reduce(
            listOf(started(), set(), set(), set("mutation-2", 2)),
        )!!
        assertEquals(2, snapshot.sets.size)
        assertEquals(setOf("session-1:start", "mutation-1", "mutation-2"), snapshot.pendingMutationIds)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `reducer rejects a divergent replay`() {
        WorkoutReducer.reduce(listOf(started(), set(), set(number = 2)))
    }
}
