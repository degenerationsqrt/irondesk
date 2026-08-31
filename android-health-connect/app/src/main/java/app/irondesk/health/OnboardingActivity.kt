package app.irondesk.health

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity

/**
 * Health Connect can start this flow when an athlete connects IronDesk from
 * system settings. Pairing and permission education live in [MainActivity], so
 * this protected entry point forwards there instead of duplicating that flow.
 */
class OnboardingActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, MainActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,
            ),
        )
        finish()
    }
}
