import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const servers = Array.isArray(base.webServer) ? base.webServer : [base.webServer!];

/** Built PWA and real backend routes, with explicit synthetic Spotify in both modes. */
export default defineConfig({
  ...base,
  projects: base.projects!.map((project) => ({ ...project, testMatch: /[\\/]spotify\.spec\.ts$/ })),
  webServer: servers.map((server, index) => ({
    ...server,
    env:
      index === 0
        ? server.env
        : {
            ...server.env,
            NODE_ENV: 'test',
            SPOTIFY_FAKE: 'true',
            SPOTIFY_HYBRID_PLAYBACK_ENABLED: 'true',
          },
  })),
});
