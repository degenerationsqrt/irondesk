import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";


import { PageHeader } from "@/components/irondesk/app-shell";
import { ActiveProgramPanel, ProgramCatalog, useEnrollment } from "@/components/irondesk/program-panels";
import { SectionCard } from "@/components/irondesk/primitives";
import { useAuth } from "@/lib/auth/auth-provider";

export const Route = createFileRoute("/program")({
  head: () => ({
    meta: [
      { title: "My Program — IronDesk" },
      {
        name: "description",
        content:
          "Assign an ordered training program, see the next prescribed workout, and pause, resume or skip without losing your place.",
      },
      { property: "og:title", content: "My Program — IronDesk" },
      {
        property: "og:description",
        content: "Assigned program delivery with ordered workouts, acknowledgment gates and progress tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProgramPage,
});

function ProgramPage() {
  const { mode } = useAuth();
  const live = mode === "live";
  const { data: enrollment, isLoading } = useEnrollment();

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Program"
        subtitle="Assigned training delivered in order — one active assignment, one clear next workout."
      />

      {!live && (
        <SectionCard title="Demo mode" eyebrow="Read-only">
          <p className="text-sm text-muted-foreground">
            Assigned programs are tied to a real account. Sign in to take one of the six IronDesk programs, track cycle
            progress and start assigned workouts in order.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li>• One active assignment at a time, always with a clear next workout.</li>
            <li>• Gated programs require an explicit acknowledgment before assignment.</li>
            <li>• Pause, resume or skip a workout without losing your place in the cycle.</li>
          </ul>
          <Button asChild className="mt-4">
            <Link to="/auth">Sign in to assign a program</Link>
          </Button>
        </SectionCard>
      )}


      {live && isLoading && (
        <SectionCard title="My Program" eyebrow="Loading">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your assignment…
          </p>
        </SectionCard>
      )}

      {enrollment && <ActiveProgramPanel enrollment={enrollment} />}

      <ProgramCatalog enrollment={enrollment ?? null} />
    </div>
  );
}
