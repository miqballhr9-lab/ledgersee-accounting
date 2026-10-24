/**
 * Sign-in, server side. This is the source of truth for who a request is.
 *
 * Email + password, plus a magic link, both backed by this app's own database.
 * There is nothing to configure and no key to obtain — the database and the
 * email sender are already provided.
 *
 * IMPORTANT, and the thing most easily got wrong: there is no row-level security
 * here doing authorisation for you. `auth.api.getSession` tells you WHO is
 * asking; deciding what they may see is your code's job, in every server action
 * that touches user data. A query without a user filter returns everybody's rows
 * and will type-check happily. Use `requireUser()` below and filter by its id.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, haveIBeenPwned, magicLink, twoFactor } from "better-auth/plugins";
import { and, desc, eq, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { sendEmail, sendEmailOrThrow } from "@/lib/email";
import { describeAuthError } from "@/lib/errors";
import { ActionError } from "@/lib/action-error";
import { currentScheduledUser } from "@/lib/run-as-user";
import { currentRoleOverride } from "@/lib/role-override";
import { canAccess, canReadKind, canWriteKind, isRole, type Role } from "@/lib/permissions";
import { billingAccess, type BillingAccess } from "@/lib/billing";
import { featureLabels, featuresForKind, planFor } from "@/lib/plans";
import { isVerifiedPlatformAdmin } from "@/lib/platform";
import { readViewAs, VIEW_AS_COOKIE } from "@/lib/view-as";

/** One row per sign-in, kept under the person's own id; the app's screens never list this kind. */
export const SIGN_IN_LOG_KIND = "sign-in-log";
const SIGN_INS_KEPT = 30;

/**
 * Notes a new sign-in (device, address, time) for "Recent sign-ins" on the
 * profile page. Never blocks signing in: a failure here is only logged. Two-step
 * sign-in briefly opens a session before the code is checked, so a repeat from
 * the same device within two minutes is one sign-in, not two.
 */
async function recordSignIn(session: { userId: string; ipAddress?: string | null; userAgent?: string | null }) {
  try {
    const [last] = await db.select().from(schema.bookkeepingRecord)
      .where(and(eq(schema.bookkeepingRecord.userId, session.userId), eq(schema.bookkeepingRecord.kind, SIGN_IN_LOG_KIND)))
      .orderBy(desc(schema.bookkeepingRecord.createdAt)).limit(1);
    const userAgent = (session.userAgent ?? "").slice(0, 300);
    // Vercel names the visitor's country (two letters) on every request; elsewhere it's simply blank.
    const country = await headers().then((list) => (list.get("x-vercel-ip-country") ?? "").slice(0, 2).toUpperCase()).catch(() => "");
    if (last && last.data.userAgent === userAgent && Date.now() - last.createdAt.getTime() < 2 * 60 * 1000) return;
    await db.insert(schema.bookkeepingRecord).values({ userId: session.userId, kind: SIGN_IN_LOG_KIND, data: { at: new Date().toISOString(), ipAddress: session.ipAddress ?? "", userAgent, country } });
    await db.execute(sql`delete from ${schema.bookkeepingRecord} where ${schema.bookkeepingRecord.userId} = ${session.userId} and ${schema.bookkeepingRecord.kind} = ${SIGN_IN_LOG_KIND} and ${schema.bookkeepingRecord.id} not in (select ${schema.bookkeepingRecord.id} from ${schema.bookkeepingRecord} where ${schema.bookkeepingRecord.userId} = ${session.userId} and ${schema.bookkeepingRecord.kind} = ${SIGN_IN_LOG_KIND} order by ${schema.bookkeepingRecord.createdAt} desc limit ${SIGN_INS_KEPT})`);
  } catch (error) {
    console.error("[auth] couldn't note the sign-in", error);
  }
}

