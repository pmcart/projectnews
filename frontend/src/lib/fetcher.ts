import { Tweet } from "./types";

// lib/fetcher.ts
export async function getBreakingNewsTweets(): Promise<Tweet[]> {
const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/tweets`, {
// For freshest data during dev; adjust caching per your needs
cache: "no-store",
});


if (!res.ok) throw new Error("Failed to fetch breaking news");
return res.json();
}