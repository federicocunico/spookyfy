import { handleAuth } from '../../lib/auth.js';
import { deps } from '../../lib/deps.js';
import { handle, routeParam } from '../../lib/http.js';

// login, logout, me e register in un'unica funzione.
const run = (req: Request) => handle(() => handleAuth(req, routeParam(req, 'action'), deps()));
export const GET = run;
export const POST = run;
