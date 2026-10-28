import { deps } from '../../lib/deps.js';
import { handleAudio } from '../../lib/handlers.js';
import { handle, routeParam } from '../../lib/http.js';

export function GET(req: Request): Promise<Response> {
  return handle(() => handleAudio(req, routeParam(req, 'id'), deps()));
}
