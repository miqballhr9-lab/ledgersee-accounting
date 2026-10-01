/**
 * Text AI — a support chatbot, a "summarise this" button, a reply drafter, a tagger.
 *
 * Already configured: there is no API key to obtain, no provider account to open and
 * no billing step. Calls are metered against the app owner's existing balance, the
 * same one the rest of this app's platform services draw on.
 *
 * How it works, and why it is shaped this way: the key is server-only. It buys
 * inference out of the app owner's balance, so a key that reaches a browser is an
 * open, anonymous inference proxy billed to somebody who did nothing wrong — which
 * is why this module is `server-only`, why the key never becomes a prop, a response
 * field or a log line, and why it never gets a browser-visible name. The model, the
 * system prompt and the output ceiling are all pinned per capability on the server,
 * from the manifest in `src/lib/ai-capabilities.ts`, so an end user cannot steer any
 * of the three by sending a cleverer message. The capability NAME selects all three,
 * so an end user must never be allowed to choose the capability either: pass a
 * person's words as a message, and keep `capability` a literal you wrote.
 *
 * Typical use — a server action answers one turn of a chat:
 *
 *   // src/app/actions.ts
 *   "use server";
 *   import { chat } from "@/lib/ai";
 *   import { requireUser } from "@/lib/auth";
 *
 *   export async function askSupport(question: string) {
 *     const me = await requireUser();  // never spend the app's credits for strangers
 *     const answer = await chat({
 *       capability: "support",         // a literal — never something the caller sent
 *       messages: [{ role: "user", content: question }],
 *       user: me.id,
 *     });
 *     return answer.text;
 *   }
 */
import "server-only";

export type AiMessage = {
  /** Who said it. There is no "system" role here on purpose: the instructions are
   *  pinned to the capability on the server, where an end user cannot reach them. */
  role: "user" | "assistant";
  /** The words themselves. Pass the person's message as-is; do not paste your own
   *  instructions in front of it — that is what the capability's `system` is for. */
  content: string;
};

export type ChatInput = {
  /** A capability name from src/lib/ai-capabilities.ts — always a literal you wrote.
   *  NEVER an end user's choice: the name selects the model, the instructions and the
   *  output ceiling, so letting a request body pick it hands a stranger the expensive
   *  one. Same rule as model and system. */
  capability: string;
  /** The conversation so far, oldest first. Send the turns you want the answer to
   *  take into account — this service keeps no history of its own between calls. */
  messages: AiMessage[];
  /** Your own id for the person chatting, so per-person limits can count them. It is
   *  hashed before it is stored, so pass a session id or an anonymous cookie id
   *  rather than an email or a name. Omitting it puts everyone in one shared bucket,
   *  where one busy visitor uses up the allowance meant for all of them. */
  user?: string;
  /** Lower for answers that must stay close to the facts, higher for copy and ideas.
   *  Leave it out to use the capability's default; a value outside the range the
   *  capability declares is refused rather than quietly clamped. */
  temperature?: number;
  /** A shorter cap than the capability's ceiling, when you know the answer is a line
   *  or two. It only ever lowers the ceiling — it cannot raise it. */
  maxOutputTokens?: number;
};

export type ChatResult = {
  /** The answer. Render this; it is already plain text, not a wrapper object. */
  text: string;
  /** What the turn cost, when the service reported it. Useful for your own logs —
   *  the actual billing is done on the server, so nothing here needs to add up. */
  usage?: { promptTokens: number; completionTokens: number };
};

export type CapabilityDefinition = {
  /** Which model answers. Lives here, on the server, so the choice is yours and not
   *  the caller's. */
  model: string;
  /** The standing instructions for this capability. Write them once, here. NEVER
   *  build this from anything a visitor typed. */
  system: string;
  /** The hard ceiling on one answer's length. Set it to the shortest length that
   *  still does the job — it is also the ceiling the owner's balance is held against
   *  while the answer is being written. */
  maxOutputTokens: number;
  /** The range a caller may ask for, and what to use when they ask for nothing. */
  temperature?: { min: number; max: number; default: number };
  /** A line for whoever reads this file next, saying what this capability is for. */
  description?: string;
};

