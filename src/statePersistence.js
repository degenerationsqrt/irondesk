export function createBufferedStatePersistence({
  write,
  delayMs = 750,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
}) {
  if (typeof write !== "function") throw new TypeError("A state writer is required.");

  let timer = null;
  let pendingState = null;

  const commit = (state) => {
    try {
      return Promise.resolve(write(state));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const clearScheduledTimer = () => {
    if (timer == null) return;
    clearTimer(timer);
    timer = null;
  };

  const flush = () => {
    clearScheduledTimer();
    if (pendingState == null) return Promise.resolve();
    const state = pendingState;
    pendingState = null;
    return commit(state);
  };

  return {
    schedule(state) {
      pendingState = state;
      clearScheduledTimer();
      timer = setTimer(() => {
        timer = null;
        flush().catch(() => undefined);
      }, delayMs);
    },
    saveNow(state) {
      clearScheduledTimer();
      pendingState = null;
      return commit(state);
    },
    flush,
    hasPending() {
      return pendingState != null;
    },
  };
}
