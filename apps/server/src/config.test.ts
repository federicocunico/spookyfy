import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { ConfigError, DEFAULT_REGISTRATION_TOKEN, loadConfig } from './config.js';

describe('loadConfig', () => {
  test('applica i default in sviluppo', () => {
    const c = loadConfig({}, '/srv/spk');
    expect(c.port).toBe(8787);
    expect(c.host).toBe('127.0.0.1');
    expect(c.dataDir).toBe(path.resolve('/srv/spk', 'data'));
    expect(c.registrationToken).toBe(DEFAULT_REGISTRATION_TOKEN);
    expect(c.ingestConcurrency).toBeUndefined();
    expect(c.ingestNice).toBe(10);
    expect(c.cookieSecure).toBe(true);
  });

  test('una porta non valida blocca l’avvio con un messaggio chiaro', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
    try {
      loadConfig({ PORT: '70000', INGEST_CONCURRENCY: '0' });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain('Configurazione non valida');
      expect(msg).toContain('PORT');
      expect(msg).toContain('INGEST_CONCURRENCY');
    }
  });

  test('PUBLIC_ORIGIN è obbligatoria in produzione', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/PUBLIC_ORIGIN/);
  });

  test('PUBLIC_ORIGIN deve essere una sola origine', () => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: 'https://spk.example.com/app' })).toThrow(/PUBLIC_ORIGIN/);
    expect(loadConfig({ PUBLIC_ORIGIN: 'https://spk.example.com/' }).publicOrigin).toBe(
      'https://spk.example.com',
    );
  });

  test('REGISTRATION_TOKEN vuoto resta vuoto (registrazione disabilitata)', () => {
    expect(loadConfig({ REGISTRATION_TOKEN: '' }).registrationToken).toBe('');
    expect(loadConfig({ REGISTRATION_TOKEN: 'segreto' }).registrationToken).toBe('segreto');
  });

  test('le altre variabili vuote valgono come non impostate', () => {
    expect(loadConfig({ INGEST_CONCURRENCY: '', PORT: '' }).port).toBe(8787);
  });

  test('valori booleani', () => {
    expect(loadConfig({ TRUST_CF_HEADERS: 'false' }).trustCfHeaders).toBe(false);
    expect(() => loadConfig({ TRUST_CF_HEADERS: 'forse' })).toThrow(/TRUST_CF_HEADERS/);
  });
});
