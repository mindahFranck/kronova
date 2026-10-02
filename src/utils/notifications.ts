import { TimerPhase } from '../types';

export type BrowserNotificationStatus = NotificationPermission | 'unsupported';

export function getNotificationPermission(): BrowserNotificationStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }

  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export function triggerPhaseNotification(
  completedPhase: TimerPhase,
  nextPhase: TimerPhase,
  taskTitle: string | null
): { title: string; body: string; sentNative: boolean } {
  let title = '';
  let body = '';

  if (completedPhase === TimerPhase.FOCUS) {
    title = 'Cycle de concentration terminé';
    const nextLabel =
      nextPhase === TimerPhase.LONG_BREAK ? 'une pause longue' : 'une pause courte';
    body = taskTitle
      ? `Bravo sur « ${taskTitle} ». Il est temps de prendre ${nextLabel}.`
      : `Session terminée. Il est temps de prendre ${nextLabel}.`;
  } else if (completedPhase === TimerPhase.SHORT_BREAK) {
    title = 'Pause courte terminée';
    body = taskTitle
      ? `Prêt à reprendre la concentration sur « ${taskTitle} » ?`
      : 'Prêt à démarrer un nouveau cycle de concentration ?';
  } else {
    title = 'Pause longue terminée';
    body = 'Nouveau cycle complet prêt à démarrer.';
  }

  let sentNative = false;
  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    try {
      const notification = new Notification(title, {
        body,
        tag: 'kronova-phase',
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      sentNative = true;
    } catch {
      // Fallback handled by in-app notification banner
    }
  }

  return { title, body, sentNative };
}
