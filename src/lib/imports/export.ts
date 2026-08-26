/**
 * Garmin-compatible exports.
 *
 * TCX is the format Garmin Connect's "Import Data" accepts for manually
 * uploaded activities, so completed IronDesk sessions are exported as
 * standards-compliant TCX v2. Strength work is exported as Sport="Other" with
 * one lap per session — that is what the schema actually supports; we do not
 * fabricate GPS tracks, and we do not claim per-rep fidelity Garmin cannot read.
 */

export interface ExportableSession {
  id: string;
  title: string;
  kind: string;
  startedAt: string;
  completedAt: string | null;
  durationSec: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  distanceM: number | null;
  notes: string | null;
}

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** TCX only defines a fixed sport vocabulary; everything non-cardio is "Other". */
const tcxSport = (kind: string): "Running" | "Biking" | "Other" => {
  const key = kind.toLowerCase();
  if (key.includes("run")) return "Running";
  if (key.includes("bike") || key.includes("cycl") || key.includes("ride")) return "Biking";
  return "Other";
};

const isoSecond = (value: string): string => {
  const ms = Date.parse(value);
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
};

const durationOf = (session: ExportableSession): number => {
  if (session.durationSec && session.durationSec > 0) return Math.round(session.durationSec);
  if (session.completedAt) {
    const seconds = (Date.parse(session.completedAt) - Date.parse(session.startedAt)) / 1000;
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  }
  return 0;
};

export function sessionsToTcx(sessions: ExportableSession[]): string {
  const activities = sessions
    .map((session) => {
      const start = isoSecond(session.startedAt);
      const hr = (tag: string, value: number | null) =>
        value && value > 0 ? `        <${tag} xsi:type="Heart_Rate_t"><Value>${Math.round(value)}</Value></${tag}>\n` : "";
      return [
        `    <Activity Sport="${tcxSport(session.kind)}">`,
        `      <Id>${start}</Id>`,
        `      <Lap StartTime="${start}">`,
        `        <TotalTimeSeconds>${durationOf(session)}</TotalTimeSeconds>`,
        `        <DistanceMeters>${Math.max(0, Math.round(session.distanceM ?? 0))}</DistanceMeters>`,
        session.calories != null ? `        <Calories>${Math.max(0, Math.round(session.calories))}</Calories>` : "        <Calories>0</Calories>",
        hr("AverageHeartRateBpm", session.avgHr).trimEnd(),
        hr("MaximumHeartRateBpm", session.maxHr).trimEnd(),
        "        <Intensity>Active</Intensity>",
        "        <TriggerMethod>Manual</TriggerMethod>",
        "      </Lap>",
        `      <Notes>${xmlEscape([session.title, session.notes].filter(Boolean).join(" — "))}</Notes>`,
        "      <Creator xsi:type=\"Device_t\">",
        "        <Name>IronDesk</Name>",
        "        <UnitId>0</UnitId>",
        "        <ProductID>0</ProductID>",
        "      </Creator>",
        "    </Activity>",
      ]
        .filter((line) => line.trim() !== "")
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Activities>
${activities}
  </Activities>
  <Author xsi:type="Application_t">
    <Name>IronDesk</Name>
    <Build><Version><VersionMajor>2</VersionMajor><VersionMinor>0</VersionMinor><BuildMajor>0</BuildMajor><BuildMinor>0</BuildMinor></Version></Build>
    <LangID>en</LangID>
    <PartNumber>000-00000-00</PartNumber>
  </Author>
</TrainingCenterDatabase>
`;
}

export function downloadFile(fileName: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
