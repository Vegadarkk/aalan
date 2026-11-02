import {
  alertText,
  dueForEscalation,
  emailPayload,
  emailSettings,
  escalationAlert,
  INCIDENT_PREFIX,
  isIdempotentDuplicate,
  parseTargets,
  PROBE_DAILY_CAP,
  recordIncident,
  relay,
  relayCap,
  sendViaResend,
  takeDailySlot,
  transition,
  updateIncident,
  utcDay,
  verdict,
  type Alert,
  type IncidentInput,
  type ProbeState,
  type Target,
} from "./lib";

// Uptime probe (cron, every 5 minutes) and relay for the app's alerts (POST /alert). Outside the
// VM on purpose: it still works when the VM, the tunnel or Valkey is down. Every alert becomes an
// incident in KV for the agents (scripts/incidents.ts); e-mail, through the Resend API with the
// Worker's own key (never on the VM), is the archive. Telegram pages the owner only when an
// incident cannot be recorded, or when a P0/P1 incident is still unacknowledged after 2 hours.

interface Env {
  STATE: KVNamespace;
  PROBE_TARGETS: string;
  /** "Joutiya alertes <alertes@notif.joutiya.ma>" (wrangler.jsonc). */
  ALERT_EMAIL_FROM: string;
  ALERT_EMAIL_TO?: string;
  RESEND_API_KEY?: string;
  ALERT_RELAY_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ACCESS_CLIENT_ID?: string;
  ACCESS_CLIENT_SECRET?: string;
}

const PROBE_TIMEOUT_MS = 10_000;
const MAX_ALERT_BYTES = 16_384;
/** Scheduled runs have 15 minutes of wall time; the relay must answer inside the app's 8 s timeout. */
const EMAIL_TIMEOUT_MS = { cron: 10_000, relay: 6_000 } as const;

type EmailSettings = NonNullable<ReturnType<typeof emailSettings>>;

/** E-mails the alert through Resend. Callers resolve the settings first (emailSettings: off while both secrets are unset). */
async function sendEmail(env: Env, settings: EmailSettings, alert: Alert, idempotencyKey: string, path: keyof typeof EMAIL_TIMEOUT_MS): Promise<void> {
  const payload = emailPayload(env.ALERT_EMAIL_FROM, settings.to, alert);
  const { dailyQuota, monthlyQuota } = await sendViaResend(fetch, settings.apiKey, payload, idempotencyKey, EMAIL_TIMEOUT_MS[path], { retryRateLimit: path === "cron" });
  // Used-quota headers of the free plan (value format undocumented: read it in the logs of the live test).
  if (dailyQuota !== null || monthlyQuota !== null) console.log(`resend quota used: daily=${dailyQuota ?? "-"} monthly=${monthlyQuota ?? "-"}`);
}

async function sendTelegram(env: Env, alert: Alert): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: alertText(alert), disable_web_page_preview: true }),
  });
  // The token is in the URL: report the status only.
  if (!response.ok) throw new Error(`telegram: HTTP ${response.status}`);
}

/**
 * Records the incident for the agents. When KV fails, the owner is paged on Telegram instead:
 * nobody else would see it. Returns true when recorded. Never throws.
 */
async function raise(env: Env, input: IncidentInput, now: number): Promise<boolean> {
  try {
    const id = await recordIncident(env.STATE, input, now);
    if (id) console.log(`incident ${id}: ${input.alert.severity} ${input.alert.title}`);
    return id !== null;
  } catch (error) {
    console.error(`incident: ${String(error)}`);
    try {
      await sendTelegram(env, input.alert);
    } catch (telegramError) {
      console.error(String(telegramError));
    }
    return false;
  }
}

/** One incident a day under `name` (the id is stable over the UTC day). Never throws. */
async function noticeOncePerDay(env: Env, name: string, now: number, alert: Alert): Promise<void> {
  const day = utcDay(now);
  await raise(env, { alert, source: "worker", at: Date.parse(`${day}T00:00:00Z`), dedupe: `${name}/${day}` }, now);
}

/** Probe e-mail: off without settings, capped per UTC day (a flapping target must not spend the shared Resend quota). */
async function sendProbeEmail(env: Env, alert: Alert, idempotencyKey: string, now: number): Promise<void> {
  const settings = emailSettings(env.ALERT_EMAIL_TO, env.RESEND_API_KEY);
  if (!settings) {
    console.warn("e-mail alerts are off: ALERT_EMAIL_TO and RESEND_API_KEY are not set");
    return;
  }
  if (!(await takeDailySlot(env.STATE, "probe", now))) {
    console.warn("probe cap reached: alert e-mail skipped for today");
    await noticeOncePerDay(env, "probe-cap-notice", now, {
      severity: "P2",
      title: "e-mail d'alerte non envoyé",
      body: `Plafond quotidien des e-mails de sonde atteint (${PROBE_DAILY_CAP}). Les alertes de sonde ne sont plus archivées par e-mail jusqu'à demain (UTC) ; les incidents restent enregistrés.`,
    });
    return;
  }
  await sendEmail(env, settings, alert, idempotencyKey, "cron");
}

