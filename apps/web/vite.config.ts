/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API_TARGET = process.env.SPOOKYFY_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [
    svelte(),
    svelteTesting(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Il nuovo Service Worker resta in attesa: l'app propone "Aggiorna" (vedi UpdatePrompt).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Spookyfy',
        short_name: 'Spookyfy',
        description: 'Il tuo player musicale self-hosted',
        lang: 'it',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#121212',
        theme_color: '#121212',
        categories: ['music', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
