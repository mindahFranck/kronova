import { useCallback, useEffect, useState } from 'react';

/* ---------------------------------------------------------------------------
 * Enregistrement du service worker
 * ------------------------------------------------------------------------- */

export interface RegisterServiceWorkerOptions {
  /**
   * Appelé lorsqu'une nouvelle version du service worker est installée et en attente.
   * `applyUpdate()` envoie `SKIP_WAITING` puis recharge la page une fois le nouveau SW actif.
   */
  onUpdateReady?: (applyUpdate: () => void, registration: ServiceWorkerRegistration) => void;
  /** Appelé une fois l'enregistrement réussi. */
  onRegistered?: (registration: ServiceWorkerRegistration) => void;
  /** Appelé en cas d'échec d'enregistrement. */
  onError?: (error: unknown) => void;
}

export function registerServiceWorker(options: RegisterServiceWorkerOptions = {}): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const { onUpdateReady, onRegistered, onError } = options;

  const notifyWaiting = (registration: ServiceWorkerRegistration, worker: ServiceWorker) => {
    const applyUpdate = () => {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
    onUpdateReady?.(applyUpdate, registration);
  };

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      onRegistered?.(registration);

      // Une mise à jour déjà en attente (onglet précédent, etc.)
      if (registration.waiting && navigator.serviceWorker.controller) {
        notifyWaiting(registration, registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // "installed" + contrôleur existant => nouvelle version (et non première installation)
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            notifyWaiting(registration, installing);
          }
        });
      });

      // Vérifie périodiquement les mises à jour (toutes les heures) et au retour sur l'onglet.
      window.setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => {});
      });
    } catch (error) {
      onError?.(error);
      console.warn('[PWA] Échec de l’enregistrement du service worker :', error);
    }
  };

  if (document.readyState === 'complete') {
    void register();
  } else {
    window.addEventListener('load', () => void register(), { once: true });
  }
}

/* ---------------------------------------------------------------------------
 * Invite d'installation
 * ------------------------------------------------------------------------- */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export interface InstallPromptState {
  canInstall: boolean;
  install: () => Promise<boolean>;
  isStandalone: boolean;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(mql?.matches) || iosStandalone;
}

// L'événement peut survenir avant le montage du composant : on le capture au niveau du module.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function useInstallPrompt(): InstallPromptState {
  const [canInstall, setCanInstall] = useState<boolean>(() => deferredPrompt !== null);
  const [isStandalone, setIsStandalone] = useState<boolean>(detectStandalone);

  useEffect(() => {
    const sync = () => {
      setCanInstall(deferredPrompt !== null);
      setIsStandalone(detectStandalone());
    };
    listeners.add(sync);
    sync();

    const mql = window.matchMedia?.('(display-mode: standalone)');
    mql?.addEventListener?.('change', sync);
    return () => {
      listeners.delete(sync);
      mql?.removeEventListener?.('change', sync);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const promptEvent = deferredPrompt;
    if (!promptEvent) return false;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      return outcome === 'accepted';
    } catch {
      return false;
    } finally {
      // Un événement beforeinstallprompt ne peut être utilisé qu'une seule fois.
      deferredPrompt = null;
      notify();
    }
  }, []);

  return { canInstall: canInstall && !isStandalone, install, isStandalone };
}
