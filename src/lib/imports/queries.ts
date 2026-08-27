import { queryOptions } from "@tanstack/react-query";

import * as importRepo from "./repo";

/** Import reads exist in live mode only — demo mode never writes to a real account. */
export const importKeys = {
  jobs: ["irondesk", "live", "import-jobs"] as const,
  totals: ["irondesk", "live", "import-totals"] as const,
  mappings: ["irondesk", "live", "import-mappings"] as const,
  activities: ["irondesk", "live", "imported-activities"] as const,
  metrics: ["irondesk", "live", "imported-metrics"] as const,
  devices: ["irondesk", "live", "linked-devices"] as const,
};

export const importJobsQuery = queryOptions({
  queryKey: importKeys.jobs,
  queryFn: () => importRepo.listImportJobs(),
});

export const importTotalsQuery = queryOptions({
  queryKey: importKeys.totals,
  queryFn: () => importRepo.getImportTotals(),
});

export const savedMappingsQuery = queryOptions({
  queryKey: importKeys.mappings,
  queryFn: () => importRepo.listSavedMappings(),
});

export const importedActivitiesQuery = queryOptions({
  queryKey: importKeys.activities,
  queryFn: () => importRepo.listImportedActivities(),
});

export const importedMetricsQuery = queryOptions({
  queryKey: importKeys.metrics,
  queryFn: () => importRepo.listHealthMetrics(),
});

export const linkedDevicesQuery = queryOptions({
  queryKey: ["irondesk", "live", "linked-devices"] as const,
  queryFn: () => importRepo.listLinkedDevices(),
});
