import { deps } from '../../lib/deps.js';
import { handle, routeParam } from '../../lib/http.js';
import { handleLookup } from '../../lib/lookup.js';

// Ricerca di album e copertine (`albums`) e proxy delle immagini dei candidati (`image`).
export function GET(req: Request): Promise<Response> {
  return handle(() => handleLookup(req, routeParam(req, 'action'), deps()));
}
