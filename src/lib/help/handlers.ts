import "server-only";
import { anonymous, beginAnonymous, respond } from "@/lib/auth/anonymous";
import { optionalUser } from "@/lib/auth/guards";
import { askAssistant } from "@/lib/ai/assistant";
import { assistantRequestSchema, type AssistantResponse, type HelpHit } from "@/lib/contracts/assistant";
import { readJson } from "@/lib/http/json";
import { escalateOnIp } from "@/lib/listings/escalation";
import { enforceLimit } from "@/lib/rate-limit/limiter";
import { questionLocale } from "./match";
import { loadHelpArticles, searchHelp } from "./search";

// POST /api/assistant (design phase-5 D25, AF §6 and §7): visitors and members, same origin. Limits
// before any other work, all "closed" (the AI budget is at stake: a store outage answers 503):
// 10 per hour and 30 per day per account (signed in) or device, 1 000 per day per IPv6 /48, 200 per
// day per IP /64, then Turnstile. The session only picks the limiter key: no account read, nothing about the person
// in the prompt. The AI being unavailable is not an error: 200 with the matching help articles.

const SEARCH_LIMIT = 4;

async function ask(request: Request): Promise<Response> {
  const flow = beginAnonymous(request);
  const input = await readJson(request, assistantRequestSchema);
  const viewer = await optionalUser(request);
  const subject = viewer ? `u:${viewer.user.uid}` : flow.identity.deviceKey;
  await enforceLimit("assistant.device.hour", subject);
  await enforceLimit("assistant.device.day", subject);
  if (flow.identity.ip48) await enforceLimit("assistant.ip48", flow.identity.ip48);
  if (await escalateOnIp(request, "assistant.ip", flow.device, input.turnstileToken, "assistant")) flow.turnstilePassed = true;

  // A question in Arabic on the French pages is answered from the Arabic articles (audit zone 5
  // n°18): the same single call, the Arabic prompt's cache; the links lead to the Arabic pages.
  const locale = questionLocale(input.question, input.locale);
  const elsewhere = locale === input.locale ? {} : { locale };
  const articles = await loadHelpArticles(locale);
  const outcome = await askAssistant({ locale, question: input.question, history: input.history, articles });
  if (outcome.mode === "ai") {
    const bySlug = new Map(articles.map((article) => [article.slug, article]));
    const cited = outcome.cited.flatMap((slug): HelpHit[] => {
      const article = bySlug.get(slug);
      return article ? [{ slug, title: article.title, summary: article.summary, ...elsewhere }] : [];
    });
    return respond<AssistantResponse>(flow, { mode: "ai", answer: outcome.answer, articles: cited });
  }
  const found = await searchHelp(locale, input.question, SEARCH_LIMIT, articles);
  return respond<AssistantResponse>(flow, { mode: "search", articles: found.map((hit) => ({ ...hit, ...elsewhere })) });
}

/** POST /api/assistant (device and Turnstile pass cookies on every answer, errors included). */
export const handleAssistant = anonymous(ask);
