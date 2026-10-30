import { deps } from '../../lib/deps.js';
import { handle, routeParam } from '../../lib/http.js';
import { handleSpotify } from '../../lib/spotify.js';
function run(req: Request) {
  return handle(() => handleSpotify(req, routeParam(req, 'action'), deps()));
}
export { run as GET, run as POST, run as PUT, run as PATCH, run as DELETE };