export type AiErrorCode =
  | "invalid_request" | "invalid_api_key" | "capability_not_found"
  | "capability_violation" | "budget_exceeded" | "request_cap_exceeded"
  | "insufficient_credits" | "rate_limited" | "not_configured" | "paused"
  | "upstream_error" | "credit_exhausted" | "unknown";

/** Every refusal from the AI service, with the reason as a stable code. */
export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(message: string, code: AiErrorCode) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

/** The app has spent its AI credits. Nothing the person did is wrong; tell them the
 *  feature is unavailable and tell the app's owner to top up. Branch on
 *  `instanceof AiCreditsExhaustedError`, not on the sentence. */
export class AiCreditsExhaustedError extends AiError {
  constructor(message: string, code: AiErrorCode = "credit_exhausted") {
    super(message, code);
    this.name = "AiCreditsExhaustedError";
  }
}

// One sentence per refusal, and each one is written to be safe to show a visitor:
// no provider, no model, no token count, no status code. That is the same rule
// `errors.ts` states at its lines 10-19 — the person reading it chose none of the
// machinery and cannot act on knowing its name. The code, not the sentence, is what
// your own logs and your UI branch on.
const REFUSAL_MESSAGES: Record<AiErrorCode, string> = {
  invalid_request: "That message couldn't be sent. Try a shorter one.",
  invalid_api_key: "AI features aren't available for this app right now.",
  capability_not_found: "That assistant isn't set up in this app.",
  capability_violation: "That request isn't something this assistant can do.",
  budget_exceeded: "This app has reached its AI limit for now. Try again later.",
  request_cap_exceeded: "This app has reached its AI limit for today. Try tomorrow.",
  insufficient_credits: "AI features are unavailable right now. Try again later.",
  rate_limited: "That's a lot of messages at once. Wait a moment and try again.",
  not_configured: "AI features aren't available for this app.",
  paused: "AI features are paused for this app right now.",
  upstream_error: "The assistant couldn't answer just now. Please try again.",
  credit_exhausted: "AI features are unavailable right now. Try again later.",
  unknown: "The assistant couldn't answer just now. Please try again.",
};

// The manifest this process declared, and whether the service has been told about it.
// These live in module scope because a serverless function is reused across many
// requests: registering once per cold start is the whole point, and a value parked
// here survives exactly as long as the process that can benefit from it.
let declaredCapabilities: Record<string, CapabilityDefinition> | null = null;
let manifestJson = "";
let registeredHash = "";
let registered = false;
let registering: Promise<void> | null = null;

/** Declare this app's capabilities ONCE, in src/lib/ai-capabilities.ts. The model and
 *  the instructions live here, on the server, which is what stops an end user steering
 *  either. Registration happens on first use and is skipped while the manifest is
 *  unchanged.
 *
 *  ALWAYS write the definitions as literals in that one file. NEVER assemble one from
 *  a request body, a database row a visitor can write, or a query parameter — the
 *  system prompt is the only thing standing between your capability and whatever a
 *  stranger would rather the model did.
 *
 *  Returns the same object it was given, so `export const CAPABILITIES =
 *  defineCapabilities({ … })` reads naturally. */
export function defineCapabilities(
  defs: Record<string, CapabilityDefinition>,
): Record<string, CapabilityDefinition> {
  declaredCapabilities = defs;
  manifestJson = canonicalManifest(manifestWire(defs));
  // A re-declaration (a module reload in dev, a second import order) must be pushed
  // again, or the process would keep serving against the manifest it registered first.
  // `registeredHash` deliberately survives, so `register` can tell a genuine change
  // from the same manifest arriving twice.
  registered = false;
  registering = null;
  return defs;
}

