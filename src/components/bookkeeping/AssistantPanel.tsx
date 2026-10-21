"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { CornerDownRight, LoaderCircle, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";

import { answerQuestion, askAssistant, startAssistant, type AssistantStart } from "@/app/assistant-actions";
import { Button } from "@/components/ui/button";
import { readableError } from "@/lib/action-error";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "mik-assistant-chat";

function readSaved(): Turn[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((turn): turn is Turn => Boolean(turn) && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string").slice(-30) : [];
  } catch {
    return [];
  }
}

/** **bold** inside a line. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (part.startsWith("**") && part.endsWith("**") ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>))}</>;
}

/** The small part of Markdown answers use: paragraphs, "- " bullets and bold. */
function Answer({ text }: { text: string }) {
  const blocks: { bullets: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const bullet = /^\s*[-*•]\s+/.test(line);
    const content = bullet ? line.replace(/^\s*[-*•]\s+/, "") : line.replace(/^#+\s*/, "");
    const last = blocks[blocks.length - 1];
    if (last && last.bullets && bullet) last.lines.push(content);
    else blocks.push({ bullets: bullet, lines: [content] });
  }
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => (block.bullets ? (
        <ul key={index} className="list-disc space-y-1 pl-5">{block.lines.map((line, at) => <li key={at}><Inline text={line} /></li>)}</ul>
      ) : <p key={index}><Inline text={block.lines[0]} /></p>))}
    </div>
  );
}

/** The assistant docked on the right: insights and suggested questions from the books, and a chat about them. */
export default function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [start, setStart] = useState<AssistantStart | null>(null);
  const [startError, setStartError] = useState("");
  const [turns, setTurns] = useState<Turn[]>(readSaved);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    startAssistant().then((value) => { if (!cancelled) setStart(value); }).catch((error: unknown) => { if (!cancelled) setStartError(error instanceof Error ? readableError(error) : "The assistant couldn't load."); });
    input.current?.focus();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-30)));
    } catch {
      // Private windows can refuse storage; the chat simply isn't kept.
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(question: string, answer: () => Promise<string>) {
    if (busy) return;
    setTurns((current) => [...current, { role: "user", content: question }]);
    setBusy(true);
    try {
      const text = await answer();
      setTurns((current) => [...current, { role: "assistant", content: text }]);
    } catch (error) {
      setTurns((current) => [...current, { role: "assistant", content: error instanceof Error ? readableError(error) : "The assistant couldn't answer just now. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  function ask(key: string, label: string) {
    void run(label, () => answerQuestion(key));
  }

  function send() {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    const history = [...turns, { role: "user" as const, content: question }];
    void run(question, () => askAssistant(history));
  }

  const chip = (key: string, label: string) => (
    <button key={key} type="button" disabled={busy} onClick={() => ask(key, label)} className="flex w-full items-start gap-2 rounded-lg bg-primary/8 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-primary/15 disabled:opacity-60">
      <CornerDownRight size={14} className="mt-0.5 shrink-0 text-primary" />
      <span>{label}</span>
    </button>
  );
  const insightKeys = new Set(start?.insights.map((insight) => insight.question.key) ?? []);

  return (
    <aside aria-label="Assistant" className="print:hidden fixed inset-0 z-50 flex flex-col border-l border-border bg-card lg:static lg:inset-auto lg:z-auto lg:w-[400px] lg:shrink-0">
      <div className="flex h-[68px] shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles size={18} className="shrink-0 text-primary" />
          <h2 className="truncate text-base font-semibold">MIK Assistant</h2>
          <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-foreground">BETA</span>
        </div>
        <div className="flex items-center gap-1">
          {turns.length ? <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" disabled={busy} onClick={() => setTurns([])}><RotateCcw size={15} /></Button> : null}
          <Button variant="ghost" size="icon-sm" aria-label="Close assistant" title="Close" onClick={onClose}><X size={17} /></Button>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {!turns.length ? (
          <div className="space-y-5">
            <div>
              <Sparkles size={24} className="text-primary" />
              <p className="mt-3 text-xl font-semibold tracking-tight">{start ? `Hi ${start.firstName}, what can I do for you today?` : "What can I do for you today?"}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">Ask about your sales, expenses, cash, customers and bills. Answers come from your own books.</p>
            </div>
            {startError ? <p className="text-sm text-destructive">{startError}</p> : null}
            {!start && !startError ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={15} className="animate-spin" />Reading your books…</p> : null}
            {start?.insights.map((insight) => (
              <div key={insight.text} className="space-y-2">
                <p className="text-sm">{insight.text}</p>
                {chip(insight.question.key, insight.question.label)}
              </div>
            ))}
            {start && start.questions.some((question) => !insightKeys.has(question.key)) ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">You can also ask</p>
                {start.questions.filter((question) => !insightKeys.has(question.key)).map((question) => chip(question.key, question.label))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((turn, index) => (
              <div key={index} className={turn.role === "user" ? "flex justify-end" : ""}>
                {turn.role === "user"
                  ? <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{turn.content}</p>
                  : <div className="text-sm leading-relaxed"><Answer text={turn.content} /></div>}
              </div>
            ))}
            {busy ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={15} className="animate-spin" />Thinking…</p> : null}
            {!busy && start?.questions.length ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {start.questions.map((question) => (
                  <button key={question.key} type="button" onClick={() => ask(question.key, question.label)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">{question.label}</button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            ref={input}
            value={draft}
            rows={2}
            maxLength={2000}
            placeholder="Ask anything"
            aria-label="Ask the assistant"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
            className="block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{start && !start.aiReady ? "Suggested questions work now; free questions need AI switched on." : "Enter to send · Shift+Enter for a new line"}</p>
            <Button type="button" size="icon-sm" aria-label="Send" disabled={busy || !draft.trim()} onClick={send}><SendHorizontal size={15} /></Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">The assistant can make mistakes. Check important figures in Reports.</p>
      </div>
    </aside>
  );
}
