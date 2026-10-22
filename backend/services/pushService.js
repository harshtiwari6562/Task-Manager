// Push Service for Sync & Reminders (Phase 6 full implementation stub)
const pendingSyncDebounces = new Map(); // userId -> { timer, keys: Set }

/**
 * Triggers a debounced sync push to the user's other devices.
 * Debounces calls within 2 seconds per user and collapses key sets.
 */
export function notifySync(userId, changedKeys = []) {
  if (!userId) return;
  const uid = String(userId);

  const existing = pendingSyncDebounces.get(uid) || {
    timer: null,
    keys: new Set(),
  };

  (Array.isArray(changedKeys) ? changedKeys : [changedKeys]).forEach((k) => {
    if (k) existing.keys.add(k);
  });

  if (existing.timer) {
    clearTimeout(existing.timer);
  }

  existing.timer = setTimeout(async () => {
    pendingSyncDebounces.delete(uid);
    try {
      // In Phase 6, FCM data-only push will be dispatched here.
    } catch (err) {
      console.warn(`[PushService] Sync push error for user ${uid}:`, err.message);
    }
  }, 2000);

  pendingSyncDebounces.set(uid, existing);
}

export default {
  notifySync,
};
