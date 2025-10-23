// services/enrichment-service.ts
// Frontend-only: calls your Node API (no direct Mongo imports).

export type TweetEnrichment = {
  _id?: any;
  tweetId: string;
  tweet_url?: string;
  tweet_datetime?: string | Date;
  account?: string;
  category: string | null;
  context: string | null;
  locations: { place: string; country: string | null; lat: number | null; lon: number | null }[];
  future_scenarios: { scenario: string; likelihood: number }[];
  knock_on_effects: { effect: string; likelihood: number }[];
  entities: { people: string[]; organizations: string[]; equipment: string[] };
  event_type: string | null;
  time_window: "past_event" | "ongoing" | "next_24h" | "next_week" | "unclear" | null;
  sentiment: number | null;
  risk_score: number | null;
  credibility: number | null;
  sources_to_verify: string[];
  confidence: number;
  needs_higher_model: boolean;
  notes: string | null;
  model_used?: string;
  updatedAt?: Date | string;
  error?: string;
  raw_snip?: string;
};

export type Tweet = {
  _id: string;
  tweetId?: string | number;
  account?: string;
  text?: string;
  datetime?: string | Date;
  url?: string;
  images?: Array<string | { url: string; alt?: string }>;
  enriched?: boolean;
  enrichmentRef?: { tweetId: string; coll: string; updatedAt: string | Date };
};

export type TweetWithEnrichment = Tweet & { enrichment?: TweetEnrichment | null };

// Resolve an absolute API base URL
function resolveApiBase(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.API_URL ||
    "";

  if (fromEnv) return fromEnv.replace(/\/$/, "");

  // Vercel-style env gives host only (no protocol)
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  // Dev default (your Express API)
  return "http://localhost:4000";
}
const API_BASE = resolveApiBase();

// Always no-store so dashboards are fresh
async function apiFetch<T>(path: string): Promise<T> {
  // Ensure absolute URL
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    if (res.status === 404) return null as unknown as T;
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Single-call helper (Option B endpoint): /api/tweets/:id?include=enrichment */
export async function getTweetWithEnrichmentById(id: string): Promise<TweetWithEnrichment | null> {
  if (!id) return null;
  return apiFetch<TweetWithEnrichment>(`/api/tweets/${encodeURIComponent(id)}?include=enrichment`);
}

/** Convenience helper if you only have tweetId (uses generic collections route) */
export async function getEnrichmentForTweetId(tweetId: string): Promise<TweetEnrichment | null> {
  if (!tweetId) return null;
  const q = encodeURIComponent(JSON.stringify({ tweetId: String(tweetId) }));
  const sort = encodeURIComponent(JSON.stringify({ updatedAt: -1 }));
  type Resp = { results?: TweetEnrichment[] };
  const resp = await apiFetch<Resp>(`/api/tweet_enrichments?q=${q}&limit=1&sort=${sort}`);
  return resp?.results?.[0] ?? null;
}
