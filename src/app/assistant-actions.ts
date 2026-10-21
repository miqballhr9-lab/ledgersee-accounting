"use server";

import { listAllBookkeepingRecords } from "@/app/actions";
import { AiError, chat, type AiMessage } from "@/lib/ai";
import "@/lib/ai-capabilities";
import { buildAssistantBrief, type AssistantQuestion } from "@/lib/assistant";
import { requireUser } from "@/lib/auth";
import { businessToday } from "@/lib/hr-data";

export interface AssistantStart {
  firstName: string;
  insights: { text: string; question: AssistantQuestion }[];
  questions: AssistantQuestion[];
  /** False when the app has no AI connected: only the ready answers work then. */
  aiReady: boolean;
}

const aiConfigured = () => Boolean(process.env.IMAGINE_AI_URL && process.env.IMAGINE_AI_KEY);

async function brief() {
  const me = await requireUser();
  const records = await listAllBookkeepingRecords();
  const settings = records.find((record) => record.kind === "settings")?.data ?? {};
  return { me, brief: buildAssistantBrief(records, businessToday(settings.timeZone), me.workspaceName) };
}

/** What the panel opens with: a greeting, a few insights and suggested questions. */
export async function startAssistant(): Promise<AssistantStart> {
  const { me, brief: data } = await brief();
  return { firstName: me.name.split(" ")[0] || "there", insights: data.insights, questions: data.questions, aiReady: aiConfigured() };
}

/** Answers one of the suggested questions straight from the books, with no AI. */
export async function answerQuestion(key: string): Promise<string> {
  const { brief: data } = await brief();
  return data.answers[key] ?? "I can't answer that one from your books yet.";
}

/** Answers a free question from the person's books, with the conversation so far. */
export async function askAssistant(history: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  const { me, brief: data } = await brief();
  const turns = history
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim())
    .slice(-12)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
  if (!turns.length || turns[turns.length - 1].role !== "user") return "Ask me a question about your business.";
  if (!aiConfigured()) {
    return [
      "Free questions need the AI assistant, which isn't switched on for this app yet.",
      "",
      "I can still answer these from your books — tap one:",
      ...data.questions.map((question) => `- ${question.label}`),
    ].join("\n");
  }
  const messages: AiMessage[] = [
    { role: "user", content: `<books>\n${data.facts}\n</books>` },
    { role: "assistant", content: "I have your figures. What would you like to know?" },
    ...turns,
  ];
  try {
    const answer = await chat({ capability: "books-assistant", messages, user: me.id });
    return answer.text.trim() || "I couldn't put an answer together. Try asking another way.";
  } catch (error) {
    if (error instanceof AiError) return error.message;
    throw error;
  }
}
