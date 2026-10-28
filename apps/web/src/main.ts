import '@fontsource-variable/inter';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { detectMode } from './lib/mode';
import { registerServiceWorker } from './lib/pwa.svelte';
import { createServices, setServices } from './lib/services.svelte';

// La modalità (on-premise o client) decide quale backend usare: va nota prima del rendering.
void (async () => {
  const { mode, health } = await detectMode();
  setServices(createServices({ mode, health }));
  mount(App, { target: document.getElementById('app')! });
  void registerServiceWorker();
})();
