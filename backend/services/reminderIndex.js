import pool from '../db.js';

/**
 * Refreshes derived reminders index table for a user from planner_events.
 * Called after every mutation to planner_events (atomic or whole-blob).
 */
export async function refreshReminderIndex(userId, conn = null) {
  if (!userId) return;
  const executor = conn || pool;

  try {
    // Check if reminders table exists before running refresh (Phase 3 migration)
    const [tableCheck] = await executor.query(
      `SELECT COUNT(1) as cnt FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = 'reminders'`
    );

    if (Number(tableCheck[0]?.cnt || 0) === 0) {
      return;
    }

    // In Phase 3, this will rebuild user reminders using luxon and user timezone
  } catch (err) {
    console.warn(`[ReminderIndex] Refresh warning for user ${userId}:`, err.message);
  }
}

export default {
  refreshReminderIndex,
};
