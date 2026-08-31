import { createFileRoute } from "@tanstack/react-router";

import { LegalPageShell } from "@/components/irondesk/legal-page-shell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — IronDesk" },
      {
        name: "description",
        content: "How IronDesk handles account, training, import and Android Health Connect data.",
      },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      subtitle="Effective August 30, 2026 · Applies to the IronDesk web app and IronDesk Health Android companion."
    >
      <section>
        <h2>What IronDesk processes</h2>
        <ul className="mt-2">
          <li>Account information such as your email address and display name.</li>
          <li>
            Athlete settings such as units, timezone, goals, available equipment and notification
            preferences.
          </li>
          <li>
            Training information you enter or import, including workouts, cardio, body metrics,
            recovery, nutrition and exercise preferences.
          </li>
          <li>
            Import provenance and device-link records needed to deduplicate files, show where a
            record came from and securely pair an approved companion device.
          </li>
          <li>
            Limited technical and security information processed by the hosting and authentication
            services to operate, protect and diagnose the application.
          </li>
        </ul>
      </section>

      <section>
        <h2>Android Health Connect data</h2>
        <p className="mt-2">
          IronDesk Health requests read-only access only to the record types you approve. Depending
          on your selection, those types can include exercise sessions, steps, sleep, resting heart
          rate, heart-rate variability, weight, active calories and distance. The companion never
          writes to Health Connect.
        </p>
        <p className="mt-2">
          Reading, previewing and syncing are initiated by you. IronDesk Health does not read health
          data in a background job. A failed user-initiated sync may be kept in a small encrypted
          retry queue on the phone and retried the next time you select Sync now.
        </p>
      </section>

      <section>
        <h2>How the data is used</h2>
        <p className="mt-2">
          IronDesk uses this information to provide the features you request: workout history,
          training progression, recovery and readiness views, body-metric trends, nutrition views,
          imports and device synchronization. Health Connect sleep, resting heart rate and HRV can
          fill missing recovery fields, while weight can fill a missing body-metric entry. A manual
          entry for the same day is not overwritten by a derived Health Connect value.
        </p>
        <p className="mt-2">
          IronDesk Health has no advertising SDK and does not use Health Connect data for
          advertising, marketing, data-broker sales or unrelated analytics. Health data is not sold.
        </p>
      </section>

      <section>
        <h2>Storage and security</h2>
        <p className="mt-2">
          Account and training data are stored in IronDesk&apos;s hosted Supabase project. Browser
          access is protected by Supabase authentication and row-level ownership rules. The Android
          companion never stores your IronDesk password. It exchanges a short-lived, single-use
          pairing code for a device credential protected with Android Keystore encryption.
        </p>
      </section>

      <section>
        <h2>Your controls</h2>
        <ul className="mt-2">
          <li>Edit profile and privacy preferences in IronDesk Settings.</li>
          <li>Review and roll back supported file-import batches in Connections &amp; Imports.</li>
          <li>Unlink companion devices in Connections &amp; Imports.</li>
          <li>Revoke IronDesk Health permissions in Android&apos;s Health Connect settings.</li>
          <li>
            Permanently delete your account and active IronDesk records through Settings. See the{" "}
            <a href="/account-deletion">account-deletion guide</a>.
          </li>
        </ul>
        <p className="mt-2">
          Deleting IronDesk does not delete source records held by Health Connect, Samsung Health or
          another tracker. Those records remain under the controls of those applications.
        </p>
      </section>

      <section>
        <h2>Retention and service providers</h2>
        <p className="mt-2">
          Active account records remain until you delete them or delete the account. Short-lived
          pairing codes expire automatically. Encrypted retry data on Android is removed after a
          successful sync, unlink or app-data removal. Infrastructure providers may retain limited
          security logs and disaster-recovery backups under their own retention schedules; those
          copies are not active IronDesk accounts.
        </p>
        <p className="mt-2">
          IronDesk relies on service providers needed to operate the product, including Supabase for
          authentication and database services and the application hosting platform for delivery and
          operational security. These providers process data on IronDesk&apos;s behalf rather than
          for independent advertising use.
        </p>
      </section>

      <section>
        <h2>Children and policy changes</h2>
        <p className="mt-2">
          IronDesk is not directed to children under 13. Material policy changes will be reflected
          on this page with a new effective date.
        </p>
      </section>

      <section>
        <h2>Privacy questions</h2>
        <p className="mt-2">
          Open a request through the{" "}
          <a href="https://github.com/degenerationsqrt/irondesk/issues">IronDesk issue tracker</a>.
          Do not include passwords, pairing codes, access tokens or private health records in a
          public issue.
        </p>
      </section>
    </LegalPageShell>
  );
}
