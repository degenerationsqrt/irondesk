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
import {
  applyMapping,
  compatibleSavedImportMapping,
  guessMapping,
  mappingIsUsable,
} from "@/lib/imports/mapping";
import {
  UploadError,
  assertAllowedFormat,
  needsFieldMappingReview,
  parseUpload,
  validateUpload,
} from "@/lib/imports/parse";
import { importRecordTypeLabel, importRecordValueLabel } from "@/lib/imports/presentation";
import { importedSourceLabel } from "@/lib/imports/provenance";
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
  SUPPORTED_EXTENSIONS,
} from "@/lib/imports/types";
import type { Units } from "@/lib/irondesk/units";
import { useUnits } from "@/lib/irondesk/use-units";
import { cn } from "@/lib/utils";

import { SectionCard } from "./primitives";

type Stage = "idle" | "parsing" | "mapping" | "preview" | "committing" | "done";

interface Loaded {
  name: string;
  size: number;
  bytes: Uint8Array;
  format: FileFormat;
}

const NO_SAVED_MAPPING = "__no_saved_mapping__";

const mappingNameFromFile = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .slice(0, 120) || "Custom import";

export function ImportCard({
  sourceType,
  title,
  eyebrow,
  blurb,
  formats,
  acceptedFormats,
  savedMappings,
}: {
  sourceType: SourceType;
  title: string;
  eyebrow: string;
  blurb: string;
  formats: string;
  acceptedFormats: readonly FileFormat[];
  savedMappings: readonly importRepo.SavedMapping[];
}) {
  const queryClient = useQueryClient();
  const units = useUnits();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>(DEFAULT_MAPPING);
  const [mappingCanReturn, setMappingCanReturn] = useState(false);
  const [mappingName, setMappingName] = useState("Custom import");
  const [selectedSavedMappingId, setSelectedSavedMappingId] = useState(NO_SAVED_MAPPING);
  const [activeSavedMappingId, setActiveSavedMappingId] = useState<string | null>(null);
  const [mappingNotice, setMappingNotice] = useState<string | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [job, setJob] = useState<importRepo.ImportJob | null>(null);
  const accept = useMemo(
    () => acceptedFormats.flatMap((format) => SUPPORTED_EXTENSIONS[format]).join(","),
    [acceptedFormats],
  );

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setLoaded(null);
    setResult(null);
    setJob(null);
    setMapping(DEFAULT_MAPPING);
    setMappingCanReturn(false);
    setMappingName("Custom import");
    setSelectedSavedMappingId(NO_SAVED_MAPPING);
    setActiveSavedMappingId(null);
    setMappingNotice(null);
    setSavingMapping(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setJob(null);
      setMappingName(mappingNameFromFile(file.name));
      setSelectedSavedMappingId(NO_SAVED_MAPPING);
      setActiveSavedMappingId(null);
      setMappingNotice(null);
      setStage("parsing");
      try {
        const format = validateUpload({ name: file.name, size: file.size, type: file.type });
        assertAllowedFormat(format, acceptedFormats, title);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = await parseUpload(file.name, bytes, undefined, acceptedFormats);
        setLoaded({ name: file.name, size: file.size, bytes, format });
        setResult(parsed);
        if (parsed.table) setMapping(guessMapping(parsed.table.headers));
        if (needsFieldMappingReview(parsed)) {
          setMappingCanReturn(false);
          setStage("mapping");
        } else {
          setStage("preview");
        }
      } catch (cause) {
        setError(
          cause instanceof UploadError || cause instanceof Error
            ? cause.message
            : "The file could not be read.",
        );
        setStage("idle");
      }
    },
    [acceptedFormats, title],
  );

  const previewWithMapping = useCallback(
    (nextMapping: ImportMapping): boolean => {
      if (!result?.table) return false;
      if (!mappingIsUsable(nextMapping)) {
        setError(
          nextMapping.recordKind === "activity"
            ? "Map the start time column before importing."
            : "Map the timestamp and value columns before importing.",
        );
        return false;
      }
      const mapped = applyMapping(result.table, nextMapping);
      if (!mapped.records.length) {
        setError("That mapping produced no usable rows. Check the columns and try again.");
        return false;
      }
      setError(null);
      setResult({
        ...result,
        recognized: true,
        records: mapped.records,
        issues: mapped.issues,
        skippedFields: mapped.skippedFields,
      });
      setMappingCanReturn(false);
      setStage("preview");
      return true;
    },
    [result],
  );

  const applyWizard = useCallback(() => {
    setMappingNotice(null);
    previewWithMapping(mapping);
  }, [mapping, previewWithMapping]);

  const reviewMapping = useCallback(() => {
    if (!result?.table) return;
    setError(null);
    setMappingNotice(null);
    setMappingCanReturn(true);
    setStage("mapping");
  }, [result]);

  const leaveMapping = useCallback(() => {
    if (!mappingCanReturn) {
      reset();
      return;
    }
    setError(null);
    setMappingCanReturn(false);
    setStage("preview");
  }, [mappingCanReturn, reset]);

  const compatibleSavedMappings = useMemo(() => {
    if (!loaded || !result?.table) return [];
    const headers = result.table.headers;
    return savedMappings.filter(
      (saved) => compatibleSavedImportMapping(saved, headers, loaded.format) !== null,
    );
  }, [loaded, result, savedMappings]);

  const sameFormatSavedMappingCount = useMemo(() => {
    if (!loaded || (loaded.format !== "csv" && loaded.format !== "json")) return 0;
    return savedMappings.filter((saved) => saved.fileFormat === loaded.format).length;
  }, [loaded, savedMappings]);

  const applySavedMapping = useCallback(() => {
    if (!loaded || !result?.table || selectedSavedMappingId === NO_SAVED_MAPPING) return;
    setMappingNotice(null);
    const saved = savedMappings.find((candidate) => candidate.id === selectedSavedMappingId);
    const resolved = saved
      ? compatibleSavedImportMapping(saved, result.table.headers, loaded.format)
      : null;
    if (!saved || !resolved) {
      setError(
        "That saved mapping was not applied because its file type or referenced headers no longer match this file.",
      );
      return;
    }

    setMapping(resolved);
    setActiveSavedMappingId(saved.id);
    setMappingName(saved.sourceLabel);
    if (previewWithMapping(resolved)) {
      setMappingNotice(
        `Applied "${saved.sourceLabel}" after verifying every referenced column is present.`,
      );
    }
  }, [loaded, previewWithMapping, result, savedMappings, selectedSavedMappingId]);

  const saveCurrentMapping = useCallback(async () => {
    if (!loaded || (loaded.format !== "csv" && loaded.format !== "json")) return;
    if (!mappingIsUsable(mapping)) {
      setError(
        mapping.recordKind === "activity"
          ? "Map the start time column before saving this layout."
          : "Map the timestamp and value columns before saving this layout.",
      );
      return;
    }

    const trimmedName = mappingName.trim();
    const duplicate = savedMappings.find(
      (saved) =>
        saved.id !== activeSavedMappingId &&
        saved.fileFormat === loaded.format &&
        saved.sourceLabel === trimmedName,
    );
    if (duplicate) {
      setError(
        `A saved ${loaded.format.toUpperCase()} mapping already uses "${trimmedName}". Apply that mapping first if you want to update it.`,
      );
      return;
    }

    setSavingMapping(true);
    setError(null);
    setMappingNotice(null);
    try {
      const savedId = await importRepo.saveMapping({
        ...(activeSavedMappingId ? { id: activeSavedMappingId } : {}),
        sourceLabel: trimmedName,
        fileFormat: loaded.format,
        recordKind: mapping.recordKind,
        mapping,
      });
      setActiveSavedMappingId(savedId);
      setMappingName(trimmedName);
      setMappingNotice(
        activeSavedMappingId
          ? `Updated saved mapping "${trimmedName}". It will only be offered for files with all referenced columns.`
          : `Saved mapping "${trimmedName}". It will only be offered for files with all referenced columns.`,
      );
      void queryClient.invalidateQueries({ queryKey: importKeys.mappings });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The mapping could not be saved.");
    } finally {
      setSavingMapping(false);
    }
  }, [activeSavedMappingId, loaded, mapping, mappingName, queryClient, savedMappings]);

  const commit = useCallback(async () => {
    if (!result || !loaded) return;
    setStage("committing");
    setError(null);
    try {
      const created = await importRepo.commitImport({
        sourceType: result.detectedSourceType ?? sourceType,
        fileName: loaded.name,
        fileFormat: loaded.format,
        fileSizeBytes: loaded.size,
        records: result.records,
        issues: result.issues,
      });
      setJob(created);
      setStage("done");
      for (const key of Object.values(importKeys))
        void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["irondesk"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import failed.");
      setStage("preview");
    }
  }, [loaded, queryClient, result, sourceType]);

  const errors = result?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = result?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const effectiveSourceType = result?.detectedSourceType ?? sourceType;
  const sourceEvidence = result?.records.find((record) => Object.keys(record.raw).length)?.raw;
  const sourceLabel = importedSourceLabel(effectiveSourceType, sourceEvidence);
  const archiveOnlyHealth = effectiveSourceType === "health_connect";

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
          <Button
            size="sm"
            variant="outline"
            className="mt-1"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
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
          {stage === "parsing"
            ? "Reading and normalizing the file…"
            : "Writing records to your account…"}
        </p>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {mappingNotice && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{mappingNotice}</span>
        </p>
      )}

      {result?.table && loaded && (stage === "mapping" || stage === "preview") && (
        <SavedMappingChooser
          compatibleMappings={compatibleSavedMappings}
          unavailableCount={sameFormatSavedMappingCount - compatibleSavedMappings.length}
          selectedId={selectedSavedMappingId}
          onSelectedIdChange={setSelectedSavedMappingId}
          onApply={applySavedMapping}
        />
      )}

      {stage === "mapping" && result?.table && (
        <MappingWizard
          headers={result.table.headers}
          mapping={mapping}
          onChange={setMapping}
          onCancel={leaveMapping}
          onApply={applyWizard}
          sample={result.table.rows.slice(0, 3)}
          canReturn={mappingCanReturn}
          mappingName={mappingName}
          onMappingNameChange={setMappingName}
          canSave={loaded?.format === "csv" || loaded?.format === "json"}
          isUpdatingSavedMapping={activeSavedMappingId !== null}
          savingMapping={savingMapping}
          onSave={saveCurrentMapping}
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
            <p className="mt-1 text-muted-foreground">Source: {sourceLabel}</p>
            {archiveOnlyHealth && (
              <p className="mt-1 font-medium text-warning">
                Evidence archive only — this file does not populate Recovery or Body Metrics. Use
                live companion sync for those views.
              </p>
            )}
            {result.archiveEntries && (
              <p className="mt-1 text-muted-foreground">
                Archive entries: {result.archiveEntries.length}
              </p>
            )}
            {result.skippedFields.length > 0 && (
              <p className="mt-1 font-medium text-warning">
                Not stored (skipped): {result.skippedFields.slice(0, 8).join(", ")}
                {result.skippedFields.length > 8 ? "…" : ""}
              </p>
            )}
            {result.notes.map((note) => (
              <p key={note} className="mt-1 text-muted-foreground">
                {note}
              </p>
            ))}
          </div>

          {result.records.length > 0 && <PreviewTable result={result} units={units} />}

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
                <p className="text-muted-foreground">
                  …and {errors.length + warnings.length - 50} more.
                </p>
              )}
            </div>
          )}

          {stage === "done" && job ? (
            <div className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="size-4" />
                  {sourceLabel}: {job.importedCount} new · {job.duplicateCount} already in your
                  account
                </p>
                {archiveOnlyHealth && (
                  <p className="mt-1 text-muted-foreground">
                    Health evidence archived; Recovery and Body Metrics were not changed.
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={reset}>
                Import another
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void commit()}
                disabled={stage === "committing" || !result.records.length}
              >
                {errors.length
                  ? `Import ${result.records.length} valid records`
                  : `Import ${result.records.length} records`}
              </Button>
              {result.table && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={reviewMapping}
                  disabled={stage === "committing"}
                >
                  Review / edit field mapping
                </Button>
              )}
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

function SavedMappingChooser({
  compatibleMappings,
  unavailableCount,
  selectedId,
  onSelectedIdChange,
  onApply,
}: {
  compatibleMappings: readonly importRepo.SavedMapping[];
  unavailableCount: number;
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  onApply: () => void;
}) {
  const selectedIsAvailable = compatibleMappings.some((mapping) => mapping.id === selectedId);
  const value = selectedIsAvailable ? selectedId : NO_SAVED_MAPPING;

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-3">
      <p className="text-xs font-semibold text-foreground">Use a saved column layout</p>
      {compatibleMappings.length ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Select value={value} onValueChange={onSelectedIdChange}>
            <SelectTrigger className="h-9 min-w-0 flex-1 text-sm" aria-label="Saved field mapping">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SAVED_MAPPING} disabled>
                Choose a compatible mapping
              </SelectItem>
              {compatibleMappings.map((mapping) => (
                <SelectItem key={mapping.id} value={mapping.id}>
                  {mapping.sourceLabel} ({mapping.recordKind})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!selectedIsAvailable} onClick={onApply}>
            Apply saved mapping
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          No saved mapping matches this file type and every referenced column.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Saved mappings are never applied automatically. IronDesk checks the file type and exact
        column names again when you press Apply.
      </p>
      {unavailableCount > 0 && (
        <p className="mt-1 text-xs text-warning">
          {unavailableCount} saved mapping{unavailableCount === 1 ? " is" : "s are"} hidden because
          {unavailableCount === 1 ? " its" : " their"} referenced columns are missing or the saved
          data is invalid.
        </p>
      )}
    </div>
  );
}

function PreviewTable({ result, units }: { result: ParseResult; units: Units }) {
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
              <td className="px-2 py-1.5">{importRecordTypeLabel(record)}</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {new Date(record.kind === "activity" ? record.startedAt : record.recordedAt)
                  .toISOString()
                  .slice(0, 16)
                  .replace("T", " ")}
              </td>
              <td className="px-2 py-1.5 tabular-nums">{importRecordValueLabel(record, units)}</td>
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
  canReturn,
  mappingName,
  onMappingNameChange,
  canSave,
  isUpdatingSavedMapping,
  savingMapping,
  onSave,
}: {
  headers: string[];
  mapping: ImportMapping;
  sample: string[][];
  onChange: (mapping: ImportMapping) => void;
  onApply: () => void;
  onCancel: () => void;
  canReturn: boolean;
  mappingName: string;
  onMappingNameChange: (name: string) => void;
  canSave: boolean;
  isUpdatingSavedMapping: boolean;
  savingMapping: boolean;
  onSave: () => void | Promise<void>;
}) {
  const targets = mapping.recordKind === "activity" ? ACTIVITY_TARGETS : METRIC_TARGETS;
  const unmappedHeaders = useMemo(() => {
    const mapped = new Set(Object.values(mapping.fields).filter(Boolean));
    return headers.filter((header) => !mapped.has(header));
  }, [headers, mapping.fields]);
  const previewOf = useMemo(() => {
    const index = new Map(headers.map((h, i) => [h, i]));
    return (header: string | undefined) => {
      if (!header) return "";
      const at = index.get(header);
      if (at == null) return "";
      return sample
        .map((row) => row[at])
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ");
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
        {canReturn
          ? "Review or change the mapping below, then preview the normalized records again."
          : "Review the proposed mapping below — nothing is imported until you confirm it."}
        {unmappedHeaders.length > 0 && (
          <span className="mt-1 block">
            Currently unmapped: {unmappedHeaders.slice(0, 8).join(", ")}
            {unmappedHeaders.length > 8 ? "…" : ""}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Record kind</Label>
          <Select
            value={mapping.recordKind}
            onValueChange={(value) => set({ recordKind: value as "activity" | "metric" })}
          >
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
              <Label className="text-xs">Unit for plain-number durations</Label>
              <Select
                value={mapping.durationUnit}
                onValueChange={(value) =>
                  set({ durationUnit: value as ImportMapping["durationUnit"] })
                }
              >
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
              <Label className="text-xs">Unit for distances without a suffix</Label>
              <Select
                value={mapping.distanceUnit}
                onValueChange={(value) =>
                  set({ distanceUnit: value as ImportMapping["distanceUnit"] })
                }
              >
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
              <Select
                value={mapping.fixedMetricType}
                onValueChange={(value) => set({ fixedMetricType: value as MetricType })}
              >
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
              <Select
                value={mapping.weightUnit}
                onValueChange={(value) => set({ weightUnit: value as ImportMapping["weightUnit"] })}
              >
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
              <Select
                value={mapping.fields[target] ?? NONE}
                onValueChange={(value) => setField(target, value)}
              >
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
                <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">
                  e.g. {previewOf(mapping.fields[target])}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {mapping.recordKind === "activity" && (
        <p className="text-xs text-muted-foreground">
          Clock durations such as 28:45 or 01:02:03 are detected automatically. A distance ending in
          mi, km or m overrides the unit selected above.
        </p>
      )}

      {canSave && (
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="mapping-name" className="text-xs">
                Mapping name
              </Label>
              <Input
                id="mapping-name"
                value={mappingName}
                maxLength={120}
                onChange={(event) => onMappingNameChange(event.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={savingMapping || !mappingIsUsable(mapping) || !mappingName.trim()}
              onClick={() => void onSave()}
            >
              {savingMapping ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isUpdatingSavedMapping ? (
                "Update saved mapping"
              ) : (
                "Save mapping"
              )}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            This stores the reviewed column layout only; it does not import the file. IronDesk will
            offer it again only when the file type and every referenced column still match.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onApply}>
          Preview normalized records
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {canReturn ? "Back to preview" : "Cancel import"}
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
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 text-sm"
      />
    </div>
  );
}

export function RollbackButton({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={() => setConfirming(true)}
      >
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
