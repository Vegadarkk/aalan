"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { loadScript } from "@/components/auth/load-script";
import type { MetaSignupConfig, MetaSignupResult } from "@/lib/phone-verify/meta-signup";
import { ADMIN_API, adminFetch, errorMessage } from "./api-client";

// Embedded Signup of Meta (WhatsApp Business app number kept in the app, "coexistence"): the
// popup returns a one-time code (callback) and the account id (window message from facebook.com);
// both go to the API at once, which subscribes the app to the account and lists its numbers.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

interface FacebookLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FacebookSdk {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>) => void;
}

const facebookSdk = (): FacebookSdk | undefined => (window as unknown as { FB?: FacebookSdk }).FB;

interface SignupEvent {
  type?: unknown;
  event?: unknown;
  data?: { waba_id?: unknown; current_step?: unknown; error_message?: unknown };
}

const MESSAGES: Record<string, string> = {
  unavailable: "Meta a refusé une étape. Le détail est dans les journaux du serveur ; recommencez.",
};

export function WhatsAppLink({ config, nonce }: { config: MetaSignupConfig; nonce?: string }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MetaSignupResult | null>(null);
  const pending = useRef<{ code?: string; wabaId?: string; sent?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    loadScript(SDK_SRC, nonce)
      .then(() => {
        const sdk = facebookSdk();
        if (cancelled || !sdk) return;
        sdk.init({ appId: config.appId, autoLogAppEvents: false, xfbml: false, version: config.graphVersion });
        setReady(true);
      })
      .catch(() => toast.error("Le SDK de Meta ne s'est pas chargé. Rechargez la page."));
    return () => {
      cancelled = true;
    };
  }, [config.appId, config.graphVersion, nonce]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      let origin: string;
      try {
        origin = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (origin !== "facebook.com" && !origin.endsWith(".facebook.com")) return;
      let payload: SignupEvent;
      try {
        payload = typeof event.data === "string" ? (JSON.parse(event.data) as SignupEvent) : (event.data as SignupEvent);
      } catch {
        return;
      }
      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (typeof payload.event === "string" && payload.event.startsWith("FINISH") && typeof payload.data?.waba_id === "string") {
        pending.current.wabaId = payload.data.waba_id;
        void submit();
      } else if (payload.event === "CANCEL") {
        toast.message("Parcours Meta interrompu.", { description: `Étape : ${String(payload.data?.current_step ?? "inconnue")}` });
        setBusy(false);
      } else if (payload.event === "ERROR") {
        toast.error(`Erreur Meta : ${String(payload.data?.error_message ?? "inconnue")}`);
        setBusy(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  async function submit() {
    const { code, wabaId, sent } = pending.current;
    if (!code || !wabaId || sent) return;
    pending.current.sent = true;
    try {
      const linked = await adminFetch<MetaSignupResult>(ADMIN_API.whatsapp, { method: "POST", csrf: true, body: { code, wabaId } });
      setResult(linked);
      toast.success("Compte WhatsApp relié à l'application Aalan.");
    } catch (cause) {
      toast.error(errorMessage(cause, MESSAGES));
    } finally {
      setBusy(false);
    }
  }

  function start() {
    const sdk = facebookSdk();
    if (!sdk) return;
    pending.current = {};
    setResult(null);
    setBusy(true);
    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          return;
        }
        pending.current.code = code;
        void submit();
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding" },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button type="button" onClick={start} disabled={!ready} loading={busy} className="gap-2">
          <MessageCircle className="size-4" aria-hidden="true" />
          Relier le numéro WhatsApp
        </Button>
      </div>
      {result ? (
        <div className="rounded-lg border border-border p-4 text-sm">
          <p>
            Compte WhatsApp <span className="font-mono">{result.wabaId}</span> : webhooks {result.subscribed ? "abonnés" : "non abonnés"}.
          </p>
          <ul className="mt-2 list-disc ps-5">
            {result.numbers.map((number) => (
              <li key={number.id}>
                {number.displayPhoneNumber}
                {number.verifiedName ? ` (${number.verifiedName})` : ""} : WHATSAPP_PHONE_NUMBER_ID = <span className="font-mono">{number.id}</span>
                {number.isOnBizApp ? ", coexistence active" : ""}
                {number.platformType ? `, ${number.platformType}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-foreground-muted">Reportez l&apos;identifiant et le numéro dans la configuration du serveur, puis redémarrez l&apos;application.</p>
        </div>
      ) : null}
    </div>
  );
}