/**
 * Which origin this app answers on — resolved PER REQUEST, not pinned at build.
 *
 * This app has no fixed address: it is served from a preview URL while being
 * built and from a published domain afterwards, and both are live at once. A
 * single hard-coded value breaks whichever one it is not — most visibly in email,
 * where a confirmation link generated against the wrong origin sends the user
 * somewhere that cannot verify them.
 *
 * `allowedHosts` makes Better Auth derive the origin from the incoming request's
 * Host and validate it against this list, so a sign-up on the published domain
 * emails a published-domain link, and a sign-up on the preview emails a preview
 * link. It also becomes the trusted-origin list, so sign-in POSTs are accepted
 * from both — without it that list comes out EMPTY and every sign-in is rejected
 * as cross-origin.
 *
 * The list is deliberately tight. Wildcards are only used on a domain we own; the
 * ephemeral preview host is pinned exactly and refreshed each turn. A wildcard
 * broad enough to match any preview host would let a request with a forged Host
 * header mint verification links pointing at somebody else's origin — i.e. hand
 * them the token.
 */
const authHosts = (process.env.IMAGINE_AUTH_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

/**
 * On Vercel the same deployment answers on its production domain, its branch URL
 * and its own deployment URL. Vercel injects each exact hostname, so they are
 * pinned here rather than matched with a broad wildcard.
 */
const vercelHosts = [
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  process.env.VERCEL_BRANCH_URL,
  process.env.VERCEL_URL,
].filter((h): h is string => Boolean(h));

const allowedHosts = authHosts.length > 0 ? authHosts : vercelHosts;

const staticBaseURL =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined);

/**
 * Make the session cookie usable when this app is shown inside an iframe.
 *
 * The app is embedded cross-site (the preview, and often when published-and-
 * embedded). In that context a `SameSite=Lax` cookie is NOT sent on the app's own
 * requests — the browser compares against the TOP-LEVEL site, which is someone
 * else's — so the session silently reads as signed-out inside the frame. Cookies
 * must be `SameSite=None; Secure` to travel there.
 *
 * Deliberately NOT partitioned (CHIPS): the popup sign-in writes the cookie in a
 * first-party context and the frame reads it as third-party; a partitioned cookie
 * would keep those two apart and defeat the whole point.
 *
 * Gated on `IMAGINE_AUTH_HOSTS`, which the platform injects and is always https.
 * A bare `http://localhost` run has no host list and keeps the safe Lax default
 * (a `Secure` cookie cannot be set over http, so forcing it there breaks sign-in).
 *
 * Note the ceiling: `SameSite=None` is necessary but only sufficient where the
 * browser still allows third-party cookies. Under Safari ITP or Chrome with
 * third-party cookies blocked, a cross-site frame cannot use the cookie at all —
 * that needs the Storage Access API (a user-gesture permission prompt), which is a
 * separate, larger change.
 */
const framedCookieAttributes =
  authHosts.length > 0
    ? { sameSite: "none" as const, secure: true }
    : undefined;

/**
 * "Continue with Google" — brokered by the platform, so there is nothing to set
 * up: no Google Cloud project, no client id/secret to paste. The platform owns
 * one Google client and gives THIS app its own credentials for a small sign-in
 * relay ("Imagine ID"); Better Auth's genericOAuth plugin talks to that relay
 * exactly as it would talk to Google directly. The relay's job is to hold the one
 * fixed Google redirect URI while letting this app be served from any origin.
 *
 * All five values are injected by the platform when the feature is enabled. When
 * they are absent the plugin is simply not added — the app is unchanged and the
 * Google button (see `googleSignInEnabled`) is hidden. Never hard-code them.
 */
const oauthClientId = process.env.IMAGINE_OAUTH_CLIENT_ID;
const oauthClientSecret = process.env.IMAGINE_OAUTH_CLIENT_SECRET;
const oauthAuthorizeUrl = process.env.IMAGINE_OAUTH_AUTHORIZE_URL;
const oauthTokenUrl = process.env.IMAGINE_OAUTH_TOKEN_URL;
const oauthUserInfoUrl = process.env.IMAGINE_OAUTH_USERINFO_URL;

