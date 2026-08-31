import { Link, createFileRoute } from "@tanstack/react-router";
import { ExternalLink, ShieldCheck, Smartphone } from "lucide-react";

import { LegalPageShell } from "@/components/irondesk/legal-page-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/health-connect")({
  head: () => ({
    meta: [
      { title: "IronDesk Health for Android — Setup and Use" },
      {
        name: "description",
        content:
          "Install, pair, preview, sync and revoke the private-beta IronDesk Health Connect companion for Android.",
      },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: HealthConnectSetupPage,
});

const BETA_VERSION = "1.1.0-beta.1";
const configuredBetaDownloadUrl = import.meta.env["VITE_HEALTH_CONNECT_DOWNLOAD_URL"]?.trim();
const betaDownloadUrl = configuredBetaDownloadUrl?.startsWith("https://")
  ? configuredBetaDownloadUrl
  : undefined;

function HealthConnectSetupPage() {
  return (
    <LegalPageShell
      title="IronDesk Health for Android"
      subtitle={`Private beta ${BETA_VERSION} · Android Health Connect · Read-only, manual sync`}
    >
      <section>
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2>Private-beta availability</h2>
            <p className="mt-2">
              IronDesk Health is the Android bridge between Health Connect and your IronDesk
              account. It is currently a controlled test build, not a finished public Play Store
              release. The older IronDesk 0.9.0 debug APK is a different application and must not be
              used as this connector.
            </p>
            {betaDownloadUrl ? (
              <Button asChild className="mt-4">
                <a href={betaDownloadUrl} rel="noreferrer">
                  Download Android beta <ExternalLink className="size-4" />
                </a>
              </Button>
            ) : (
              <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning">
                No vetted installer is published yet. Approved testers receive the versioned build
                only after its signing identity and checksum have been verified.
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2>Before you begin</h2>
        <ul className="mt-2">
          <li>An Android 9 or newer phone is required.</li>
          <li>
            On Android 14 or newer, Health Connect is built into Android Settings. On earlier
            supported versions, install or update Health Connect through Google Play.
          </li>
          <li>
            Let Samsung Health, your watch application or another tracker finish writing the records
            you want to Health Connect before opening IronDesk Health.
          </li>
          <li>
            You must be signed into your real IronDesk account; demo mode cannot pair a phone.
          </li>
        </ul>
      </section>

      <section>
        <h2>Pair the phone</h2>
        <ol className="mt-2 space-y-1.5 [&_li]:ml-5 [&_li]:list-decimal">
          <li>
            Sign in and open <strong>Connections &amp; Imports</strong>.
          </li>
          <li>Under Health Connect companion, select Generate Android code.</li>
          <li>Open IronDesk Health on the phone and enter the eight-character code.</li>
          <li>Give the phone a recognizable name, then select Pair this phone.</li>
          <li>
            The code is single-use, expires after 15 minutes and is replaced by a revocable device
            credential. Your IronDesk password is never stored in the companion.
          </li>
        </ol>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/auth" search={{ redirect: "/connections" }}>
            Sign in and open Connections
          </Link>
        </Button>
      </section>

      <section>
        <h2>Choose, preview and sync</h2>
        <ol className="mt-2 space-y-1.5 [&_li]:ml-5 [&_li]:list-decimal">
          <li>Select only the record types you want IronDesk to read.</li>
          <li>Select Grant read access and approve those types in Health Connect.</li>
          <li>
            Choose 7, 30, 90 or 365 days. Historical access is optional and is needed only when
            reading beyond the provider&apos;s normal recent-data window.
          </li>
          <li>Select Preview data and review the per-type counts and totals.</li>
          <li>Select Sync now. Nothing is uploaded in a background job.</li>
          <li>
            Return to Connections and refresh the linked-device summary. Sleep, resting heart rate
            and HRV can fill missing Recovery fields; weight can fill a missing Body Metrics day. A
            value entered manually for that day is not overwritten.
          </li>
        </ol>
      </section>

      <section>
        <h2>Permissions and privacy</h2>
        <div className="mt-2 flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <p>
            The companion requests read-only access for the types you select. It has no Health
            Connect write permission, no advertising SDK and no background health-data upload. A
            failed user-initiated sync can remain in a small Android Keystore-encrypted retry queue
            until you select Sync now again.
          </p>
        </div>
        <p className="mt-3">
          Review the <Link to="/privacy">IronDesk Privacy Policy</Link> before testing.
        </p>
      </section>

      <section>
        <h2>Export instead of syncing</h2>
        <p className="mt-2">
          Export JSON file instead writes the previewed payload through Android&apos;s system file
          picker. Uploading that file to IronDesk retains import evidence, but the file archive is
          not the same as live companion sync and does not automatically populate Recovery or Body
          Metrics.
        </p>
      </section>

      <section>
        <h2>Stop access or remove the account</h2>
        <ul className="mt-2">
          <li>Revoke individual permissions in Android Health Connect settings.</li>
          <li>
            Use Unlink in IronDesk Health to remove the phone credential locally and remotely.
          </li>
          <li>Use Unlink under Connections &amp; Imports if the phone is unavailable.</li>
          <li>
            Permanently remove the IronDesk account and active account data through Settings. See
            the <Link to="/account-deletion">account-deletion guide</Link>.
          </li>
        </ul>
      </section>

      <section>
        <h2>Troubleshooting</h2>
        <ul className="mt-2">
          <li>
            Zero records: open the source tracker first, confirm it has written to Health Connect,
            and verify the selected type and date range.
          </li>
          <li>
            Expired or already-used code: generate a new code in IronDesk and enter it only once.
          </li>
          <li>
            Older records missing: grant historical access when supported, then preview again.
          </li>
          <li>
            Partial permissions: authorized types continue to work; select fewer types or approve
            the missing types in Health Connect.
          </li>
          <li>
            Pending retry: reconnect the phone, reopen IronDesk Health and select Sync now. There is
            no automatic background retry.
          </li>
        </ul>
      </section>

      <section>
        <h2>Apple Health is separate</h2>
        <p className="mt-2">
          Health Connect is Android-only. This companion cannot read Apple Health on an iPhone.
          IronDesk does not currently accept Apple&apos;s standard export.xml file and does not have
          a direct HealthKit connection. A supported CSV or JSON export can be reviewed through the
          generic file importer, but do not send private health records through an untrusted
          converter. Direct Apple Health sync requires a separate native iOS companion.
        </p>
      </section>
    </LegalPageShell>
  );
}
