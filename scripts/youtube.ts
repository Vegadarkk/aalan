// Aalan's internal YouTube publishing tool (channel @aalan_ma, owner 6 Nov 2026): the social-media
// threads publish the brand's own videos through the YouTube Data API with the owner's OAuth client
// (Google Cloud project aalan-social). It reads AALAN_YOUTUBE_CLIENT_ID, AALAN_YOUTUBE_CLIENT_SECRET
// and AALAN_YOUTUBE_REFRESH_TOKEN and never prints them. Until Google's API audit, uploads from this
// project are forced to private by YouTube, whatever --privacy says.
//
//   node scripts/youtube.ts channel                     channel id, handle, counters
//   node scripts/youtube.ts videos                      latest uploads with their privacy status
//   node scripts/youtube.ts upload <file.mp4> --title "…" [--description-file f.txt] [--tags a,b]
//        [--privacy private|unlisted|public] [--synthetic] [--apply]      dry run without --apply
//
// In the cloud, run with NODE_USE_ENV_PROXY=1.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnvProxy } from "./env-proxy.ts";
import { requireOwnerVar } from "./owner-env.ts";

export const PRIVACY = ["private", "unlisted", "public"] as const;
export type Privacy = (typeof PRIVACY)[number];

export interface UploadOptions {
  title: string;
  description: string;
  tags: string[];
  privacy: Privacy;
  /** AI-generated or altered realistic content (Seedance, Higgsfield): YouTube requires the disclosure. */
  synthetic: boolean;
}

export interface VideoResource {
  snippet: { title: string; description: string; tags?: string[]; categoryId: string; defaultLanguage: string; defaultAudioLanguage: string };
  status: { privacyStatus: Privacy; selfDeclaredMadeForKids: false; containsSyntheticMedia: boolean; embeddable: true };
}

const VIDEO_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };

/** Validates the options against YouTube's limits and builds the videos.insert body. */
export function buildVideoResource(options: UploadOptions): { resource?: VideoResource; errors: string[] } {
  const errors: string[] = [];
  const title = options.title.trim();
  if (!title) errors.push("--title is required");
  if (title.length > 100) errors.push(`title is ${title.length} characters, YouTube allows 100`);
  if (/[<>]/.test(title) || /[<>]/.test(options.description)) errors.push("YouTube rejects < and > in the title and description");
  if (Buffer.byteLength(options.description, "utf8") > 5000) errors.push("description is over 5,000 bytes");
  const tags = options.tags.map((tag) => tag.trim()).filter(Boolean);
  if (tags.join(",").length > 500) errors.push("tags are over 500 characters in all");
  if (!PRIVACY.includes(options.privacy)) errors.push(`--privacy must be one of ${PRIVACY.join(", ")}`);
  if (errors.length > 0) return { errors };
  return {
    errors,
    resource: {
      // 22 = People & Blogs; French is the channel's default language.
      snippet: { title, description: options.description, ...(tags.length > 0 ? { tags } : {}), categoryId: "22", defaultLanguage: "fr", defaultAudioLanguage: "fr" },
      status: { privacyStatus: options.privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: options.synthetic, embeddable: true },
    },
  };
}

export function videoContentType(file: string): string | undefined {
  return VIDEO_TYPES[extname(file).toLowerCase()];
}

/** Parses `--name value` and bare `--flag` options after the command's positional arguments. */
export function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && !["--apply", "--synthetic"].includes(arg)) {
      flags.set(arg.slice(2), next);
      i++;
    } else {
      flags.set(arg.slice(2), true);
    }
  }
  return { positional, flags };
}

async function accessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: requireOwnerVar("YOUTUBE_CLIENT_ID"),
    client_secret: requireOwnerVar("YOUTUBE_CLIENT_SECRET"),
    refresh_token: requireOwnerVar("YOUTUBE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const json = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !json.access_token) throw new Error(`token refresh failed: ${json.error ?? response.status} ${json.error_description ?? ""}`.trim());
  return json.access_token;
}

async function api<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { authorization: `Bearer ${token}` } });
  const json = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`YouTube API ${response.status}: ${json.error?.message ?? "unknown error"}`);
  return json;
}

