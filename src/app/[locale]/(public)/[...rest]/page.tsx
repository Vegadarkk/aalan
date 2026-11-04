import { notFound } from "next/navigation";

// Thrown from generateMetadata too: Next then resolves the tab title from not-found.tsx
// ("Page introuvable | Aalan"); thrown only while rendering, the head keeps the site default.
export async function generateMetadata(): Promise<never> {
  notFound();
}

// Unknown localized paths render the localized 404 inside the site chrome.
export default function CatchAll() {
  notFound();
}