/** True when the platform has wired Google sign-in for this app. Import this in a
 *  server component to decide whether to render the "Continue with Google" button
 *  — the credentials are server-only, so the browser cannot check for itself. */
export const googleSignInEnabled = Boolean(
  oauthClientId &&
    oauthClientSecret &&
    oauthAuthorizeUrl &&
    oauthTokenUrl &&
    oauthUserInfoUrl,
);

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  /**
   * One person, one account — even when they arrive a different way the second time.
   *
   * `trustedProviders` lists the platform's own sign-in relay, whose only identity is
   * a Google-verified email address. That satisfies the first of the four conditions
   * the linking check applies (better-auth 1.6.25, `dist/oauth2/link-account.mjs`):
   *
   *   if (!isTrustedProvider && !userInfo.emailVerified
   *       || requireLocalEmailVerified && !dbUser.user.emailVerified   // <- see below
   *       || accountLinking?.enabled === false
   *       || accountLinking?.disableImplicitLinking === true)
   *
   * Never add a provider here whose email claim you do not trust — a provider that
   * lets someone assert an unverified address could link into a stranger's account.
   *
   * ── The second clause is the one that surprises people ──────────────────────────
   * `requireLocalEmailVerified` defaults to TRUE and is deliberately NOT overridden
   * here. It means implicit linking also requires OUR OWN row to be verified. So
   * somebody who signs up with a password, never opens the confirmation email, and
   * later clicks "Continue with Google" is refused with `account_not_linked`.
   *
   * That refusal is correct, and turning it off would be a security bug: an attacker
   * who pre-registers an unverified account at a victim's address would otherwise
   * have the victim's Google identity linked into the ATTACKER's row on first
   * sign-in. Upstream deprecated the escape hatch for exactly this reason — it is
   * removed next minor and the gate becomes unconditional, so an app relying on
   * `false` would break on a routine dependency bump.
   *
   * The fix is a route forward, not a disabled check. Once the person confirms their
   * address the link succeeds; the confirmation email already sets `emailVerified`,
   * and a matching verified provider email sets it too (`link-account.mjs:49`). So
   * when a sign-in fails this way, tell them their email needs confirming and offer
   * to resend it — `describeAuthError` in `@/lib/errors` returns exactly that
   * message, and the "check your inbox" screen already has the resend button.
   */
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["imagine"],
    },
  },
  advanced: {
    ...(framedCookieAttributes ? { defaultCookieAttributes: framedCookieAttributes } : {}),
    // Vercel sets these itself, so a visitor can't fake their address to dodge the limits below.
    ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] },
  },
  /**
   * Stops password and code guessing. Counted in the database, so the limit
   * holds across every server instance (memory would reset on each one).
   * Off in local development, as before.
   */
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 300, max: 10 },
      "/sign-up/email": { window: 3600, max: 10 },
      "/two-factor/*": { window: 300, max: 10 },
      "/request-password-reset": { window: 3600, max: 5 },
      "/forget-password": { window: 3600, max: 5 },
      "/sign-in/magic-link": { window: 3600, max: 5 },
      "/send-verification-email": { window: 3600, max: 5 },
    },
  },
  baseURL:
    allowedHosts.length > 0
      ? {
          allowedHosts,
          protocol: "https" as const,
          // Used when the Host is absent or unrecognised — e.g. a background job
          // with no request in hand. Without it Better Auth throws instead.
          fallback: staticBaseURL ?? `https://${allowedHosts[0].replace(/^\*\./, "")}`,
        }
      : // No host list (an app built before this, or a plain local run): keep the
        // previous single-origin behaviour rather than changing it silently.
        staticBaseURL,
  // Sessions are cookie-backed and refreshed on use. A week is long enough that a
  // returning user is not asked to sign in again, short enough that a stolen
  // cookie is not indefinite.
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  emailAndPassword: {
    enabled: true,
    // 8 is the floor, not the recommendation. Raising it is fine; lowering it is
    // not — this is the only thing standing between a guessed password and a real
    // person's data.
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      // MUST throw on failure: the user is staring at "check your email".
      await sendEmailOrThrow({
        to: user.email,
        subject: "Reset your password",
        html: `<p>Hello,</p>
<p>Use the link below to choose a new password. It expires in one hour.</p>
<p><a href="${url}">Reset your password</a></p>
<p>If you didn't ask for this, you can safely ignore this email — nothing has changed.</p>`,
      });
    },
  },
  emailVerification: {
    // Send the confirmation the moment someone signs up, rather than waiting for
    // them to ask for it.
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Deliberately NOT sendEmailOrThrow. Sign-up has already succeeded by this
      // point — the account exists. Throwing here would surface as a failed
      // sign-up and could leave the user unable to retry with the same address,
      // which is worse than an unconfirmed email they can re-request.
      const sent = await sendEmail({
        to: user.email,
        subject: "Confirm your email address",
        html: `<p>Hello,</p>
<p>Confirm this address to finish setting up your account.</p>
<p><a href="${url}">Confirm my email</a></p>
<p>If you didn't create an account, you can safely ignore this email.</p>`,
      });
      if (!sent) {
        console.error("[auth] verification email not sent to %s", user.email);
      }
    },
  },
  // Unverified users CAN still sign in — their address is simply marked
  // unverified until they click the link.
  //
  // To require verification before sign-in, move this to `true`. Think first:
  // if email delivery is ever misconfigured or the provider has an outage, `true`
  // means nobody can sign in to this app at all, including people who registered
  // months ago. Gate features on `user.emailVerified` instead when you only need
  // to protect something specific.
  // emailAndPassword.requireEmailVerification — see Better Auth docs.
  databaseHooks: {
    session: { create: { after: async (session) => { await recordSignIn(session); } } },
  },
  plugins: [
    // Two-step sign-in: after the password, a 6-digit code from an authenticator
    // app (or a one-time backup code). People who sign in only with Google have
    // no password, so they can turn it on without one.
    twoFactor({ issuer: "MIK LEDGER", allowPasswordless: true }),
    // Refuses passwords already leaked in data breaches (checked privately: only
    // the first 5 characters of the password's hash ever leave the server). Live
    // site only, so local and preview runs don't depend on the outside service.
    ...(process.env.VERCEL_ENV === "production"
      ? [haveIBeenPwned({ customPasswordCompromisedMessage: "This password has appeared in a data breach elsewhere, so it isn't safe. Please choose a different one." })]
      : []),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // MUST throw: this link is the only way in. Reporting success without
        // sending it is indistinguishable from broken sign-in.
        await sendEmailOrThrow({
          to: email,
          subject: "Your sign-in link",
          html: `<p>Hello,</p>
<p>Use the link below to sign in. It expires shortly and can only be used once.</p>
<p><a href="${url}">Sign in</a></p>
<p>If you didn't ask for this, you can safely ignore this email.</p>`,
        });
      },
    }),
    // Google sign-in via the platform relay. Added only when configured, so an app
    // on a deployment without it behaves exactly as before. The provider id
    // "imagine" is what the browser calls: `signIn.oauth2({ providerId: "imagine" })`
    // (wrapped as `signInWithGoogle()` in auth-client). Google identities land in
    // the existing `account` table — no schema change, one account per email.
    ...(googleSignInEnabled
      ? [
          genericOAuth({
            config: [
              {
                providerId: "imagine",
                clientId: oauthClientId!,
                clientSecret: oauthClientSecret!,
                authorizationUrl: oauthAuthorizeUrl!,
                tokenUrl: oauthTokenUrl!,
                userInfoUrl: oauthUserInfoUrl!,
                scopes: ["openid", "email", "profile"],
                // The relay authenticates the exchange with the per-app client
                // secret; PKCE would add a code-verifier round-trip it does not use.
                pkce: false,
                mapProfileToUser: (profile) => ({
                  email: profile.email,
                  name: profile.name,
                  image: profile.image,
                  emailVerified: profile.emailVerified,
                }),
              },
            ],
          }),
        ]
      : []),
  ],
});