interface Channel {
  id: string;
  snippet: { title: string; customUrl?: string };
  statistics: { viewCount: string; subscriberCount: string; videoCount: string };
  status: { privacyStatus: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
}

async function myChannel(token: string): Promise<Channel> {
  const { items } = await api<{ items?: Channel[] }>(token, "channels?part=id,snippet,statistics,status,contentDetails&mine=true");
  if (!items?.[0]) throw new Error("no channel on this account");
  return items[0];
}

async function upload(token: string, file: string, resource: VideoResource, contentType: string): Promise<{ id: string; status: { privacyStatus: string; uploadStatus: string } }> {
  const size = statSync(file).size;
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(size),
      "x-upload-content-type": contentType,
    },
    body: JSON.stringify(resource),
  });
  const session = start.headers.get("location");
  if (!start.ok || !session) throw new Error(`upload session refused: ${start.status} ${await start.text()}`);
  const response = await fetch(session, { method: "PUT", headers: { "content-type": contentType, "content-length": String(size) }, body: readFileSync(file) });
  const json = (await response.json()) as { id: string; status: { privacyStatus: string; uploadStatus: string }; error?: { message?: string } };
  if (!response.ok) throw new Error(`upload failed: ${response.status} ${json.error?.message ?? ""}`);
  return json;
}

async function main(): Promise<void> {
  requireEnvProxy();
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const flag = (name: string): string | undefined => (typeof flags.get(name) === "string" ? (flags.get(name) as string) : undefined);

  if (command === "channel") {
    const channel = await myChannel(await accessToken());
    console.log(`${channel.id}  ${channel.snippet.title}  ${channel.snippet.customUrl ?? ""}  ${channel.status.privacyStatus}`);
    console.log(`views ${channel.statistics.viewCount}, subscribers ${channel.statistics.subscriberCount}, videos ${channel.statistics.videoCount}`);
    return;
  }

  if (command === "videos") {
    const token = await accessToken();
    const uploads = (await myChannel(token)).contentDetails.relatedPlaylists.uploads;
    const { items = [] } = await api<{ items?: { contentDetails: { videoId: string } }[] }>(token, `playlistItems?part=contentDetails&maxResults=20&playlistId=${uploads}`);
    if (items.length === 0) return console.log("no uploads yet");
    const ids = items.map((item) => item.contentDetails.videoId).join(",");
    const videos = await api<{ items: { id: string; snippet: { title: string; publishedAt: string }; status: { privacyStatus: string } }[] }>(token, `videos?part=snippet,status&id=${ids}`);
    for (const video of videos.items) console.log(`${video.id}  ${video.status.privacyStatus.padEnd(8)}  ${video.snippet.publishedAt}  ${video.snippet.title}`);
    return;
  }

  if (command === "upload") {
    const file = positional[0];
    if (!file) throw new Error("usage: scripts/youtube.ts upload <file.mp4> --title \"…\" [--apply]");
    const contentType = videoContentType(file);
    if (!contentType) throw new Error(`unsupported file type ${extname(file)}: ${Object.keys(VIDEO_TYPES).join(", ")}`);
    const descriptionFile = flag("description-file");
    const { resource, errors } = buildVideoResource({
      title: flag("title") ?? "",
      description: descriptionFile ? readFileSync(descriptionFile, "utf8").trim() : (flag("description") ?? ""),
      tags: (flag("tags") ?? "").split(","),
      privacy: (flag("privacy") ?? "private") as Privacy,
      synthetic: flags.has("synthetic"),
    });
    if (!resource) throw new Error(errors.join("\n"));
    console.log(`${basename(file)} (${(statSync(file).size / 1e6).toFixed(1)} MB, ${contentType})`);
    console.log(JSON.stringify(resource, null, 2));
    if (!flags.has("apply")) return console.log("\nDry run: nothing uploaded. Add --apply to upload to the channel.");
    const video = await upload(await accessToken(), file, resource, contentType);
    console.log(`\nUploaded https://youtu.be/${video.id} (${video.status.uploadStatus}, ${video.status.privacyStatus})`);
    if (video.status.privacyStatus !== resource.status.privacyStatus) console.log("YouTube kept the video private: uploads stay private until Google's API audit.");
    return;
  }

  throw new Error("usage: scripts/youtube.ts <channel|videos|upload> (see the header of the file)");
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
