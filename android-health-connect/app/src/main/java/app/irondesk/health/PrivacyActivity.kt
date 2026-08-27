package app.irondesk.health

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The permission rationale / data-usage screen Health Connect and Android's
 * permission manager link to. Deliberately a separate screen from the export
 * and sync UI so it is readable before any permission is granted.
 */
class PrivacyActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            IronDeskTheme {
                Surface {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(20.dp).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("How IronDesk uses your health data", style = MaterialTheme.typography.headlineSmall)
                        Text(
                            "What is read: steps, sleep, resting heart rate, HRV, weight, active calories, distance and " +
                                "workout sessions — only the types you approve, and only for the date range you pick.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            "Where it goes: nowhere until you act. You either export a file you choose the location of, " +
                                "or press Sync Now to send the records to your own IronDesk account over HTTPS. There is " +
                                "no background collection, no advertising, no analytics and no third-party sharing.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            "How it is authorised: pairing exchanges a one-time code from IronDesk for a device token " +
                                "stored encrypted on this phone. It grants nothing except the ability to add health " +
                                "records to your own account, and you can revoke it from IronDesk at any time.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            "How to stop it: revoke access in Settings → Health Connect → App permissions, unlink the " +
                                "device in IronDesk, or uninstall this app — which deletes the token and every local copy.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            "This app never writes to Health Connect and never reads a record type you did not approve.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}
