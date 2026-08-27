package app.irondesk.health

/**
 * Pairing-code rules, kept pure so they are unit-testable without Android.
 *
 * IronDesk generates 8 characters from a Crockford-like alphabet with the
 * ambiguous glyphs (I, O, 0, 1) removed. Anything else cannot be a real code,
 * so it is rejected on the phone instead of burning a server round-trip.
 */
object PairingCode {

    const val LENGTH = 8
    const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    /** Upper-cases, drops spaces and dashes, and trims to the code length. */
    fun normalize(input: String): String =
        input.uppercase().filter { it != ' ' && it != '-' && it != '\n' && it != '\t' }.take(LENGTH)

    /** Null when the code is acceptable, otherwise a message for the field helper. */
    fun validate(input: String): String? {
        val code = normalize(input)
        if (code.isEmpty()) return "Enter the 8-character code from IronDesk."
        if (code.length < LENGTH) return "Codes are $LENGTH characters — ${LENGTH - code.length} to go."
        val bad = code.filterNot { ALPHABET.contains(it) }.toSortedSet()
        if (bad.isNotEmpty()) {
            return "Codes never contain ${bad.joinToString(", ")}. Check I/1 and O/0."
        }
        return null
    }

    fun isValid(input: String): Boolean = validate(input) == null

    /** Display grouping: ABCD-EFGH, purely cosmetic. */
    fun pretty(input: String): String {
        val code = normalize(input)
        return if (code.length <= 4) code else code.substring(0, 4) + "-" + code.substring(4)
    }
}

/** Device names are shown in IronDesk, so keep them short and printable. */
object DeviceName {
    const val MAX = 40

    /** Keeps interior spaces so the field stays typeable; only control chars go. */
    fun normalize(input: String): String =
        input.filter { it == ' ' || it.code in 33..126 || it.isLetterOrDigit() }.take(MAX)

    fun validate(input: String): String? =
        if (normalize(input).trim().length < 2) "Give this phone a name you'll recognise in IronDesk." else null
}
