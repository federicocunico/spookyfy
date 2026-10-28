/** Aggiornamento dell'app disponibile (Service Worker nuovo in attesa). */
export const pwa = $state<{ update: (() => void) | null }>({ update: null });

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const { registerSW } = await import('virtual:pwa-register');
  const updateSW = registerSW({
    onNeedRefresh() {
      pwa.update = () => void updateSW(true);
    },
    onRegisteredSW(_url, registration) {
      // Controllo periodico degli aggiornamenti mentre l'app resta aperta a lungo.
      if (registration) setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
}
