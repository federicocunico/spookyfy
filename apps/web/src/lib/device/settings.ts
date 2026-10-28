import type { Db, DeviceSettings } from '../offline/db';

export const DEFAULT_SETTINGS: DeviceSettings = { bridge: null, lastBackupAt: null, addedSinceBackup: 0 };

export async function getSettings(db: Db): Promise<DeviceSettings> {
  return { ...DEFAULT_SETTINGS, ...(await db.get('settings', 'device')) };
}

export async function patchSettings(db: Db, patch: Partial<DeviceSettings>): Promise<DeviceSettings> {
  const next = { ...(await getSettings(db)), ...patch };
  await db.put('settings', next, 'device');
  return next;
}
