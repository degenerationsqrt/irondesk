package app.irondesk.mobile.preview.workout

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

/** Versioned binary envelope. An unknown or corrupt format fails closed. */
object WorkoutEventBinaryCodec {
    private const val MAGIC = 0x4952444B // IRDK
    private const val VERSION = 1
    private const val MAX_EVENTS = 10_000
    private const val MAX_STRING_BYTES = 64 * 1024

    fun encode(events: List<WorkoutEvent>): ByteArray {
        require(events.size <= MAX_EVENTS) { "journal is too large" }
        // Validate the full event sequence before it can reach disk.
        WorkoutReducer.reduce(events)

        return ByteArrayOutputStream().use { bytes ->
            DataOutputStream(bytes).use { out ->
                out.writeInt(MAGIC)
                out.writeInt(VERSION)
                out.writeInt(events.size)
                events.forEach { event ->
                    when (event) {
                        is SessionStarted -> {
                            out.writeByte(1)
                            writeCommon(out, event)
                            writeString(out, event.title)
                        }

                        is SetLogged -> {
                            out.writeByte(2)
                            writeCommon(out, event)
                            writeString(out, event.exerciseId)
                            writeString(out, event.exerciseName)
                            out.writeInt(event.setNumber)
                            out.writeDouble(event.weightKg)
                            out.writeInt(event.reps)
                            out.writeDouble(event.rpe)
                        }

                        is SessionFinished -> {
                            out.writeByte(3)
                            writeCommon(out, event)
                        }
                    }
                }
            }
            bytes.toByteArray()
        }
    }

    fun decode(bytes: ByteArray): List<WorkoutEvent> =
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            require(input.readInt() == MAGIC) { "journal magic is invalid" }
            require(input.readInt() == VERSION) { "journal version is unsupported" }
            val count = input.readInt()
            require(count in 0..MAX_EVENTS) { "journal event count is invalid" }

            val events = buildList(count) {
                repeat(count) {
                    val kind = input.readUnsignedByte()
                    val eventId = readString(input)
                    val sessionId = readString(input)
                    val at = input.readLong()
                    add(
                        when (kind) {
                            1 -> SessionStarted(eventId, sessionId, at, readString(input))
                            2 -> SetLogged(
                                eventId = eventId,
                                sessionId = sessionId,
                                occurredAtEpochMillis = at,
                                exerciseId = readString(input),
                                exerciseName = readString(input),
                                setNumber = input.readInt(),
                                weightKg = input.readDouble(),
                                reps = input.readInt(),
                                rpe = input.readDouble(),
                            )
                            3 -> SessionFinished(eventId, sessionId, at)
                            else -> error("journal event type is unsupported")
                        },
                    )
                }
            }
            require(input.available() == 0) { "journal has trailing data" }
            WorkoutReducer.reduce(events)
            events
        }

    private fun writeCommon(out: DataOutputStream, event: WorkoutEvent) {
        writeString(out, event.eventId)
        writeString(out, event.sessionId)
        out.writeLong(event.occurredAtEpochMillis)
    }

    private fun writeString(out: DataOutputStream, value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_STRING_BYTES) { "journal string is too large" }
        out.writeInt(bytes.size)
        out.write(bytes)
    }

    private fun readString(input: DataInputStream): String {
        val length = input.readInt()
        require(length in 0..MAX_STRING_BYTES) { "journal string length is invalid" }
        val bytes = ByteArray(length)
        input.readFully(bytes)
        return String(bytes, Charsets.UTF_8)
    }
}
