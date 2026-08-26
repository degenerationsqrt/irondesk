import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Grade, ZoneKey } from "@/lib/irondesk/types";

/* ------------------------------------------------------------------ */
/* SectionCard                                                         */
/* ------------------------------------------------------------------ */

export function SectionCard({
  title,
  eyebrow,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: string | undefined;
  eyebrow?: string | undefined;
  action?: ReactNode | undefined;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className={cn("panel flex flex-col overflow-hidden", className)}>
      {(title || eyebrow || action) && (
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {eyebrow && <p className="label-eyebrow">{eyebrow}</p>}
            {title && (
              <h2 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("flex-1 px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard / MetricTile                                               */
/* ------------------------------------------------------------------ */

const toneRing = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

export type Tone = keyof typeof toneRing;

export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaPositive,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: string;
  deltaPositive?: boolean;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("panel px-4 py-3.5", className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <p className="label-eyebrow truncate">{label}</p>
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cn("numeric text-3xl leading-none font-semibold", toneRing[tone])}>
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-muted-foreground">{unit}</span>}
      </div>
      {(delta || hint) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {delta && (
            <span
              className={cn(
                "numeric rounded-md px-1.5 py-0.5 text-xs font-semibold",
                deltaPositive
                  ? "bg-success/12 text-success"
                  : "bg-danger/12 text-danger",
              )}
            >
              {delta}
            </span>
          )}
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  unit,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface-2/60 px-3 py-2.5",
        className,
      )}
    >
      <p className="label-eyebrow truncate text-[0.625rem]">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={cn("numeric text-xl leading-none font-semibold", toneRing[tone])}>
          {value}
        </span>
        {unit && <span className="text-[0.6875rem] text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                             */
/* ------------------------------------------------------------------ */

export function gradeTone(grade: Grade): Tone {
  if (grade.startsWith("A")) return "success";
  if (grade.startsWith("B")) return "primary";
  if (grade.startsWith("C")) return "warning";
  return "danger";
}

const badgeStyles = cva(
  "inline-flex items-center justify-center gap-1 rounded-md border font-semibold text-display tracking-wide",
  {
    variants: {
      tone: {
        default: "border-border-strong bg-surface-3 text-foreground",
        primary: "border-primary/35 bg-primary/12 text-primary",
        success: "border-success/35 bg-success/12 text-success",
        warning: "border-warning/35 bg-warning/12 text-warning",
        danger: "border-danger/40 bg-danger/12 text-danger",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[0.6875rem]",
        md: "px-2 py-1 text-sm",
        lg: "px-3 py-1.5 text-lg",
      },
    },
    defaultVariants: { tone: "default", size: "md" },
  },
);

export function GradeBadge({
  grade,
  size = "md",
  className,
}: {
  grade: Grade;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return <span className={cn(badgeStyles({ tone: gradeTone(grade), size }), className)}>{grade}</span>;
}

export function Pill({
  children,
  tone = "default",
  size = "sm",
  className,
}: {
  children: ReactNode;
} & VariantProps<typeof badgeStyles> & { className?: string }) {
  return <span className={cn(badgeStyles({ tone, size }), className)}>{children}</span>;
}

export function ScoreBadge({
  score,
  label,
  max = 100,
  tone = "primary",
  size = 128,
}: {
  score: number;
  label?: string;
  max?: number;
  tone?: Tone;
  size?: number;
}) {
  const pct = Math.max(0, Math.min(1, score / max));
  const stroke = 7;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const strokeColor = {
    default: "var(--foreground)",
    primary: "var(--primary)",
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
  }[tone];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("numeric text-3xl leading-none font-bold", toneRing[tone])}>
          {score}
        </span>
        {label && <span className="label-eyebrow mt-1 text-[0.5625rem]">{label}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bars                                                               */
/* ------------------------------------------------------------------ */

const barTone = {
  default: "bg-foreground/70",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export function ProgressBar({
  value,
  max = 100,
  tone = "primary",
  label,
  right,
  size = "md",
  className,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  label?: string;
  right?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("min-w-0", className)}>
      {(label || right) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label && <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>}
          {right && <span className="numeric shrink-0 text-xs font-semibold">{right}</span>}
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-surface-3",
          size === "sm" ? "h-1.5" : "h-2.5",
        )}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", barTone[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export const zoneMeta: Record<ZoneKey, { name: string; color: string; bg: string; text: string }> = {
  light: { name: "Light", color: "var(--zone-light)", bg: "bg-zone-light", text: "text-zone-light" },
  moderate: {
    name: "Moderate",
    color: "var(--zone-moderate)",
    bg: "bg-zone-moderate",
    text: "text-zone-moderate",
  },
  vigorous: {
    name: "Vigorous",
    color: "var(--zone-vigorous)",
    bg: "bg-zone-vigorous",
    text: "text-zone-vigorous",
  },
  peak: { name: "Peak", color: "var(--zone-peak)", bg: "bg-zone-peak", text: "text-zone-peak" },
};

/** Single stacked bar showing the distribution across HR zones. */
export function ZoneBar({
  zones,
  height = "h-2",
  className,
}: {
  zones: { zone: ZoneKey; percent: number }[];
  height?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-surface-3", height, className)}>
      {zones.map((z) => (
        <div
          key={z.zone}
          className={cn(zoneMeta[z.zone].bg, "h-full first:rounded-l-full last:rounded-r-full")}
          style={{ width: `${z.percent}%` }}
          title={`${zoneMeta[z.zone].name} ${z.percent}%`}
        />
      ))}
    </div>
  );
}

export function ZoneLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {(Object.keys(zoneMeta) as ZoneKey[]).map((z) => (
        <li key={z} className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <span className={cn("size-2 rounded-full", zoneMeta[z].bg)} />
          {zoneMeta[z].name}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Insight / Empty                                                    */
/* ------------------------------------------------------------------ */

const severityTone: Record<string, Tone> = {
  info: "primary",
  good: "success",
  warn: "warning",
  risk: "danger",
};

export function InsightCard({
  title,
  detail,
  severity = "info",
  index,
  className,
}: {
  title: string;
  detail: string;
  severity?: "info" | "good" | "warn" | "risk";
  index?: number;
  className?: string;
}) {
  const tone = severityTone[severity];
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border border-border bg-surface-2/50 p-3",
        className,
      )}
    >
      <span
        className={cn(
          "numeric mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold",
          tone === "success" && "bg-success/15 text-success",
          tone === "warning" && "bg-warning/15 text-warning",
          tone === "danger" && "bg-danger/15 text-danger",
          tone === "primary" && "bg-primary/15 text-primary",
        )}
      >
        {index ?? "•"}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-2/30 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="text-base font-semibold">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingPanel({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("panel space-y-3 p-4", className)}>
      <div className="h-3 w-24 animate-pulse rounded bg-surface-3" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-surface-3/70" />
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  eyebrow,
  action,
  height = 240,
  children,
  className,
  footer,
}: {
  title: string;
  eyebrow?: string | undefined;
  action?: ReactNode | undefined;
  height?: number | undefined;
  children: ReactNode;
  className?: string | undefined;
  footer?: ReactNode | undefined;
}) {
  return (
    <SectionCard title={title} eyebrow={eyebrow} action={action} className={className}>
      <div style={{ height }} className="w-full">
        {children}
      </div>
      {footer && <div className="mt-3 border-t border-border pt-3">{footer}</div>}
    </SectionCard>
  );
}

export function DataRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border py-2 last:border-0",
        className,
      )}
    >
      <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
      <span className="numeric shrink-0 text-sm font-semibold">{value}</span>
    </div>
  );
}

export type IconProps = ComponentProps<"svg">;
