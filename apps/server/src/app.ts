import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { Feature, type HealthDto, createAlbumLookup, fetchCoverImage } from '@spookyfy/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerBridgeCors } from './auth/bridge.js';
import { registerAuth } from './auth/plugin.js';
import { SessionService } from './auth/sessions.js';
import { registerTokenRoutes } from './auth/token-routes.js';
import { AccessTokenService } from './auth/tokens.js';
import { UserService } from './auth/users.js';
import { type Clock, systemClock } from './clock.js';
import type { Config } from './config.js';
import type { DatabaseHandle } from './db/client.js';
import { type HardwareProfile, detectHardware, resolveIngestConcurrency } from './hardware.js';
import { registerErrorHandling } from './http-errors.js';
import { IngestEvents } from './ingest/events.js';
import { registerIngestRoutes } from './ingest/routes.js';
import { IngestService } from './ingest/service.js';
import { type YtDlp, createYtDlp } from './ingest/ytdlp.js';
import { AlbumService } from './library/albums.js';
import { registerCatalogRoutes } from './library/catalog-routes.js';
import { GenreService } from './library/genres.js';
import { FavoriteService, PlayService, PlaylistService } from './library/personal.js';
import { type LibraryServices, registerLibraryRoutes } from './library/routes.js';
import { TrackService } from './library/tracks.js';
import { CoverLookupService, SettingsService } from './lookup/service.js';
import { registerMediaRoutes } from './media/routes.js';
import { type SilenceAnalyzer, createSilenceAnalyzer } from './media/silence.js';
import { TagWriter } from './media/tag-writer.js';
import { registerWeb } from './web.js';

export interface BuildAppOptions {
  config: Config;
  database: DatabaseHandle;
  clock?: Clock;
  hardware?: HardwareProfile;
  logger?: FastifyServerOptions['logger'];
  /** Sostituisce yt-dlp (nei test, con l'eseguibile finto). */
  ytdlp?: YtDlp;
  /** Auto-trim: analizzatore del silenzio (null = disattivato; predefinito: ffmpeg). */
  analyzeSilence?: SilenceAnalyzer | null;
  /** fetch per i database musicali e le immagini delle copertine (nei test, simulato). */
  lookupFetch?: typeof fetch;
  /** false per non avviare il worker di ingestione su ready(). */
  startIngestWorker?: boolean;
}

