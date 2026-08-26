/**
 * Connections & Imports workspace.
 *
 * The whole pipeline is client-side and read-only until the athlete presses
 * "Import": a file is validated (extension, MIME, size, magic bytes), parsed by
 * the standards parsers in `src/lib/imports`, normalized, previewed with its
 * warnings and skipped fields, and only then written to the account. Uploaded
 * bytes are never executed and never sent anywhere except the athlete's own
 * rows.
 */
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { applyMapping, guessMapping, mappingIsUsable } from "@/lib/imports/mapping";
import { UploadError, parseUpload, validateUpload } from "@/lib/imports/parse";
import { importKeys } from "@/lib/imports/queries";
import * as importRepo from "@/lib/imports/repo";
import {
  ACTIVITY_TARGETS,
  DEFAULT_MAPPING,
  METRIC_TARGETS,
  METRIC_TYPES,
  type FileFormat,
  type ImportMapping,
  type MetricType,
  type ParseResult,
  type SourceType,
} from "@/lib/imports/types";
import { cn } from "@/lib/utils";

import { SectionCard } from "./primitives";

const ACCEPT = ".fit,.tcx,.gpx,.csv,.json,.zip";

type Stage = "idle" | "parsing" | "mapping" | "preview" | "committing" | "done";

interface Loaded {
  name: string;
  size: number;
  bytes: Uint8Array;
  format: FileFormat;
}