/**
 * Ask for one complete answer.
 *
 * ALWAYS pass a `capability` you wrote as a literal, and NEVER one taken from the
 * request — the name picks the model, the instructions and the output ceiling, so a
 * caller who can choose it can choose the expensive one and put the words in its
 * mouth.
 *
 * Never pass an end user's raw text as instructions: their words belong in a `user`
 * message, and the capability's `system` is yours. Hash or omit identifiers — `user`
 * wants a session id, not somebody's email address.
 *
 * Throws on refusal — a silent empty answer is worse than an error, because the app
 * renders it as the assistant's reply and nobody ever finds out why it was blank.
 */
export async function chat(input: ChatInput): Promise<ChatResult> {
  const { base, key } = requireConfig();
  await ensureRegistered(base, key);

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify(requestBody(input, false)),
    cache: "no-store",
  });
  if (!response.ok) throw await refusalFrom(response);

  const data: AiCompletionBody = await response.json();
  const usage = data.usage;
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

/**
 * Stream the answer a piece at a time, for a UI that types the reply out.
 *
 * ALWAYS keep `capability` a literal, exactly as in `chat`; NEVER let the caller
 * choose it. The same privacy rule applies too — a person's words go in a `user`
 * message, never into the instructions, and `user` takes a session id, not a name.
 *
 * Throws on refusal — before the first chunk when the request is refused outright,
 * and mid-iteration if the app runs out of credits while the answer is being written,
 * so a half-finished answer can never be mistaken for a finished one.
 */
export async function* streamChat(
  input: ChatInput,
): AsyncGenerator<string, void, unknown> {
  const response = await startStream(input);
  const body = response.body;
  if (!body) throw new AiError(REFUSAL_MESSAGES.upstream_error, "upstream_error");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // The service ends EVERY stream — including one it cut short, and including
        // one carrying an error frame — with `data: [DONE]`. A body that simply stops
        // is an answer truncated in transit (a recovered panic upstream, a proxy that
        // closed the response cleanly after the last frame), and returning here would
        // hand the app half an answer indistinguishable from a finished one, which it
        // would then store and render as the assistant's own reply.
        //
        // The buffer check is load-bearing: the loop deliberately holds the
        // unterminated tail back, so a sentinel that arrived without its trailing
        // newline is still sitting here on a perfectly healthy stream.
        if (buffer.trim() !== "data: [DONE]") {
          throw new AiError(REFUSAL_MESSAGES.upstream_error, "upstream_error");
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      // A chunk boundary can land anywhere, so hold the unterminated tail back.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        // A line starting with ":" is an SSE comment — the service sends `: ping`
        // so proxies do not idle the connection out while a slow model thinks.
        // It is never JSON; parsing it is how a keep-alive becomes a crash.
        if (line === "" || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;

        const frame = parseFrame(payload);
        if (!frame) continue;
        if (frame.error) {
          // THROW, never return. Exhaustion and upstream failures arrive as a frame
          // on a response that already said 200 and has already delivered half an
          // answer. Ending the generator quietly here would hand the app a truncated
          // reply indistinguishable from a finished one, and it would be rendered as
          // the assistant's own words.
          throw refusalFor(frame.error.code);
        }
        const piece = frame.choices?.[0]?.delta?.content ?? "";
        if (piece) yield piece;
      }
    }
  } finally {
    // Runs when the caller breaks out of `for await` too. Without it the upstream
    // request stays open and the owner keeps paying for tokens nobody will read.
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Hand a Response straight back to the browser, already SSE-framed.
 *
 * ALWAYS check who is asking in the route handler first, and NEVER take the
 * capability from the incoming request body — this is the shape most likely to be
 * wired straight to a `fetch` from a client component, which is exactly the path a
 * stranger would use to pick the expensive capability. The privacy rule is unchanged:
 * a person's words are a `user` message, and `user` is a session id.
 *
 * The browser receives the frames as they are, including an error frame if the app
 * runs out mid-answer, so client code must look for `error` in each frame. Use
 * `streamChat` when you would rather that arrived as a thrown error on the server.
 *
 * Throws on refusal — the refusal happens before any of this reaches the browser,
 * while a real status code can still be returned.
 */
export async function streamChatResponse(input: ChatInput): Promise<Response> {
  const response = await startStream(input);
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would hold the whole answer back and deliver it at once,
      // which defeats the only reason to stream.
      "X-Accel-Buffering": "no",
    },
  });
}

