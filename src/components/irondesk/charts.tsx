import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { HrSample, ZoneSplit } from "@/lib/irondesk/types";
import { zoneMeta } from "./primitives";

const axis = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const tooltipStyle = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border-strong)",
  borderRadius: "0.5rem",
  fontSize: "0.75rem",
  color: "var(--popover-foreground)",
} as const;

function Grid() {
  return <CartesianGrid stroke="var(--border)" vertical={false} />;
}

/** Heart-rate trace with the four zone thresholds drawn in. */
export function HrChart({ data }: { data: HrSample[] }) {
  const thresholds: { label: string; hr: number; color: string }[] = [
    { label: "Light", hr: 100, color: "var(--zone-light)" },
    { label: "Moderate", hr: 130, color: "var(--zone-moderate)" },
    { label: "Vigorous", hr: 155, color: "var(--zone-vigorous)" },
    { label: "Peak", hr: 172, color: "var(--zone-peak)" },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Grid />
        <XAxis dataKey="t" {...axis} interval={6} />
        <YAxis domain={[60, 190]} {...axis} width={44} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} bpm`, "HR"]} />
        {thresholds.map((t) => (
          <ReferenceLine
            key={t.label}
            y={t.hr}
            stroke={t.color}
            strokeDasharray="4 4"
            strokeOpacity={0.55}
            label={{
              value: t.label,
              position: "right",
              fill: t.color,
              fontSize: 9,
            }}
          />
        ))}
        <Area
          type="monotone"
          dataKey="hr"
          stroke="var(--primary)"
          strokeWidth={2}
          fill="url(#hrFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MacroDonut({
  data,
}: {
  data: { name: string; value: number; color: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" innerRadius="58%" outerRadius="86%" strokeWidth={0}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} g`, n]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ZoneMinutesChart({ zones }: { zones: ZoneSplit[] }) {
  const data = zones.map((z) => ({ name: zoneMeta[z.zone].name, minutes: z.minutes, zone: z.zone }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: -14, right: 12 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" {...axis} width={80} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} min`, "Time"]} />
        <Bar dataKey="minutes" radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((d) => (
            <Cell key={d.zone} fill={zoneMeta[d.zone as ZoneSplit["zone"]].color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({
  data,
  xKey,
  yKey,
  color = "var(--primary)",
  unit,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color?: string;
  unit?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <Grid />
        <XAxis dataKey={xKey} {...axis} />
        <YAxis {...axis} width={48} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}${unit ? ` ${unit}` : ""}`, yKey]} />
        <Bar dataKey={yKey} fill={color} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MultiLineChart({
  data,
  xKey,
  series,
  unit,
  domain,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; label: string; color: string }[];
  unit?: string;
  domain?: [number | "auto", number | "auto"];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <Grid />
        <XAxis dataKey={xKey} {...axis} />
        <YAxis {...axis} width={48} domain={domain ?? ["auto", "auto"]} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v}${unit ? ` ${unit}` : ""}`, n]} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ backgroundColor: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
