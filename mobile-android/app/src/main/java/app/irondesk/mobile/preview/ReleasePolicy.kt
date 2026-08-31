package app.irondesk.mobile.preview

/** Visible, executable boundary for this intentionally non-releaseable build. */
object ReleasePolicy {
    val blockedGates = listOf(
        "Permanent Play package and upload-signing identity",
        "Secure Supabase authentication and token rotation",
        "Replay-safe Supabase workout sync contract",
        "Health Connect companion code extracted into a shared native module",
        "Offline, process-death, Android 13/14+, and physical-device QA",
        "Play Data safety, Health apps, billing, and reviewer-access approval",
    )
}
