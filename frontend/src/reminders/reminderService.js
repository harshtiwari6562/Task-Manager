/**
 * Web Notification & In-App Reminders Manager
 * Enables desktop notifications while the app is open.
 */

let activeTimers = [];

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission !== 'denied') {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }
  return false;
}

export function showNotification(title, options = {}) {
  if (typeof window === 'undefined') return;

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        badge: '/favicon.ico',
        icon: '/favicon.ico',
        ...options,
      });
      return;
    } catch (e) {
      console.warn('Native notification failed, falling back:', e);
    }
  }

  // Fallback in-app alert or console
  console.log(`[Reminder Alert] ${title} - ${options.body || ''}`);
}

/**
 * Checks scheduled planner events and fires notifications when due.
 */
export function checkDueReminders(plannerEvents = []) {
  if (!Array.isArray(plannerEvents)) return;

  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (const evt of plannerEvents) {
    if (!evt.enableNotification || evt.done) continue;
    if (evt.dateKey && evt.dateKey !== currentDateKey) continue;

    // Parse time e.g. "09:00 AM", "02:30 PM", "14:00"
    const parsed = parseTimeString(evt.time);
    if (!parsed) continue;

    if (parsed.hours === currentHours && parsed.minutes === currentMinutes) {
      const reminderKey = `notified-${evt.id}-${currentDateKey}-${currentHours}-${currentMinutes}`;
      if (!sessionStorage.getItem(reminderKey)) {
        sessionStorage.setItem(reminderKey, 'true');
        showNotification(`Reminder: ${evt.title}`, {
          body: `Scheduled for ${evt.time} (${evt.category || 'Task'})`,
        });
      }
    }
  }
}

function parseTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const modifier = match[3]?.toUpperCase();

  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;

  return { hours, minutes };
}

let intervalId = null;

export function startReminderWatcher(getEvents) {
  if (intervalId) clearInterval(intervalId);
  // Check every 30 seconds
  intervalId = setInterval(() => {
    const events = typeof getEvents === 'function' ? getEvents() : [];
    checkDueReminders(events);
  }, 30000);

  return () => {
    if (intervalId) clearInterval(intervalId);
  };
}
