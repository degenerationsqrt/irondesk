package app.irondesk.health

import java.io.File
import java.security.MessageDigest
import java.util.Locale

/**
 * A tiny file-backed outbox so a failed upload is not lost.
 *
 * Deliberately not WorkManager and not a background job: nothing here reads
 * health data or runs on its own. The queue only holds payloads the user
 * already prepared, and it is drained on the next "Sync Now".
 *
 * Bodies are written through [codec], so on device the queued health data is
 * encrypted at rest with the same AndroidKeyStore key as the token. The codec is
 * injectable, which keeps dedupe/order/retry behavior JVM-testable.
 *
 * Files are named `<epochMillis>-<sha256 prefix>.json`; the hash is taken over
 * the *plaintext* so an identical payload is idempotent regardless of the random
 * IV. Retrying after a timeout that actually succeeded server-side cannot
 * double-queue, and the server's `external_id` dedupe makes a real double-send a
 * no-op anyway.
 */
class SyncQueue(
    private val dir: File,
    private val maxEntries: Int = 5,
    private val codec: Codec = PlainCodec,
) {

    init { dir.mkdirs() }

    inner class Entry(val file: File, val queuedAt: Long) {
        /** Null when the stored blob is corrupt or its key was invalidated. */
        fun read(): String? = runCatching { file.readText() }.getOrNull()?.let { codec.decode(it) }
    }

    fun enqueue(payload: String, at: Long = System.currentTimeMillis()): Boolean {
        val digest = sha256(payload)
        if (entries().any { it.file.name.endsWith("-$digest.json") }) return false
        val blob = codec.encode(payload) ?: return false
        File(dir, "$at-$digest.json").writeText(blob)
        trim()
        return true
    }

    fun entries(): List<Entry> = (dir.listFiles() ?: emptyArray())
        .filter { it.isFile && it.name.endsWith(".json") }
        .map { Entry(it, it.name.substringBefore('-').toLongOrNull() ?: 0L) }
        .sortedBy { it.queuedAt }

    val size: Int get() = entries().size

    fun remove(entry: Entry) { entry.file.delete() }

    fun clear() { entries().forEach { it.file.delete() } }

    /** Oldest entries are dropped first once the cap is reached. */
    private fun trim() {
        val all = entries()
        if (all.size <= maxEntries) return
        all.take(all.size - maxEntries).forEach { it.file.delete() }
    }

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            .take(8)
            .joinToString("") { String.format(Locale.ROOT, "%02x", it.toInt() and 0xff) }
}