/** The signed-in user, or null. Safe in server components and server actions. */
export const getAuthSession = cache(async function getAuthSession() {
  return auth.api.getSession({ headers: await headers() });
});

/** The signed-in user, or null. Safe in server components and server actions. */
export const getUser = cache(async function getUser() {
  return (await getAuthSession())?.user ?? null;
});

export type SignedInUser = Omit<typeof schema.user.$inferSelect, "image" | "twoFactorEnabled"> & { image?: string | null; twoFactorEnabled?: boolean | null };

/**
 * The signed-in person as seen by the data layer.
 *
 * `id` is the WORKSPACE owner's id — the value every bookkeeping query filters
 * by — so a team member invited into someone's business reads and writes that
 * business's records. `actorId` and `name` are the person actually signed in,
 * for "created by" notes and their own profile. Someone who isn't a member of
 * anyone's workspace is the owner of their own, with the Admin role.
 */
export interface WorkspaceUser extends SignedInUser {
  actorId: string;
  ownerId: string;
  role: Role;
  isOwner: boolean;
  /** The owner's name, for "Business workspace" and document headers. */
  workspaceName: string;
  /** What the workspace's plan allows right now. */
  access: BillingAccess;
  /** Set while a Super Admin looks at this business read-only for support. */
  viewingAs?: boolean;
}

