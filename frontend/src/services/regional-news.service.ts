// services/news-service.ts
const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "";

export type NewsDoc = {
  _id?: string;
  title?: string;
  link?: string;          // Google News redirect link
  resolvedLink?: string;  // final publisher url (if your job enriches it)
  description?: string | null;
  imageURL?: string | null;
  pubDate?: string | Date | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  region?: string;
  category?: string;
};

type NewsListResponse = {
  region: string;
  category: string;
  collection: string;
  total: number;
  limit: number;
  skip: number;
  results: NewsDoc[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Request failed: ${res.status}. ${detail}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch regional news from your Node API.
 * If category is omitted -> server returns <region>_all.
 */
export async function getRegionalNews(params: {
  region?: string;
  category?: string;
  limit?: number;
  skip?: number;
}) : Promise<NewsDoc[]> {
  const region = (params.region ?? "us").toLowerCase();
  const qs = new URLSearchParams();
  qs.set("region", region);
  if (params.category) qs.set("category", params.category.toLowerCase());
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.skip != null) qs.set("skip", String(params.skip));

  const data = await api<NewsListResponse>(`/api/news?${qs.toString()}`);
  return data.results;
}
