/**
 * The app's database connection. Server-side only.
 *
 * Two connections, and the difference matters:
 *
 *   `db`       — pooled. What every query in the app uses. This app runs
 *                serverless: each server action is a fresh, short-lived
 *                connection, and an unpooled Postgres endpoint runs out of
 *                connection slots under even light traffic.
 *   `directUrl`— unpooled. Only for schema changes (`npm run db:push`), which
 *                need a session-level connection the transaction pooler can't
 *                give them.
 *
 * Never import this file from a client component. It reads a live credential;
 * bundling it for the browser is a leak, and Next.js will fail the build if you
 * try — treat that error as the guardrail working, not as something to route
 * around with a `"use client"` shim.
 */
// node-postgres over the pooled endpoint — NOT the HTTP driver.
//
// The HTTP driver is a little faster for one-shot queries and cannot run a
// transaction at all: it throws "No transactions support" on the first one. A
// generated app writing an order and its line items, or moving a balance between
// two rows, would compile cleanly and then crash for a real user. This app runs on
// a long-lived Node server, so a module-level pool keeps connections warm anyway
// and the HTTP driver's advantage is largely theoretical here. Do not swap it.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let instance: Database | null = null;

/**
 * The app's connection string.
 *
 * `IMAGINE_DATABASE_URL` is checked FIRST and is not cosmetic. The environment
 * this app is built in already defines `DATABASE_URL` for a local database of its
 * own, and Next.js gives the process environment precedence over `.env` — so
 * reading `DATABASE_URL` alone silently connects the app to the wrong database
 * while migrations go to the right one. That failure looks like a working app
 * until the data is gone.
 *
 * `DATABASE_URL` remains the fallback so the app still runs anywhere you deploy
 * it with the conventional variable set.
 */
function connectionUrl(): string | undefined {
  return process.env.IMAGINE_DATABASE_URL ?? process.env.DATABASE_URL;
}

function connect(): Database {
  if (instance) return instance;
  const connectionString = connectionUrl();
  if (!connectionString) {
    throw new Error(
      "No database connection is configured. This app's database is provided " +
        "automatically — if you are seeing this, the environment did not load.",
    );
  }
  instance = drizzle(
    new Pool({
      connectionString,
      // Small on purpose. The connection string points at a transaction pooler
      // that is already multiplexing for us, and a large per-instance pool just
      // holds server-side slots idle.
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    }),
    { schema },
  );
  return instance;
}

/**
 * Query interface for the whole app. Import this, not the driver.
 *
 * Connects LAZILY, on the first query. That indirection is load-bearing rather
 * than clever: `next build` imports every module, so a connection created at
 * module scope would fail the production build of any app that doesn't use a
 * database — including one that only has the sign-in route sitting unused in the
 * template. Deferring to first use means the error surfaces where it is
 * actionable (a request that genuinely needed data) instead of breaking builds
 * that never touch it.
 */
export const db = new Proxy({} as Database, {
  get: (_target, property, receiver) => Reflect.get(connect(), property, receiver),
  has: (_target, property) => Reflect.has(connect(), property),
});

/** True when this app has a database. Cheap, no connection made — use it to
 *  branch at build time or to render an honest "not configured" state. */
export const hasDatabase = (): boolean => Boolean(connectionUrl());

/** Unpooled URL for schema operations. Falls back to the pooled one so a missing
 *  direct URL degrades to "migrations work, just less reliably" rather than
 *  "migrations crash". */
export const directUrl = (): string =>
  process.env.IMAGINE_DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL_UNPOOLED ??
  connectionUrl() ??
  "";

export { schema };
