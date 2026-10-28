import { deps } from '../../lib/deps.js';
import { handleCover } from '../../lib/handlers.js';
import { handle, routeParam } from '../../lib/http.js';

export function GET(req: Request): Promise<Response> {
  return handle(() => handleCover(req, routeParam(req, 'id'), deps()));
}