/** The active membership of a signed-in person in someone else's workspace, if any. */
const membershipFor = cache(async function membershipFor(userId: string) {
  const [membership] = await db
    .select()
    .from(schema.bookkeepingRecord)
    .where(and(
      eq(schema.bookkeepingRecord.kind, "team-members"),
      sql`${schema.bookkeepingRecord.data}->>'memberUserId' = ${userId}`,
      sql`${schema.bookkeepingRecord.data}->>'status' = 'Active'`,
      sql`coalesce(${schema.bookkeepingRecord.data}->>'enabled', 'true') <> 'false'`,
    ))
    .limit(1);
  if (!membership || membership.userId === userId) return null;
  const [owner] = await db.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, membership.userId)).limit(1);
  return { ownerId: membership.userId, role: isRole(membership.data.role) ? membership.data.role : "Viewer" as Role, ownerName: owner?.name ?? "Business", ownerEmail: owner?.email ?? "" };
});

/** The business a Super Admin is looking at read-only, from their signed cookie. */
const viewAsTarget = cache(async function viewAsTarget(adminId: string, email: string, emailVerified: boolean) {
  if (!isVerifiedPlatformAdmin({ email, emailVerified })) return null;
  const ownerId = readViewAs((await cookies()).get(VIEW_AS_COOKIE)?.value, adminId);
  if (!ownerId || ownerId === adminId) return null;
  const [owner] = await db.select().from(schema.user).where(eq(schema.user.id, ownerId)).limit(1);
  if (!owner) return null;
  const [settings] = await db.select({ data: schema.bookkeepingRecord.data }).from(schema.bookkeepingRecord).where(and(eq(schema.bookkeepingRecord.userId, ownerId), eq(schema.bookkeepingRecord.kind, "settings"))).limit(1);
  return { owner, name: settings?.data.companyName?.trim() || owner.name };
});

async function asWorkspaceUser(signedIn: SignedInUser): Promise<WorkspaceUser> {
  const viewing = await viewAsTarget(signedIn.id, signedIn.email, Boolean(signedIn.emailVerified));
  if (viewing) {
    // Admin, so every screen shows what the owner sees; `viewingAs` stops every change.
    return { ...signedIn, id: viewing.owner.id, actorId: signedIn.id, ownerId: viewing.owner.id, role: "Admin", isOwner: false, workspaceName: viewing.name, access: await billingAccess(viewing.owner.id, viewing.owner.email), viewingAs: true };
  }
  const membership = await membershipFor(signedIn.id);
  if (!membership) return { ...signedIn, actorId: signedIn.id, ownerId: signedIn.id, role: "Admin", isOwner: true, workspaceName: signedIn.name, access: await billingAccess(signedIn.id, signedIn.email) };
  const access = await billingAccess(membership.ownerId, membership.ownerEmail);
  return { ...signedIn, id: membership.ownerId, actorId: signedIn.id, ownerId: membership.ownerId, role: membership.role, isOwner: false, workspaceName: membership.ownerName, access };
}