export interface AppContext {
  config: Config;
  database: DatabaseHandle;
  clock: Clock;
  hardware: HardwareProfile;
  ingestConcurrency: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    ingest: IngestService;
    catalog: { albums: AlbumService; lookup: CoverLookupService; tagWriter: TagWriter };
  }
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config, database } = opts;
  const hardware = opts.hardware ?? detectHardware();
  const ctx: AppContext = {
    config,
    database,
    clock: opts.clock ?? systemClock,
    hardware,
    ingestConcurrency: resolveIngestConcurrency(config.ingestConcurrency, hardware),
  };

  const app = Fastify({
    logger: opts.logger ?? {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    // Dietro Cloudflare Tunnel l'IP reale arriva in CF-Connecting-IP (vedi clientIp()).
    trustProxy: false,
    bodyLimit: 1024 * 1024,
  });
  app.decorate('ctx', ctx);

  registerErrorHandling(app);
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket, { options: { maxPayload: 4096 } });
  // reply.sendFile() per audio e copertine, con root su MEDIA_DIR; non registra rotte.
  await app.register(fastifyStatic, { root: config.mediaDir, serve: false });

  const users = new UserService(database.db, ctx.clock);
  const sessions = new SessionService(database.db, ctx.clock);
  const tokens = new AccessTokenService(database.db, ctx.clock);
  // CORS del ponte prima dell'autenticazione: gli header servono anche sugli errori.
  registerBridgeCors(app, config.bridgeAllowedOrigins);
  registerAuth(app, ctx, { users, sessions, tokens });
  registerTokenRoutes(app, tokens);

  const tagWriter = new TagWriter(database.sqlite, config.mediaDir, app.log);
  const albums = new AlbumService({
    sqlite: database.sqlite,
    mediaDir: config.mediaDir,
    clock: ctx.clock,
    onTracksChanged: (ids) => tagWriter.enqueue(ids),
    // La ricerca online è creata più sotto: il riferimento passa dal decoratore.
    onAlbumCreated: () => app.catalog?.lookup.kick(),
  });
  const library: LibraryServices = {
    tracks: new TrackService(database.sqlite, config.mediaDir, albums),
    favorites: new FavoriteService(database.sqlite, ctx.clock),
    playlists: new PlaylistService(database.sqlite, ctx.clock),
    plays: new PlayService(database.sqlite, ctx.clock),
  };
  registerLibraryRoutes(app, library);
  registerMediaRoutes(app, database.sqlite, config.mediaDir);

  const genres = new GenreService(database.sqlite, albums, (ids) => tagWriter.enqueue(ids));
  const settings = new SettingsService(database.sqlite, config.coverLookupForcedOff);
  const lookupFetch = opts.lookupFetch ?? fetch;
  const userAgent = `Spookyfy/${config.version} ( https://github.com/federicocunico/spookyfy )`;
  const coverLookup = new CoverLookupService({
    albums,
    genres,
    settings,
    lookup: createAlbumLookup({ fetch: lookupFetch, userAgent, ...config.lookup }),
    fetchImage: (url, signal) =>
      fetchCoverImage(url, {
        fetch: lookupFetch,
        hosts: config.lookup.imageHosts?.length ? config.lookup.imageHosts : undefined,
        userAgent,
        signal,
      }),
    log: app.log,
  });
  // Brani importati prima degli album: raggruppati una sola volta.
  const grouped = albums.groupExistingTracks();
  if (grouped) app.log.info({ tracks: grouped }, 'brani esistenti raggruppati in album');
  registerCatalogRoutes(app, { albums, genres, tracks: library.tracks, settings, lookup: coverLookup });
  app.decorate('catalog', { albums, lookup: coverLookup, tagWriter });

  const events = new IngestEvents();
  const ingest = new IngestService({
    sqlite: database.sqlite,
    mediaDir: config.mediaDir,
    clock: ctx.clock,
    ytdlp:
      opts.ytdlp ??
      createYtDlp(
        config.ytdlpNodeScript
          ? { command: process.execPath, argsPrefix: [config.ytdlpNodeScript], nice: config.ingestNice }
          : { command: config.ytdlpPath, ffmpegPath: config.ffmpegPath, nice: config.ingestNice },
      ),
    events,
    tracks: library.tracks,
    albums,
    concurrency: ctx.ingestConcurrency,
    log: app.log,
    analyzeSilence:
      opts.analyzeSilence !== undefined
        ? (opts.analyzeSilence ?? undefined)
        : createSilenceAnalyzer({ ffmpegPath: config.ffmpegPath, nice: config.ingestNice }),
  });
  app.decorate('ingest', ingest);
  registerIngestRoutes(app, ingest, events, config.publicOrigin);
  if (opts.startIngestWorker !== false) app.addHook('onReady', () => ingest.start());
  app.addHook('onReady', async () => coverLookup.start());
  app.addHook('onClose', () => ingest.stop());
  app.addHook('onClose', async () => {
    await coverLookup.stop();
    await tagWriter.idle();
  });

  app.get(
    '/api/health',
    { config: { public: true } },
    async (): Promise<HealthDto> => ({
      status: 'ok',
      mode: 'onpremise',
      version: config.version,
      features: [
        Feature.ServerLibrary,
        Feature.RemoteSearch,
        Feature.ServerIngest,
        ...(config.registrationToken ? [Feature.Registration] : []),
        ...(config.bridgeAllowedOrigins.length > 0 ? [Feature.BridgeTokens] : []),
        ...(config.coverLookupForcedOff ? [] : [Feature.CoverLookup]),
      ],
    }),
  );

  await registerWeb(app, config.webDistDir);
  return app;
}
