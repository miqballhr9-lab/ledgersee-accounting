/**
 * The authentication endpoint.
 *
 * One catch-all route serves the whole sign-in protocol: sign-in, sign-out,
 * session, password reset, magic-link callbacks. This is the single place in the
 * app where an HTTP route is the right shape rather than a server action — an
 * email client or an identity provider redirects a BROWSER here, and a server
 * action cannot receive a redirect.
 *
 * Do not add logic to this file, and do not create sibling routes under
 * `src/app/api/` for your own data. Application data belongs in server actions.
 */
import { auth } from "@/lib/auth";

export const { GET, POST } = {
  GET: (request: Request) => auth.handler(request),
  POST: (request: Request) => auth.handler(request),
};
