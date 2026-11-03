import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/config/site";
import fr from "../../messages/fr.json";

// Web app manifest (audit zone 8 P1, zone 2 L2): "Add to home screen" on Android gets the door icon
// and the brand colours instead of a generic letter. Served at /manifest.webmanifest, outside the
// locales (the proxy matcher skips .webmanifest); start_url "/" lets the proxy pick the language.
// Icons from scripts/brand-assets.ts.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: fr.Metadata.title,
    short_name: SITE_NAME,
    description: fr.Metadata.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f2e9d8",
    theme_color: "#f2e9d8",
    lang: "fr",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/aalan-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
