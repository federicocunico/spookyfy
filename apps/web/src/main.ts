import '@fontsource-variable/inter';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { registerServiceWorker } from './lib/pwa.svelte';

mount(App, { target: document.getElementById('app')! });
void registerServiceWorker();
