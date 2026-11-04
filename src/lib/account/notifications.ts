import "server-only";
import { requireUser } from "@/lib/auth/guards";
import { notificationSettingsSchema, type NotificationSettings } from "@/lib/contracts/account";
import type { UserPrivateDoc } from "@/lib/db/schemas";
import { getUserPrivate, updateNotificationPreferences, type NotificationPatch } from "@/lib/db/repositories/users";
import { notFound } from "@/lib/http/errors";
import { readJson } from "@/lib/http/json";
import { json } from "@/lib/http/route";
import { enforceLimit } from "@/lib/rate-limit/limiter";

// E-mail preferences of the signed-in member (audit B2: Z1-02 "révocable à tout moment", zone 5
// n°4): the marketing opt-in of the sign-up form and the messaging e-mails (message-digest,
// appointment-reminders, review notices read `notifications.messagesEmail`). The uid comes from the
// session, never from the body.

export function notificationSettings(account: UserPrivateDoc): NotificationSettings {
  return {
    marketing: account.consents.marketing,
    marketingSince: account.consents.marketing && account.consents.marketingConsent ? account.consents.marketingConsent.at.toISOString() : null,
    messagesEmail: account.notifications?.messagesEmail !== false,
  };
}

/** Only what changes is written: a repeated opt-in keeps the date of the first one. */
export function notificationPatch(current: NotificationSettings, input: NotificationPatch): NotificationPatch {
  const patch: NotificationPatch = {};
  if (input.marketing !== undefined && input.marketing !== current.marketing) patch.marketing = input.marketing;
  if (input.messagesEmail !== undefined && input.messagesEmail !== current.messagesEmail) patch.messagesEmail = input.messagesEmail;
  return patch;
}

async function currentAccount(uid: string): Promise<UserPrivateDoc> {
  const account = await getUserPrivate(uid);
  if (!account) throw notFound();
  return account;
}

/** GET /api/account/notifications. */
export async function handleNotificationsRead(request: Request): Promise<Response> {
  const { user } = await requireUser(request);
  return json(notificationSettings(await currentAccount(user.uid)));
}

/** POST /api/account/notifications. */
export async function handleNotificationsUpdate(request: Request): Promise<Response> {
  const context = await requireUser(request, { mutation: true });
  const input = await readJson(request, notificationSettingsSchema);
  const { uid } = context.user;
  await enforceLimit("account.mutation.uid", uid);
  const current = notificationSettings(await currentAccount(uid));
  const patch = notificationPatch(current, input);
  if (Object.keys(patch).length === 0) return json(current);
  await updateNotificationPreferences(uid, patch);
  return json(notificationSettings(await currentAccount(uid)));
}
