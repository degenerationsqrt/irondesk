package app.irondesk.mobile.preview.workout

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.channels.OverlappingFileLockException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap

interface SensitiveCodec {
    fun encode(plain: ByteArray): ByteArray?
    fun decode(blob: ByteArray): ByteArray?
}

sealed interface JournalLoad {
    data object Empty : JournalLoad
    data class Ready(val events: List<WorkoutEvent>, val snapshot: WorkoutSnapshot) : JournalLoad
    data class Corrupt(val reason: String) : JournalLoad
    data class Unavailable(val reason: String) : JournalLoad
}

enum class AppendResult {
    APPENDED,
    DUPLICATE,
    CONFLICT,
    INVALID,
    CORRUPT,
    ENCRYPTION_FAILED,
    TOO_LARGE,
    STORAGE_FAILED,
}

/**
 * One encrypted, atomically replaced journal. Corruption is surfaced instead
 * of being treated as an empty workout, which prevents silent data loss.
 */
class WorkoutJournal(
    private val file: File,
    private val codec: SensitiveCodec,
) {
    private val processLock = PROCESS_LOCKS.computeIfAbsent(
        runCatching { file.canonicalPath }.getOrDefault(file.absolutePath),
    ) { Any() }

    fun load(): JournalLoad = withJournalLock(
        onFailure = { JournalLoad.Unavailable("The workout journal is temporarily unavailable.") },
        action = ::loadUnlocked,
    )

    private fun loadUnlocked(): JournalLoad {
        if (!file.exists()) return JournalLoad.Empty
        return try {
            if (file.length() > MAX_FILE_BYTES) {
                return JournalLoad.Corrupt("The stored journal is unexpectedly large.")
            }
            val plain = codec.decode(file.readBytes())
                ?: return JournalLoad.Corrupt("The encryption key or stored journal is unreadable.")
            val events = WorkoutEventBinaryCodec.decode(plain)
            val snapshot = WorkoutReducer.reduce(events)
                ?: return JournalLoad.Corrupt("The stored journal contains no session.")
            JournalLoad.Ready(events, snapshot)
        } catch (error: Exception) {
            JournalLoad.Corrupt(error.message ?: "The stored journal is invalid.")
        }
    }

    fun append(event: WorkoutEvent): AppendResult = withJournalLock(
        onFailure = { AppendResult.STORAGE_FAILED },
    ) {
        val existing = when (val current = loadUnlocked()) {
            JournalLoad.Empty -> emptyList()
            is JournalLoad.Ready -> current.events
            is JournalLoad.Corrupt -> return@withJournalLock AppendResult.CORRUPT
            is JournalLoad.Unavailable -> return@withJournalLock AppendResult.STORAGE_FAILED
        }
        existing.firstOrNull { it.eventId == event.eventId }?.let { previous ->
            return@withJournalLock if (previous == event) {
                AppendResult.DUPLICATE
            } else {
                AppendResult.CONFLICT
            }
        }

        val encoded = try {
            WorkoutEventBinaryCodec.encode(existing + event)
        } catch (_: IllegalArgumentException) {
            return@withJournalLock AppendResult.INVALID
        } catch (_: IllegalStateException) {
            return@withJournalLock AppendResult.INVALID
        }
        val encrypted = codec.encode(encoded)
            ?: return@withJournalLock AppendResult.ENCRYPTION_FAILED
        if (encrypted.size > MAX_FILE_BYTES) {
            return@withJournalLock AppendResult.TOO_LARGE
        }
        if (writeAtomically(encrypted)) AppendResult.APPENDED else AppendResult.STORAGE_FAILED
    }

    fun clear(): Boolean = withJournalLock(onFailure = { false }) {
        try {
            val temp = tempFile()
            (!file.exists() || file.delete()) && (!temp.exists() || temp.delete())
        } catch (_: SecurityException) {
            false
        }
    }

    private fun writeAtomically(bytes: ByteArray): Boolean {
        val parent = file.parentFile ?: return false
        if (!parent.exists() && !parent.mkdirs()) return false
        val temp = tempFile()

        return try {
            FileOutputStream(temp).use { output ->
                output.write(bytes)
                output.fd.sync()
            }
            // Fail safely if the backing filesystem cannot guarantee an atomic
            // same-directory replacement; never claim a partially safe commit.
            Files.move(
                temp.toPath(),
                file.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            true
        } catch (_: IOException) {
            temp.delete()
            false
        } catch (_: SecurityException) {
            temp.delete()
            false
        }
    }

    private fun tempFile(): File = File(file.parentFile, ".${file.name}.tmp")

    private fun lockFile(): File = File(file.parentFile, ".${file.name}.lock")

    /**
     * The process lock serializes separate Activity/worker instances. The file
     * lock extends that protection to an accidentally introduced second process.
     */
    private inline fun <T> withJournalLock(onFailure: (Exception) -> T, action: () -> T): T =
        synchronized(processLock) {
            val parent = file.parentFile
            if (parent == null || (!parent.exists() && !parent.mkdirs())) {
                return@synchronized onFailure(IOException("Journal directory is unavailable."))
            }
            try {
                RandomAccessFile(lockFile(), "rw").use { randomAccess ->
                    randomAccess.channel.use { channel ->
                        channel.lock().use { action() }
                    }
                }
            } catch (error: IOException) {
                onFailure(error)
            } catch (error: SecurityException) {
                onFailure(error)
            } catch (error: OverlappingFileLockException) {
                onFailure(error)
            }
        }

    private companion object {
        const val MAX_FILE_BYTES = 8 * 1024 * 1024
        val PROCESS_LOCKS = ConcurrentHashMap<String, Any>()
    }
}
