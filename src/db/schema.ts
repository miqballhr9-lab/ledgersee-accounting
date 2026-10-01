/**
 * The app's database schema.
 *
 * ADD YOUR TABLES AT THE BOTTOM. The four tables above the marker belong to the
 * authentication library: it reads and writes them itself, their column names are
 * part of its contract, and renaming or "tidying" one breaks sign-in in a way that
 * type-checks perfectly and only fails at runtime. Leave them exactly as they are.
 *
 * Anything that belongs to a person gets a `userId` column referencing
 * `user.id` with `onDelete: "cascade"`. That single choice is what makes "delete
 * my account" actually delete someone's data instead of orphaning it — which is
 * a legal obligation, not a nicety.
 *
 * After any change here run `npm run db:push` once to apply it.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Authentication (managed by the auth library — do not modify) ─────────────

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_email_idx").on(t.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_token_idx").on(t.token),
    index("session_user_idx").on(t.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

// ─── Your tables go below this line ───────────────────────────────────────────
//
// Example — delete it once you have real tables of your own:
//
// export const note = pgTable(
//   "note",
//   {
//     id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
//     userId: text("user_id")
//       .notNull()
//       .references(() => user.id, { onDelete: "cascade" }),
//     title: text("title").notNull(),
//     body: text("body").notNull().default(""),
//     createdAt: timestamp("created_at").notNull().defaultNow(),
//   },
//   // Index the column you filter by. Every query for a user's own rows filters
//   // on user_id, and without this each one is a full table scan.
//   (t) => [index("note_user_idx").on(t.userId)],
// );
