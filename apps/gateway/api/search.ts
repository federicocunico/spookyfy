import { deps } from '../lib/deps.js';
import { handleSearch } from '../lib/handlers.js';
import { handle } from '../lib/http.js';

export function GET(req: Request): Promise<Response> {
  return handle(() => handleSearch(req, deps()));
}
