import type { Config } from "drizzle-kit";

/**
 * Schema tooling config (`npm run db:push`).
 *
 * Points at the UNPOOLED connection deliberately: schema changes take advisory
 * locks and run in a session, neither of which survives a transaction pooler.
 * Pushing through the pooled URL appears to work and then hangs or half-applies.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Imagine-prefixed first: the build environment defines its own
    // DATABASE_URL, and picking that one would apply the schema to a throwaway
    // local database while the app reads the real one (or vice versa).
    url:
      process.env.IMAGINE_DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.IMAGINE_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "",
  },
  // Never touch anything the app did not define. The database is shared with the
  // auth library's own bookkeeping; an unfiltered push is how a "harmless" schema
  // sync drops a table it did not recognise.
  strict: true,
  verbose: true,
} satisfies Config;
