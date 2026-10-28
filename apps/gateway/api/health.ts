import { deps } from '../lib/deps.js';
import { handleHealth } from '../lib/handlers.js';
import { handle } from '../lib/http.js';

export function GET(): Promise<Response> {
  return handle(async () => handleHealth(deps()));
}