export function ImportCard({
  sourceType,
  title,
  eyebrow,
  blurb,
  formats,
}: {
  sourceType: SourceType;
  title: string;
  eyebrow: string;
  blurb: string;
  formats: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>(DEFAULT_MAPPING);
  const [job, setJob] = useState<importRepo.ImportJob | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setLoaded(null);
    setResult(null);
    setJob(null);
    setMapping(DEFAULT_MAPPING);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setJob(null);
    setStage("parsing");
    try {
      const format = validateUpload({ name: file.name, size: file.size, type: file.type });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseUpload(file.name, bytes);
      setLoaded({ name: file.name, size: file.size, bytes, format });
      setResult(parsed);
      if (!parsed.recognized && parsed.table) {
        setMapping(guessMapping(parsed.table.headers));
        setStage("mapping");
      } else {
        setStage("preview");
      }
    } catch (cause) {
      setError(cause instanceof UploadError || cause instanceof Error ? cause.message : "The file could not be read.");
      setStage("idle");
    }
  }, []);

  const applyWizard = useCallback(() => {
    if (!result?.table) return;
    if (!mappingIsUsable(mapping)) {
      setError(
        mapping.recordKind === "activity"
          ? "Map the start time column before importing."
          : "Map the timestamp and value columns before importing.",
      );
      return;
    }
    const mapped = applyMapping(result.table, mapping);
    if (!mapped.records.length) {
      setError("That mapping produced no usable rows. Check the columns and try again.");
      return;
    }
    setError(null);
    setResult({ ...result, recognized: true, records: mapped.records, issues: mapped.issues, skippedFields: mapped.skippedFields });
    setStage("preview");
  }, [mapping, result]);

  const commit = useCallback(async () => {
    if (!result || !loaded) return;
    setStage("committing");
    setError(null);
    try {
      const created = await importRepo.commitImport({
        sourceType,
        fileName: loaded.name,
        fileFormat: loaded.format,
        fileSizeBytes: loaded.size,
        records: result.records,
        issues: result.issues,
      });
      setJob(created);
      setStage("done");
      for (const key of Object.values(importKeys)) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["irondesk"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import failed.");
      setStage("preview");
    }
  }, [loaded, queryClient, result, sourceType]);

  const saveMappingForLater = useCallback(async () => {
    if (!loaded) return;
    try {
      await importRepo.saveMapping({
        sourceLabel: loaded.name.replace(/\.[^.]+$/, ""),
        fileFormat: loaded.format,
        recordKind: mapping.recordKind,
        mapping,
      });
      void queryClient.invalidateQueries({ queryKey: importKeys.mappings });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The mapping could not be saved.");
    }
  }, [loaded, mapping, queryClient]);

  const errors = result?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = result?.issues.filter((issue) => issue.severity === "warning") ?? [];

  return (
    <SectionCard title={title} eyebrow={eyebrow}>
      <p className="text-sm text-muted-foreground">{blurb}</p>

      {stage === "idle" && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            "mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/8" : "border-border/70",
          )}
        >
          <FileUp className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Drop a file here</p>
          <p className="text-xs text-muted-foreground">{formats} · 25 MB max</p>
          <Button size="sm" variant="outline" className="mt-1" onClick={() => inputRef.current?.click()}>
            Choose file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      )}

      {(stage === "parsing" || stage === "committing") && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {stage === "parsing" ? "Reading and normalizing the file…" : "Writing records to your account…"}
        </p>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {stage === "mapping" && result?.table && (
        <MappingWizard
          headers={result.table.headers}
          mapping={mapping}
          onChange={setMapping}
          onCancel={reset}
          onApply={applyWizard}
          onSave={saveMappingForLater}
          sample={result.table.rows.slice(0, 3)}
        />
      )}

      {stage !== "idle" && stage !== "parsing" && result && loaded && stage !== "mapping" && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
            <p className="font-semibold text-foreground">
              {loaded.name} · {result.format.toUpperCase()}
            </p>
            <p className="mt-1 text-muted-foreground">
              {result.records.length} normalized record{result.records.length === 1 ? "" : "s"} ·{" "}
              {result.records.filter((r) => r.kind === "activity").length} activities ·{" "}
              {result.records.filter((r) => r.kind === "metric").length} health metrics
            </p>
            {result.archiveEntries && (
              <p className="mt-1 text-muted-foreground">Archive entries: {result.archiveEntries.length}</p>
            )}
            {result.skippedFields.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Not stored: {result.skippedFields.slice(0, 8).join(", ")}
                {result.skippedFields.length > 8 ? "…" : ""}
              </p>
            )}
            {result.notes.map((note) => (
              <p key={note} className="mt-1 text-muted-foreground">
                {note}
              </p>
            ))}
          </div>

          {result.records.length > 0 && <PreviewTable result={result} />}

          {(warnings.length > 0 || errors.length > 0) && (
            <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-border/70 p-3 text-xs">
              {errors.slice(0, 25).map((issue, i) => (
                <p key={`e${i}`} className="text-destructive">
                  {issue.row ? `Row ${issue.row}: ` : ""}
                  {issue.message}
                </p>
              ))}
              {warnings.slice(0, 25).map((issue, i) => (
                <p key={`w${i}`} className="text-warning">
                  {issue.row ? `Row ${issue.row}: ` : ""}
                  {issue.message}
                </p>
              ))}
              {errors.length + warnings.length > 50 && (
                <p className="text-muted-foreground">…and {errors.length + warnings.length - 50} more.</p>
              )}
            </div>
          )}

          {stage === "done" && job ? (
            <div className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" />
                Imported {job.importedCount} new · {job.duplicateCount} already in your account
              </p>
              <Button size="sm" variant="outline" onClick={reset}>
                Import another
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void commit()} disabled={stage === "committing" || !result.records.length}>
                {errors.length ? `Import ${result.records.length} valid records` : `Import ${result.records.length} records`}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={stage === "committing"}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function PreviewTable({ result }: { result: ParseResult }) {
  const rows = result.records.slice(0, 5);
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full min-w-[420px] text-left text-xs">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">Type</th>
            <th className="px-2 py-1.5 font-medium">When (UTC)</th>
            <th className="px-2 py-1.5 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((record, i) => (
            <tr key={i} className="border-t border-border/60">
              <td className="px-2 py-1.5">{record.kind === "activity" ? record.activityType : record.metricType}</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {new Date(record.kind === "activity" ? record.startedAt : record.recordedAt).toISOString().slice(0, 16).replace("T", " ")}
              </td>
              <td className="px-2 py-1.5 tabular-nums">
                {record.kind === "activity"
                  ? [
                      record.durationSec ? `${Math.round(record.durationSec / 60)} min` : null,
                      record.distanceM ? `${(record.distanceM / 1000).toFixed(2)} km` : null,
                      record.calories ? `${record.calories} kcal` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  : `${record.value} ${record.unit}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.records.length > rows.length && (
        <p className="border-t border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
          Showing 5 of {result.records.length} records.
        </p>
      )}
    </div>
  );
}

const LABELS: Record<string, string> = {
  externalId: "Source record id",
  startedAt: "Start time",
  recordedAt: "Timestamp",
  timezone: "Timezone / offset",
  activityType: "Activity type",
  name: "Name",
  duration: "Duration",
  distance: "Distance",
  calories: "Calories",
  avgHr: "Average HR",
  maxHr: "Max HR",
  steps: "Steps",
  notes: "Notes",
  metricType: "Metric type",
  value: "Value",
};

const NONE = "__none__";

function MappingWizard({
  headers,
  mapping,
  sample,
  onChange,
  onApply,
  onCancel,
  onSave,
}: {
  headers: string[];
  mapping: ImportMapping;
  sample: string[][];
  onChange: (mapping: ImportMapping) => void;
  onApply: () => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
}) {
  const targets = mapping.recordKind === "activity" ? ACTIVITY_TARGETS : METRIC_TARGETS;
  const previewOf = useMemo(() => {
    const index = new Map(headers.map((h, i) => [h, i]));
    return (header: string | undefined) => {
      if (!header) return "";
      const at = index.get(header);
      if (at == null) return "";
      return sample.map((row) => row[at]).filter(Boolean).slice(0, 2).join(" · ");
    };
  }, [headers, sample]);

  const set = (patch: Partial<ImportMapping>) => onChange({ ...mapping, ...patch });
  const setField = (target: string, header: string) => {
    const fields = { ...mapping.fields };
    if (header === NONE) delete fields[target];
    else fields[target] = header;
    onChange({ ...mapping, fields });
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
        These columns were not recognized. Assign them below — nothing is imported until you confirm.
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Record kind</Label>
          <Select value={mapping.recordKind} onValueChange={(value) => set({ recordKind: value as "activity" | "metric" })}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="activity">Activities / workouts</SelectItem>
              <SelectItem value="metric">Health metrics</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mapping.recordKind === "activity" ? (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Duration unit</Label>
              <Select value={mapping.durationUnit} onValueChange={(value) => set({ durationUnit: value as ImportMapping["durationUnit"] })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seconds">Seconds</SelectItem>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Distance unit</Label>
              <Select value={mapping.distanceUnit} onValueChange={(value) => set({ distanceUnit: value as ImportMapping["distanceUnit"] })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="m">Meters</SelectItem>
                  <SelectItem value="km">Kilometers</SelectItem>
                  <SelectItem value="mi">Miles</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Metric when no type column</Label>
              <Select value={mapping.fixedMetricType} onValueChange={(value) => set({ fixedMetricType: value as MetricType })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bodyweight unit in file</Label>
              <Select value={mapping.weightUnit} onValueChange={(value) => set({ weightUnit: value as ImportMapping["weightUnit"] })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">Kilograms</SelectItem>
                  <SelectItem value="lb">Pounds</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2">
        {targets.map((target) => (
          <div key={target} className="grid items-center gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Label className="text-xs text-muted-foreground">{LABELS[target] ?? target}</Label>
            <div>
              <Select value={mapping.fields[target] ?? NONE} onValueChange={(value) => setField(target, value)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Not mapped" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not mapped</SelectItem>
                  {headers.map((header) => (
                    <SelectItem key={header} value={header}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {previewOf(mapping.fields[target]) && (
                <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">e.g. {previewOf(mapping.fields[target])}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onApply}>
          Preview normalized records
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onSave()}>
          Save mapping for later
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Small controlled label/input pair reused by the export card. */
export function InlineField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="h-9 text-sm" />
    </div>
  );
}

export function RollbackButton({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
        <Trash2 className="mr-1 size-3.5" /> Roll back
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await importRepo.rollbackImport(jobId);
            onDone();
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Delete batch"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
