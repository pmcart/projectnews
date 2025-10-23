// services/generate-content-service.ts
// Frontend-only client for your Generate Content API.

type Nullable<T> = T | null | undefined;

export type GenerateContentRequest = {
  tweetId: string;
  persona: string;
  sentiment: string;                 // "Negative" | "Neutral" | "Positive"
  style: string;                     // "Press Release" | "News Article" | ...
  platform?: Nullable<string>;
  region?: Nullable<string>;
  urgency?: Nullable<string>;        // "Routine" | "Time-sensitive" | "Crisis / Rapid Response"
  tone?: Nullable<string>;
  audience?: Nullable<string>;
  title?: Nullable<string>;
  comments?: Nullable<string>;
  readingLevel: number;              // e.g. 8..16
  length: number;                    // desired words
  includeQuotes: boolean;
  includeDisclaimers: boolean;
  source?: Nullable<{ url?: string | null; account?: string | null }>;
};

export type GenerateContentJob = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt?: string;
  message?: string;
};

export type GenerateContentResponse =
  | { jobId: string; status?: GenerateContentJob["status"]; message?: string }
  | { ok: true; message?: string };

function resolveApiBase(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.API_URL ||
    "";

  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:4000";
}
const API_BASE = resolveApiBase();

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  // Tolerate empty 202 responses
  try {
    return (await res.json()) as T;
  } catch {
    return { ok: true } as unknown as T;
  }
}

/**
 * Create a content-generation job.
 * Backend suggestion: POST /api/generate-content
 * Return a { jobId } or 202 Accepted with lightweight body.
 */
export async function createGenerateContentJob(
  payload: GenerateContentRequest
): Promise<GenerateContentResponse> {
  if (!payload?.tweetId) throw new Error("tweetId is required");
  return apiPost<GenerateContentResponse>("/api/generate-content", payload);
}
