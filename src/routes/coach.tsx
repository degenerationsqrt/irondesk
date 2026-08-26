import { createFileRoute } from "@tanstack/react-router";
import { Brain, CornerDownLeft, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { InsightCard, Pill, SectionCard } from "@/components/irondesk/primitives";
import { coachQuery } from "@/lib/irondesk/queries";
import { useModeData } from "@/lib/irondesk/use-data";

export const Route = createFileRoute("/coach")({
  head: () => ({
    meta: [
      { title: "AI Coach — IronDesk" },
      {
        name: "description",
        content:
          "Today's training recommendation, tomorrow's plan, load and risk notes, and suggested programming adjustments.",
      },
      { property: "og:title", content: "AI Coach — IronDesk" },
      { property: "og:description", content: "Deterministic coaching insights from your training data." },
    ],
  }),
  component: CoachPage,
});

function CoachPage() {
  const c = useModeData(coachQuery);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string[]>([]);

  const submit = (q: string) => {
    const value = q.trim();
    if (!value) return;
    setAsked((prev) => [...prev, value]);
    setQuestion("");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Coach"
        subtitle="Deterministic insights generated from your logged training. No live model connected yet."
        action={<Pill tone="warning">Mock insights</Pill>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <SectionCard title="Today's Recommendation" eyebrow="Priority">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
              <Sparkles className="size-4.5 text-primary" />
            </span>
            <div>
              <p className="text-base font-semibold">{c.today.headline}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.today.body}</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2 border-t border-border pt-3">
            {c.today.bullets.map((b) => (
              <li key={b} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {b}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Tomorrow's Plan" eyebrow="Projected session">
          <p className="text-base font-semibold">{c.tomorrow.headline}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.tomorrow.body}</p>
          <div className="mt-3 space-y-2">
            {c.tomorrow.blocks.map((b) => (
              <div
                key={b.name}
                className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5"
              >
                <p className="text-sm font-semibold">{b.name}</p>
                <p className="numeric mt-0.5 text-xs text-muted-foreground">{b.detail}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          title="Training Observations"
          eyebrow="Pattern detection"
          action={<TrendingUp className="size-4 text-primary" />}
          bodyClassName="space-y-2"
        >
          {c.observations.map((o, i) => (
            <InsightCard key={o.id} title={o.title} detail={o.detail} severity={o.severity} index={i + 1} />
          ))}
        </SectionCard>

        <SectionCard
          title="Risk & Load Notes"
          eyebrow="Injury / fatigue watch"
          action={<ShieldAlert className="size-4 text-danger" />}
          bodyClassName="space-y-2"
        >
          {c.riskNotes.map((o, i) => (
            <InsightCard key={o.id} title={o.title} detail={o.detail} severity={o.severity} index={i + 1} />
          ))}
        </SectionCard>

        <SectionCard
          title="Suggested Adjustments"
          eyebrow="Programming"
          action={<Brain className="size-4 text-success" />}
          bodyClassName="space-y-2"
        >
          {c.adjustments.map((o, i) => (
            <InsightCard key={o.id} title={o.title} detail={o.detail} severity={o.severity} index={i + 1} />
          ))}
        </SectionCard>
      </div>

      <SectionCard title="Ask the Coach" eyebrow="Natural language">
        <div className="flex flex-wrap gap-1.5">
          {c.starterQuestions.map((q) => (
            <button
              key={q}
              onClick={() => setQuestion(q)}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>

        {asked.length > 0 && (
          <div className="mt-4 space-y-2">
            {asked.map((q, i) => (
              <div key={`${q}-${i}`} className="rounded-lg border border-border bg-surface-2/60 p-3">
                <p className="text-sm font-semibold">{q}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Queued. Conversational coaching responses arrive when the AI backend is connected —
                  today's guidance above is generated from your logged sessions.
                </p>
              </div>
            ))}
          </div>
        )}

        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about load, progression, or recovery…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            disabled={!question.trim()}
          >
            Ask <CornerDownLeft className="size-3.5" />
          </button>
        </form>
      </SectionCard>
    </div>
  );
}
