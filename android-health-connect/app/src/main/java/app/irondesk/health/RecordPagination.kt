package app.irondesk.health

internal data class RecordPage<T>(val records: List<T>, val nextToken: String?)

/** A bounded read succeeds only when the complete requested range was read. */
internal suspend fun <T> readCompletePages(
    maxRecords: Int,
    fetch: suspend (String?) -> RecordPage<T>,
): List<T> {
    val records = mutableListOf<T>()
    val seenTokens = mutableSetOf<String>()
    var token: String? = null
    do {
        val page = fetch(token)
        check(page.records.size <= maxRecords - records.size) {
            "Too many Health Connect records. Choose a shorter date range."
        }
        records += page.records
        token = page.nextToken
        if (token != null) {
            check(records.size < maxRecords) {
                "Too many Health Connect records. Choose a shorter date range."
            }
            check(seenTokens.add(token) && seenTokens.size < 100) {
                "Health Connect could not finish reading this range. Choose a shorter range and retry."
            }
        }
    } while (token != null)
    return records
}
