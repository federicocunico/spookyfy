import { deps } from '../../lib/deps.js';
import { handleMeta } from '../../lib/handlers.js';
import { handle, routeParam } from '../../lib/http.js';

export function GET(req: Request): Promise<Response> {
  return handle(() => handleMeta(req, routeParam(req, 'id'), deps()));
}
