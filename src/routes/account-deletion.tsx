import { Link, createFileRoute } from "@tanstack/react-router";

import { LegalPageShell } from "@/components/irondesk/legal-page-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/account-deletion")({
  head: () => ({
    meta: [
      { title: "Delete an IronDesk Account" },
      {
        name: "description",
        content:
          "Public instructions for permanently deleting an IronDesk account and associated data.",
      },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: AccountDeletionPage,
});

function AccountDeletionPage() {
  return (
    <LegalPageShell
      title="Delete an IronDesk account"
      subtitle="You can permanently delete an account from the web without reinstalling the Android companion."
    >
      <section>
        <h2>Delete it yourself</h2>
        <ol className="mt-2 space-y-1.5 [&_li]:ml-5 [&_li]:list-decimal">
          <li>Sign in to the IronDesk web app.</li>
          <li>Open Settings and find Account → Danger zone.</li>
          <li>Select Delete my account.</li>
          <li>Enter your current password and type DELETE exactly.</li>
          <li>Confirm Delete permanently. You will be signed out when deletion succeeds.</li>
        </ol>
        <Button asChild className="mt-4">
          <Link to="/auth" search={{ redirect: "/settings" }}>
            Sign in to delete my account
          </Link>
        </Button>
      </section>

      <section>
        <h2>If you cannot sign in</h2>
        <p className="mt-2">
          Use Forgot password on the sign-in screen. After setting a new password, return to
          Settings and complete the deletion steps above. This protects accounts from deletion by
          someone who only has an old browser session.
        </p>
      </section>

      <section>
        <h2>What is deleted</h2>
        <p className="mt-2">
          Successful deletion removes the Supabase Auth account and active IronDesk records owned by
          it, including the athlete profile and preferences, personal exercises and workouts,
          sessions and sets, program enrollments and schedules, cardio, recovery, nutrition, body
          metrics, imported activities and metrics, saved import mappings, pairing codes, linked
          devices and device-sync receipts. The deletion cannot be undone.
        </p>
      </section>

      <section>
        <h2>What is not deleted</h2>
        <p className="mt-2">
          IronDesk cannot delete source records held by Android Health Connect, Samsung Health,
          Garmin or another tracker. Revoke IronDesk Health in Android&apos;s Health Connect
          settings and remove its local app data if you also want to clear its encrypted device
          credential and any pending retry batch. Infrastructure backups may age out under the
          hosting provider&apos;s disaster-recovery schedule and are not used as active accounts.
        </p>
      </section>

      <section>
        <h2>Privacy information</h2>
        <p className="mt-2">
          Read the <Link to="/privacy">IronDesk Privacy Policy</Link> for health-data use, storage
          and controls. Never post a password, access token, pairing code or health record in a
          public support request.
        </p>
      </section>
    </LegalPageShell>
  );
}