// ── the wire ──────────────────────────────────────────────────────────────────

/** One frame of a streamed answer, or the error that ended it. */
type AiStreamFrame = {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { code?: string; message?: string };
};

/** One complete answer. */
type AiCompletionBody = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** The refusal envelope, which is OpenAI-shaped rather than this platform's usual. */
type AiErrorBody = { error?: { code?: string; message?: string } };

function requireConfig(): { base: string; key: string } {
  const base = process.env.IMAGINE_AI_URL;
  const key = process.env.IMAGINE_AI_KEY;
  if (!base || !key) {
    throw new AiError(REFUSAL_MESSAGES.not_configured, "not_configured");
  }
  // Read per request, not once at module load: a serverless process that started
  // before the variables were injected would otherwise refuse for its whole life.
  return { base: base.replace(/\/+$/, ""), key };
}

function authHeaders(key: string): Record<string, string> {
  // Divergence from storage.ts and email.ts, deliberately: those put the app's
  // credential in the JSON body as `token`, because the storage and email services
  // are this platform's own shape. The AI service is OpenAI-compatible so that the
  // stock `openai` package and the Vercel AI SDK can be pointed at IMAGINE_AI_URL
  // unchanged, and those clients only ever send a credential as a bearer header.
  // Never put it in the URL: query strings end up in access logs.
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

function requestBody(input: ChatInput, stream: boolean): Record<string, unknown> {
  // Built field by field. Spreading the caller's object through would carry whatever
  // else it happens to hold, and the fields that steer a model are exactly the ones
  // that must not travel from a request body to the service.
  return {
    model: input.capability,
    messages: input.messages,
    stream,
    user: input.user,
    temperature: input.temperature,
    max_completion_tokens: input.maxOutputTokens,
  };
}

async function startStream(input: ChatInput): Promise<Response> {
  const { base, key } = requireConfig();
  await ensureRegistered(base, key);

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders(key), Accept: "text/event-stream" },
    body: JSON.stringify(requestBody(input, true)),
    cache: "no-store",
  });
  if (!response.ok) throw await refusalFrom(response);
  return response;
}

function parseFrame(payload: string): AiStreamFrame | null {
  try {
    return JSON.parse(payload);
  } catch {
    // A frame we cannot read is not a reason to end an answer that is still arriving.
    return null;
  }
}

async function refusalFrom(response: Response): Promise<AiError> {
  // Divergence from storage.ts, deliberately: it reads `reason?.detail?.code` because
  // the storage service answers in FastAPI's envelope. This service answers in
  // OpenAI's, `{"error":{"message","type","code"}}`. Reading the wrong one finds
  // nothing, and every refusal — including "you are out of credits" — collapses into
  // the same generic sentence with no code to act on.
  const body: AiErrorBody | null = await response.json().catch(() => null);
  return refusalFor(body?.error?.code);
}

function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === "string" && value in REFUSAL_MESSAGES;
}

function refusalFor(rawCode: unknown): AiError {
  const code = isAiErrorCode(rawCode) ? rawCode : "unknown";
  const message = REFUSAL_MESSAGES[code];
  // Both codes mean the same thing to the person waiting — the app cannot pay for
  // this answer — and neither is their fault, so both get the type that says so.
  if (code === "credit_exhausted" || code === "insufficient_credits") {
    return new AiCreditsExhaustedError(message, code);
  }
  return new AiError(message, code);
}

