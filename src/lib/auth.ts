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
import { genericOAuth, magicLink } from "better-auth/plugins";
import { headers } from "next/headers";

import { db } from "@/db";
import * as schema from "@/db/schema";
import { sendEmail, sendEmailOrThrow } from "@/lib/email";
import { describeAuthError } from "@/lib/errors";

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

const staticBaseURL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL;

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
  ...(framedCookieAttributes
    ? { advanced: { defaultCookieAttributes: framedCookieAttributes } }
    : {}),
  baseURL:
    authHosts.length > 0
      ? {
          allowedHosts: authHosts,
          protocol: "https" as const,
          // Used when the Host is absent or unrecognised — e.g. a background job
          // with no request in hand. Without it Better Auth throws instead.
          fallback: staticBaseURL ?? `https://${authHosts[0].replace(/^\*\./, "")}`,
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
  plugins: [
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
export async function getUser() {
  const result = await auth.api.getSession({ headers: await headers() });
  return result?.user ?? null;
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
export async function requireUser() {
  const user = await getUser();
  // The message is already a sentence worth showing, because it will be: a server
  // action's thrown message is what reaches the browser. Keep it that way — a code
  // or a stack trace here becomes a code or a stack trace on someone's screen.
  if (!user) throw new Error(describeAuthError("NOT_SIGNED_IN").message);
  return user;
}
