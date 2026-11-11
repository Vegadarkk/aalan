import type { Metadata } from "next";
import { headers } from "next/headers";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { requirePageStaff } from "@/lib/auth/current-user";
import { serverEnv } from "@/lib/env";
import { isPhoneVerificationConfigured, whatsappDisplayNumber } from "@/lib/phone-verify/config";
import { metaSignupConfig } from "@/lib/phone-verify/meta-signup";
import { WhatsAppLink } from "../../../_components/whatsapp-link";

// Linking Aalan's WhatsApp number to the Cloud API (Embedded Signup, coexistence with the
// WhatsApp Business app): admins only. The proxy gives this path the Facebook hosts in its CSP and
// a popup-friendly COOP (META_SIGNUP_ADMIN_PATH).

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsAppSettingsPage() {
  await requirePageStaff(["admin"]);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const env = serverEnv();
  const config = metaSignupConfig(env);
  const configured = isPhoneVerificationConfigured(env);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-muted">
          Relie le numéro WhatsApp d&apos;Aalan à l&apos;application Meta : les membres y envoient leur code de vérification. Le numéro reste utilisable
          dans l&apos;application WhatsApp Business du téléphone. Chaque liaison est inscrite au journal d&apos;audit.
        </p>
      </div>
      <p className="text-sm">
        Vérification par téléphone : {configured ? `active, numéro +${whatsappDisplayNumber(env) ?? ""}` : "inactive (numéro, identifiant ou secret manquant)"}.
      </p>
      {config ? (
        <WhatsAppLink config={config} nonce={nonce} />
      ) : (
        <ErrorBanner tone="warning" title="Liaison indisponible">
          META_APP_ID, WHATSAPP_SIGNUP_CONFIG_ID et WHATSAPP_APP_SECRET doivent être définis sur le serveur.
        </ErrorBanner>
      )}
    </>
  );
}