// ── registering the manifest ──────────────────────────────────────────────────

async function ensureRegistered(base: string, key: string): Promise<void> {
  if (declaredCapabilities === null || registered) return;
  if (!registering) {
    registering = register(base, key).finally(() => {
      registering = null;
    });
  }
  // Every concurrent first call waits on the same attempt: one PUT per cold start,
  // and a failure reaches all of them rather than one.
  await registering;
}

async function register(base: string, key: string): Promise<void> {
  const hash = await sha256Hex(manifestJson);
  // The same manifest declared twice in one process is not a reason for a second
  // round trip; the service already holds exactly these bytes.
  if (hash && hash === registeredHash) {
    registered = true;
    return;
  }

  const headers = authHeaders(key);
  // The validator is an optimisation, never the mechanism: it lets the service answer
  // 304 and skip the write. When no digest could be taken the manifest simply goes up
  // unconditionally, which is the same outcome one HTTP round trip more expensively.
  if (hash) headers["If-None-Match"] = `"${hash}"`;

  const response = await fetch(`${base}/capabilities`, {
    method: "PUT",
    headers,
    body: manifestJson,
    cache: "no-store",
  });

  // 304: the service already holds this exact manifest, which is the common case
  // once one process has pushed it. 200: it holds it now. Either way this process is
  // done for its lifetime. A canonical form that does not agree with the service's is
  // never a STALE manifest — the PUT that follows a miss carries the whole thing —
  // but it is not free either: every cold start then pays the manifest write and the
  // key-cache invalidation that ride it, which is why the digest is pinned by a
  // fixture on both sides rather than left to two independent readings of "sorted".
  if (response.ok || response.status === 304) {
    registeredHash = hash;
    registered = true;
    return;
  }

  const refusal = await refusalFrom(response);
  // The format string carries the code and nothing else: the manifest holds this
  // app's instructions, the header holds its key, and neither belongs in a log.
  console.error(
    "[ai] capability registration refused (%s) — later calls cannot work",
    refusal.code,
  );
  // Never swallowed. A manifest that failed to register makes every later call answer
  // "that assistant isn't set up", and this is the only place the real reason exists.
  throw refusal;
}

/** The shapes this module hands the service, named so the canonical form below can
 *  be extracted and executed on its own by the fixture test (no generics in a
 *  parameter type, so a plain signature strip is enough to run it). */
type CapabilityDefs = Record<string, CapabilityDefinition>;
type CapabilityWire = {
  model: string;
  system: string;
  max_output_tokens: number;
  temperature?: { min: number; max: number; default: number };
  description?: string;
};
type ManifestWire = Record<string, CapabilityWire>;

// ── the canonical manifest, byte for byte ─────────────────────────────────────
//
// The service holds a digest of the manifest it has and answers 304 when the one
// this PUT carries matches (D-42), so these bytes are a CROSS-LANGUAGE CONTRACT,
// not a local convenience. Two readings of the word "canonical" that put one key
// in a different place produce different digests for EVERY manifest, and the 304
// is then unreachable: measured, the two sides never matched once, and every cold
// start of every function instance paid a full manifest write plus the key-cache
// invalidation that rides it.
//
// The service is Go, and it hashes `json.Marshal` of its own capability struct.
// So this is that form, exactly:
//   * capability NAMES sorted, and nothing else sorted — the fields inside a
//     capability keep the struct's declaration order (model, system,
//     max_output_tokens, temperature, description). Sorting them alphabetically
//     is what made the two digests differ.
//   * the same fields omitted: `temperature` when absent, `description` when
//     absent OR empty (Go's `omitempty` drops `""`, and `description: ""` is the
//     shape a builder writes without thinking). `top_p` exists on the service's
//     struct and has no spelling here, so neither side ever emits it.
//   * encoding/json's escaping, which is written for HTML contexts and so escapes
//     `<`, `>` and `&` as \u003c, \u003e and \u0026 where JSON.stringify
//     leaves them alone. That difference alone is enough to miss every 304 for
//     any capability whose instructions contain an ampersand.
//
// One fixture manifest, its exact bytes and its digest are pinned on both sides —
// backend/tests/test_ai_rail_template.py here, entities/ai/manifest_test.go there.
// Change the shape on one side only and that pair of tests is what says so.
//
// canonical-form:BEGIN — extracted and run by that test; keep it self-contained,
// single-line signatures, no generics in a parameter type.
function manifestWire(defs: CapabilityDefs): ManifestWire {
  const wire: ManifestWire = {};
  for (const [name, def] of Object.entries(defs)) {
    const cap: CapabilityWire = {
      model: def.model,
      system: def.system,
      max_output_tokens: def.maxOutputTokens,
    };
    if (def.temperature) cap.temperature = def.temperature;
    if (def.description) cap.description = def.description;
    wire[name] = cap;
  }
  return wire;
}

