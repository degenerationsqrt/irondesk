const PROGRAM_WEEKS = 6;

function positiveInteger(value, fallback = 1) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeDayIndex(value, totalDays) {
  const total = Math.max(1, positiveInteger(totalDays));
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return 0;
  return ((number % total) + total) % total;
}

export function resolveWorkoutDayIndex(progress, dayIds, sessions = []) {
  const ids = Array.isArray(dayIds) ? dayIds.filter(Boolean) : [];
  if (!ids.length) return 0;

  const explicit = Number(progress?.dayIndex);
  if (Number.isInteger(explicit) && explicit >= 0 && explicit < ids.length) {
    return explicit;
  }

  const mostRecentProgramSession = (Array.isArray(sessions) ? sessions : [])
    .find(session => session?.source !== "garmin" && ids.includes(session?.dayId));
  if (!mostRecentProgramSession) return 0;
  const recordedDayIndex = Number(mostRecentProgramSession.programDayIndex);
  const completedDayIndex = Number.isInteger(recordedDayIndex)
    && recordedDayIndex >= 0
    && recordedDayIndex < ids.length
    ? recordedDayIndex
    : ids.indexOf(mostRecentProgramSession.dayId);
  return (completedDayIndex + 1) % ids.length;
}

export function selectWorkoutDay(progress, dayIndex, totalDays, updatedAt = Date.now()) {
  return {
    ...progress,
    blockNum: positiveInteger(progress?.blockNum),
    week: Math.min(PROGRAM_WEEKS, positiveInteger(progress?.week)),
    dayIndex: safeDayIndex(dayIndex, totalDays),
    updatedAt,
  };
}

export function advanceWorkoutProgress({
  progress,
  focusKeys,
  completedFocusKey,
  completedDayIndex,
  completedWeek,
  completedBlockNum,
  updatedAt = Date.now(),
}) {
  const keys = Array.isArray(focusKeys) && focusKeys.length ? focusKeys : [completedFocusKey];
  const fallbackIndex = safeDayIndex(progress?.dayIndex, keys.length);
  const recordedDayIndex = Number(completedDayIndex);
  const focusIndex = keys.indexOf(completedFocusKey);
  const currentIndex = Number.isInteger(recordedDayIndex)
    && recordedDayIndex >= 0
    && recordedDayIndex < keys.length
    ? recordedDayIndex
    : focusIndex >= 0
      ? focusIndex
      : fallbackIndex;
  const wrapsWeek = currentIndex >= keys.length - 1;
  let week = Math.min(PROGRAM_WEEKS, positiveInteger(completedWeek, positiveInteger(progress?.week)));
  let blockNum = positiveInteger(completedBlockNum, positiveInteger(progress?.blockNum));

  if (wrapsWeek) {
    if (week >= PROGRAM_WEEKS) {
      blockNum += 1;
      week = 1;
    } else {
      week += 1;
    }
  }

  return {
    ...progress,
    blockNum,
    week,
    dayIndex: wrapsWeek ? 0 : currentIndex + 1,
    updatedAt,
  };
}

export function newerWorkoutProgress(localProgress, cloudProgress) {
  if (!localProgress) return cloudProgress;
  if (!cloudProgress) return localProgress;

  const localUpdatedAt = Number(localProgress.updatedAt) || 0;
  const cloudUpdatedAt = Number(cloudProgress.updatedAt) || 0;
  if (localUpdatedAt !== cloudUpdatedAt) {
    return localUpdatedAt > cloudUpdatedAt ? localProgress : cloudProgress;
  }

  const localHasDay = Number.isInteger(Number(localProgress.dayIndex));
  const cloudHasDay = Number.isInteger(Number(cloudProgress.dayIndex));
  if (localHasDay !== cloudHasDay) return localHasDay ? localProgress : cloudProgress;
  return cloudProgress;
}
