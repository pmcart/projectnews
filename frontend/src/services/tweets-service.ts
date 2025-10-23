// services/tweets-service.ts
const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "";

// Shapes returned by your Node API (Mongo documents)
export type TweetDoc = {
  _id: string;
  account: string;
  text: string;
  datetime?: string;
  url?: string;
  tweetId?: string;
  images?: Array<string | { url: string; alt?: string }>;
  // ...any other fields you store
};

export type TweetTiktok = {
  _id: string;
  tweetId: string;
  tiktokId?: string;
  tiktokUrl: string;
  tiktokDesc?: string;
  tiktokUsername?: string;
  tiktokCreateTime?: string;
};

type ListResponse<T> = {
  results: T[];
  total: number;
  limit: number;
  page: number;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Request failed: ${res.status}. ${detail}`);
  }
  return res.json() as Promise<T>;
}

// List newest tweets and INCLUDE images explicitly
export async function getBreakingNewsTweets(): Promise<TweetDoc[]> {
  const sort = encodeURIComponent(JSON.stringify({ datetime: -1 }));
  const fields = encodeURIComponent(
    // make sure images is in the projection
    ["_id", "account", "datetime", "text", "images", "url", "tweetId"].join(",")
  );
  const data = await api<ListResponse<TweetDoc>>(
    `/api/tweets?limit=50&sort=${sort}&fields=${fields}`
  );
  return data.results;
}

// Single tweet by Mongo _id (returns the full doc; adjust fields if you want)
export async function getTweetById(id: string): Promise<TweetDoc | null> {
  try {
    return await api<TweetDoc>(`/api/tweets/${id}`);
  } catch (e: any) {
    if (String(e?.message || "").startsWith("Request failed: 404")) return null;
    throw e;
  }
}

export async function getTweetByTweetId(tweetId: string): Promise<TweetDoc | null> {
  const q = encodeURIComponent(JSON.stringify({ tweetId: String(tweetId) }));
  const data = await api<ListResponse<TweetDoc>>(`/api/tweets?q=${q}&limit=1`);
  return data.results?.[0] ?? null;
}

// Related TikToks by tweets.tweetId
export async function getTiktoksForTweetId(tweetId: string): Promise<TweetTiktok[]> {
  const q = encodeURIComponent(JSON.stringify({ tweetId }));
  const data = await api<ListResponse<TweetTiktok>>(
    `/api/tweet_tiktoks?q=${q}&limit=100`
  );
  return data.results;
}