async function probe(env: Env, target: Target): Promise<Response | null> {
  const headers: Record<string, string> = { "User-Agent": "joutiya-uptime-probe", "Cache-Control": "no-cache" };
  if (target.access && env.ACCESS_CLIENT_ID && env.ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.ACCESS_CLIENT_SECRET;
  }
  try {
    return await fetch(target.url, { headers, redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  } catch {
    return null;
  }
}

async function check(env: Env, target: Target, now: number): Promise<void> {
  const { status, detail } = await verdict(await probe(env, target));
  const key = `probe:${target.name}`;
  const stored = await env.STATE.get(key);
  const previous = stored ? (JSON.parse(stored) as ProbeState) : null;
  const { state, alert } = transition(previous, status, now, target.name, detail);
  // KV writes only when something changed (free tier: 1,000 writes a day).
  if (!previous || state.status !== previous.status || state.pending !== previous.pending || state.pendingStatus !== previous.pendingStatus) {
    await env.STATE.put(key, JSON.stringify(state));
  }
  if (!alert) return;
  // One transition, one incident and one e-mail: both keys dedupe a re-run of the same transition.
  const dedupe = `probe/${target.name}/${state.since}`;
  const [, email] = await Promise.allSettled([raise(env, { alert, source: "probe", at: state.since, dedupe }, now), sendProbeEmail(env, alert, dedupe, now)]);
  if (email.status === "rejected") {
    const reason = String(email.reason);
    console.error(reason);
    // Quota spent: one incident a day.
    if (/quota_exceeded/.test(reason)) {
      await noticeOncePerDay(env, "resend-quota-notice", now, {
        severity: "P2",
        title: "e-mail d'alerte non envoyé",
        body: `${reason}. Les alertes ne sont plus archivées par e-mail jusqu'à la remise à zéro du quota Resend ; les incidents restent enregistrés.`,
      });
    }
  }
}

/** Every target is checked; a check that throws (KV, JSON) is logged and recorded once a day. */
async function runChecks(env: Env, targets: Target[], now: number): Promise<void> {
  const results = await Promise.allSettled(targets.map((target) => check(env, target, now)));
  const failed: string[] = [];
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    const name = targets[index]?.name ?? "?";
    console.error(`probe ${name} failed: ${String(result.reason)}`);
    failed.push(name);
  });
  if (failed.length === 0) return;
  // Names only: an error message could echo a header or a URL. The detail is in the Worker logs.
  await noticeOncePerDay(env, "probe-error-notice", now, {
    severity: "P2",
    title: "sonde en erreur",
    body: `La vérification de ${failed.join(", ")} a échoué (détail dans les journaux du Worker). Un seul avis par jour.`,
  });
}

/** Dead-man pass every 15 minutes (96 KV list operations a day out of 1,000). */
const ESCALATION_EVERY_MS = 15 * 60_000;

/**
 * Pages the owner once about P0/P1 incidents no agent acknowledged in time, then marks them
 * escalated. A failed Telegram call leaves them due: the next pass retries.
 */
async function escalate(env: Env, now: number): Promise<void> {
  const { keys } = await env.STATE.list({ prefix: INCIDENT_PREFIX, limit: 1000 });
  const due = dueForEscalation(keys, now);
  if (due.length === 0) return;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error(`escalation: ${due.length} overdue incident(s) and Telegram is not configured`);
    return;
  }
  await sendTelegram(env, escalationAlert(due));
  const expirations = new Map(keys.map((key) => [key.name, key.expiration]));
  for (const { name } of due) {
    await updateIncident(env.STATE, name, expirations.get(name), (incident) => ({ ...incident, escalatedAt: now }));
  }
}

async function scheduledRun(env: Env, now: number): Promise<void> {
  await runChecks(env, parseTargets(env.PROBE_TARGETS), now);
  if (now % ESCALATION_EVERY_MS >= 5 * 60_000) return;
  try {
    await escalate(env, now);
  } catch (error) {
    console.error(`escalation failed: ${String(error)}`);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/alert" && request.method === "POST") {
      return relay(request, {
        secret: env.ALERT_RELAY_SECRET ?? "",
        nowMs: Date.now(),
        maxBytes: MAX_ALERT_BYTES,
        // One incident per title, environment and UTC hour (the app already dedupes within the hour).
        record: async (alert) => {
          const now = Date.now();
          const hour = now - (now % 3_600_000);
          return (await recordIncident(env.STATE, { alert, source: "relay", at: hour, dedupe: `relay/${alert.env ?? ""}\n${alert.title}` }, now)) !== null;
        },
        send: async (alert, idempotencyKey) => {
          // E-mail off: no slot is taken and the app learns it (503) instead of a silent 204.
          const settings = emailSettings(env.ALERT_EMAIL_TO, env.RESEND_API_KEY);
          if (!settings) return "off";
          if (!(await takeDailySlot(env.STATE, "relay", Date.now(), relayCap(alert.severity)))) {
            console.warn("relay cap reached: alert e-mail skipped for today");
            return "capped";
          }
          try {
            await sendEmail(env, settings, alert, idempotencyKey, "relay");
            return "sent";
          } catch (error) {
            // Same title inside the hour: the earlier e-mail stands (the slot stays spent, the cap counts attempts).
            if (isIdempotentDuplicate(error)) return "duplicate";
            throw error;
          }
        },
      });
    }
    return new Response(null, { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledRun(env, controller.scheduledTime));
  },
};

export default worker;
