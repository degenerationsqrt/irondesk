package app.irondesk.health

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Talks to the three IronDesk endpoints this app needs, and nothing else:
 *
 *  POST /api/public/health-connect/pair    — one-time code  → device token
 *  POST /api/public/health-connect/ingest  — Bearer token   → normalized records
 *  POST /api/public/health-connect/unpair  — Bearer token   → revoke this device
 *
 * All HTTPS-only. No other host is ever contacted, and no secret is embedded in
 * the binary: the token is earned at pairing time.
 */
class SyncClient(private val baseUrl: String = BuildConfig.IRONDESK_BASE_URL) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    data class Pairing(val token: String, val label: String?, val deviceId: String?)

    /** A definite server refusal — retrying the same payload will not help. */
    open class SyncException(message: String) : Exception(message)

    /** The server no longer knows this token: the link is already gone. */
    class RevokedException(message: String) : SyncException(message)

    /** Network/timeout failure: the payload is still good and gets queued. */
    class TransientException(message: String) : Exception(message)

    /** Exchanges the code shown in IronDesk for a device token. Single use. */
    fun pair(code: String, deviceLabel: String): Pairing {
        val body = JSONObject()
            .put("code", PairingCode.normalize(code))
            .put("device_label", DeviceName.normalize(deviceLabel).ifEmpty { "Android phone" })
            .put("platform", "android")
            .toString()

        val response = post("/api/public/health-connect/pair", body, token = null)
        val token = response.optString("device_token").takeIf { it.isNotEmpty() }
            ?: throw SyncException("Pairing succeeded but no device token was returned.")
        return Pairing(
            token = token,
            label = response.optString("label").takeIf { it.isNotEmpty() },
            deviceId = response.optString("device_id").takeIf { it.isNotEmpty() },
        )
    }

    data class Result(
        val imported: Int,
        val duplicates: Int,
        val failed: Int,
        val warnings: Int,
        val recoveryDays: Int,
        val bodyweightDays: Int,
    ) {
        fun describe(): String = buildString {
            append("$imported new")
            if (duplicates > 0) append(", $duplicates already present")
            if (failed > 0) append(", $failed skipped")
            if (recoveryDays > 0 || bodyweightDays > 0) {
                append(" — filled $recoveryDays recovery day(s)")
                if (bodyweightDays > 0) append(" and $bodyweightDays weight entry(ies)")
            }
            append('.')
        }
    }

    /** Pushes an already-normalized export payload under the device token. */
    fun sync(token: String, payload: String): Result {
        val response = post("/api/public/health-connect/ingest", payload, token)
        return Result(
            imported = response.optInt("imported"),
            duplicates = response.optInt("duplicates"),
            failed = response.optInt("failed"),
            warnings = response.optInt("warnings"),
            recoveryDays = response.optInt("recoveryDays"),
            bodyweightDays = response.optInt("bodyweightDays"),
        )
    }

    /** What the caller may safely conclude about the account-side link. */
    enum class UnpairOutcome { REVOKED_NOW, ALREADY_REVOKED }

    /**
     * Revokes this device server-side. The token identifies the row to delete.
     *
     * Returns only when the link is provably gone; every other failure throws so
     * the caller keeps the token instead of pretending it was revoked.
     */
    fun unpair(token: String): UnpairOutcome = try {
        post("/api/public/health-connect/unpair", "{}", token)
        UnpairOutcome.REVOKED_NOW
    } catch (revoked: RevokedException) {
        UnpairOutcome.ALREADY_REVOKED
    }

    private fun post(path: String, body: String, token: String?): JSONObject {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .post(body.toRequestBody(JSON))
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()

        val response = try {
            http.newCall(request).execute()
        } catch (io: IOException) {
            throw TransientException("No connection to IronDesk (${io.message ?: "network error"}).")
        }

        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                val message = runCatching { JSONObject(text).optString("error") }.getOrNull()
                val detail = message?.takeIf { m -> m.isNotEmpty() }
                when (it.code) {
                    408, in 500..599 -> throw TransientException(detail ?: "IronDesk is unavailable (HTTP ${it.code}).")
                    401 -> throw RevokedException(
                        detail ?: "IronDesk no longer recognises this device. Pair again with a fresh code.",
                    )
                    413 -> throw SyncException("The batch was too large. Use a shorter date range.")
                    429 -> throw TransientException("Too many requests. Wait a minute and retry.")
                    else -> throw SyncException(detail ?: "IronDesk returned HTTP ${it.code}.")
                }
            }
            return runCatching { JSONObject(text) }.getOrElse { JSONObject() }
        }
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
