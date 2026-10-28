import { request } from './api';

export interface AccessTokenDto {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Token di accesso personali del server on-premise (per il ponte da un'app in modalità client). */
export const tokensApi = {
  list: () => request<{ items: AccessTokenDto[] }>('GET', '/api/me/tokens'),
  create: (name: string) => request<AccessTokenDto & { token: string }>('POST', '/api/me/tokens', { name }),
  revoke: (id: string) => request<void>('DELETE', `/api/me/tokens/${encodeURIComponent(id)}`),
};

export type TokensApi = typeof tokensApi;