/** The signed-in person in their workspace, or null. For layouts and pages that redirect. */
export async function getWorkspaceUser(): Promise<WorkspaceUser | null> {
  const signedIn = await getUser();
  return signedIn ? asWorkspaceUser(signedIn) : null;
}

/**
 * The signed-in user, or throw.
 *
 * Use this at the top of every server action that reads or writes data belonging
 * to a person, and filter your query by the id it returns. It throws rather than
 * returning null on purpose: a nullable return invites `user?.id`, which silently
 * becomes `undefined` in a `where` clause and matches nothing — or, worse,
 * everything.
 */
export async function requireUser(): Promise<WorkspaceUser> {
  // Set only inside the scheduled automation job; never for a browser request.
  const scheduled = currentScheduledUser();
  if (scheduled) return { ...scheduled, actorId: scheduled.id, ownerId: scheduled.id, role: "Admin", isOwner: true, workspaceName: scheduled.name, access: await billingAccess(scheduled.id, scheduled.email) };
  const user = await getUser();
  // The message is already a sentence worth showing, because it will be: a server
  // action's thrown message is what reaches the browser. Keep it that way — a code
  // or a stack trace here becomes a code or a stack trace on someone's screen.
  if (!user) throw new ActionError(describeAuthError("NOT_SIGNED_IN").message);
  const workspaceUser = await asWorkspaceUser(user);
  const override = currentRoleOverride();
  return override ? { ...workspaceUser, role: override } : workspaceUser;
}

/** Throws while a Super Admin is only looking at someone else's business. */
export function assertNotViewing(me: WorkspaceUser) {
  if (me.viewingAs) throw new ActionError("You’re viewing this business read-only as Super Admin, so nothing can be changed. Exit the view to go back.");
}

/** Throws unless the signed-in person's role may change records of this kind. */
export function assertCanWrite(me: WorkspaceUser, kind: string) {
  assertNotViewing(me);
  if (!canWriteKind(me.role, kind)) throw new ActionError("Your role doesn’t allow changing this. Ask an Admin in your business.");
  assertPlanAllows(me, kind);
}

/** Throws when the plan has run out (records are read-only) or doesn't include this part of the product. */
export function assertPlanAllows(me: WorkspaceUser, kind: string) {
  assertNotViewing(me);
  if (me.access.suspended) throw new ActionError("This business has been paused by MIK LEDGER, so nothing can be changed. Contact support to turn it back on.");
  if (me.access.locked) throw new ActionError(me.isOwner ? "Your free trial or plan has ended, so nothing can be changed. Choose a plan in Billing to carry on; your records are all still here." : "This business's free trial or plan has ended, so nothing can be changed. Ask the owner to choose a plan in Billing.");
  const needed = featuresForKind(kind, true);
  if (!needed.some((feature) => me.access.features.includes(feature))) throw new ActionError(`${featureLabels[needed[0]]} isn’t in your plan. Add the ${planFor(needed[0]).name} in Billing to use it.`);
}

/** Throws unless the signed-in person's role may open records of this kind. */
export function assertCanRead(me: WorkspaceUser, kind: string) {
  if (!canReadKind(me.role, kind)) throw new ActionError("Your role doesn’t allow opening this. Ask an Admin in your business.");
}

/** Throws unless the signed-in person is an Admin of their workspace. */
export function assertAdmin(me: WorkspaceUser) {
  assertNotViewing(me);
  if (!canAccess(me.role, "admin", "write")) throw new ActionError("Only an Admin can do this.");
}