function canonicalManifest(wire: ManifestWire): string {
  // Capability names are restricted to `^[a-z][a-z0-9_-]{0,63}$` by the service,
  // so comparing UTF-16 code units here is the same ordering its byte-wise sort
  // produces. A name outside that set is refused by the PUT, not hashed twice.
  const names = Object.keys(wire).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const body = names
    .map((name) => `${goJsonString(name)}:${canonicalCapability(wire[name])}`)
    .join(",");
  return `{${body}}`;
}

function canonicalCapability(cap: CapabilityWire): string {
  const fields = [
    `"model":${goJsonString(cap.model)}`,
    `"system":${goJsonString(cap.system)}`,
    `"max_output_tokens":${goJsonNumber(cap.max_output_tokens)}`,
  ];
  const band = cap.temperature;
  if (band) {
    fields.push(
      `"temperature":{"min":${goJsonNumber(band.min)},` +
        `"max":${goJsonNumber(band.max)},` +
        `"default":${goJsonNumber(band.default)}}`,
    );
  }
  if (cap.description) {
    fields.push(`"description":${goJsonString(cap.description)}`);
  }
  return `{${fields.join(",")}}`;
}

function goJsonString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) {
      // A half of a surrogate pair on its own is not text: the fetch below encodes
      // the body as UTF-8, which substitutes U+FFFD for it before the service ever
      // reads it, so this hashes what the service will hash rather than what this
      // string happens to hold.
      out += "\ufffd";
    } else if (ch === '"' || ch === "\\") {
      out += `\\${ch}`;
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else if (
      code < 0x20 || ch === "<" || ch === ">" || ch === "&" ||
      code === 0x2028 || code === 0x2029
    ) {
      // Lower-case hex, four digits, like Go's own table. The three punctuation
      // characters are escaped because encoding/json escapes them by default; the
      // two separators because it escapes those unconditionally.
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

function goJsonNumber(value: number): string {
  // Go and JavaScript print a float64 the same way for everything the service will
  // accept here — a temperature band inside 0..2, a top_p band inside 0..1 and an
  // integer token ceiling. They part company only at the exponent forms, which are
  // outside every one of those bands, and a non-finite bound is refused by the PUT
  // before anything is hashed.
  return JSON.stringify(value);
}
// canonical-form:END

// Web Crypto, so this module stays dependency-free. It is reached through
// `globalThis` and treated as optional on purpose: it is a global on every runtime
// this app is deployed to, but NOT inside an ES module on Node 18, where the bare
// name throws a ReferenceError. That would have surfaced as a crash in the middle of
// somebody's first AI call, in exchange for a conditional request. Returning "" costs
// one unconditional PUT per cold start instead.
//
// The digest is async, which is why the hash is taken here on first use rather than
// in `defineCapabilities`: that one is called at module scope, with nothing to await.
async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
