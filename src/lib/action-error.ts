/**
 * Errors a server action throws on purpose, with a message meant for the person
 * using the app ("That payment is greater than the remaining balance").
 *
 * In production Next.js replaces a thrown error's message with a generic notice
 * before it reaches the browser, but it passes an error's own `digest` through
 * untouched. ActionError puts its message in the digest so the client can show
 * it; unexpected errors (a database failure, a bug) keep Next's generic notice
 * and never leak details.
 */
const DIGEST_PREFIX = "ACTION_ERROR:";
const MASKED_MESSAGE = "An error occurred in the Server Components render";

export class ActionError extends Error {
  digest: string;

  constructor(message: string) {
    super(message);
    this.name = "ActionError";
    this.digest = `${DIGEST_PREFIX}${message}`;
  }
}

/** The message to show for an error caught from a server action, in development and production alike. */
export function readableError(error: Error): string {
  const digest = (error as Error & { digest?: unknown }).digest;
  if (typeof digest === "string" && digest.startsWith(DIGEST_PREFIX)) return digest.slice(DIGEST_PREFIX.length);
  if (error.message.startsWith(MASKED_MESSAGE)) return "Something went wrong on our side. Please try again.";
  return error.message;
}
