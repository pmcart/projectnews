"use client";
import Link from "next/link";
import { getBreakingNewsTweets } from "@/services/tweets-service"; // keep your existing service path
import { ExternalLink, ArrowRight, Image as ImageIcon } from "lucide-react";
import Loader from "@/components/Loader";
import { useState } from "react";


export const dynamic = "force-dynamic";

const [loading, setLoading] = useState(true);
const [items, setItems] = useState<any[]>([]);
const [error, setError] = useState<string | null>(null);
  
type AnyObj = Record<string, any>;
function initials(name?: string) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts[1]?.[0] ?? "";
  return (first + last).toUpperCase() || first.toUpperCase() || "?";
}

function formatDateTime(d?: string | number | Date) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(d);
  }
}

function extractImageUrls(item: AnyObj): string[] {
  const urls: string[] = [];

  // 1) images: string[] | { url: string }[]
  if (Array.isArray(item.images)) {
    for (const it of item.images) {
      if (typeof it === "string" && it) urls.push(it);
      else if (it && typeof it === "object" && typeof it.url === "string") urls.push(it.url);
    }
  }

  // 2) Common alternates
  const altKeys = ["imageUrls", "media_urls", "mediaUrls", "photos"];
  for (const k of altKeys) {
    const val = (item as AnyObj)[k];
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string" && v) urls.push(v);
        else if (v && typeof v === "object" && typeof v.url === "string") urls.push(v.url);
      }
    }
  }

  // 3) De-dupe
  return Array.from(new Set(urls.filter(Boolean)));
}

export default async function BreakingNewsPage() {
  // We assume your service returns raw Mongo docs (with fields like _id, account, datetime, text, images, ...)
  const tweets: AnyObj[] = await getBreakingNewsTweets();

  return (
      <>
            <Loader ready={!loading} minMs={350} />

    <section className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Breaking News</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live feed of high-signal updates. Auto-refreshed on load.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Go to Dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Empty state */}
      {tweets.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
            <ImageIcon className="h-5 w-5" />
          </div>
          No breaking news tweets right now. Check back soon.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {tweets.map((t) => {
            const imgUrls = extractImageUrls(t);
            const id = t._id ?? t.id ?? t.tweetId;
            const author = t.account ?? t.author ?? "Unknown";

            return (
              <li key={id} className="group rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: content */}
                  <div className="min-w-0 flex-1">
                    {/* Author row */}
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 ring-1 ring-border">
                        <span className="text-xs font-semibold text-foreground/80">
                          {initials(author)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold leading-none">{author}</span>
                          {t.datetime && (
                            <time className="text-xs text-muted-foreground" dateTime={new Date(t.datetime).toISOString()}>
                              {formatDateTime(t.datetime)}
                            </time>
                          )}
                        </div>
                        {t.source && (
                          <div className="mt-0.5 text-xs text-muted-foreground/80">{t.source}</div>
                        )}
                      </div>
                    </div>

                    {/* Text */}
                    {t.text && (
                      <p className="mt-3 whitespace-pre-wrap break-words text-[0.95rem] leading-6 text-foreground">
                        {t.text}
                      </p>
                    )}

                    {/* Images */}
                    {imgUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {imgUrls.map((url: string, idx: number) => (
                          <a
                            key={idx}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="relative block overflow-hidden rounded-xl ring-1 ring-border transition-transform hover:scale-[1.01]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt="tweet image"
                              loading="lazy"
                              className="h-40 w-full object-cover sm:h-44"
                            />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Meta (optional fields safe-guarded) */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                      {typeof t.category === "string" && (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5">{t.category}</span>
                      )}
                      {t.metrics?.retweets != null && (
                        <span>RT: {t.metrics.retweets}</span>
                      )}
                      {t.metrics?.likes != null && <span>Likes: {t.metrics.likes}</span>}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Link
                      href={`/breaking-news/${id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
                    >
                      Open <ArrowRight className="h-4 w-4" />
                    </Link>
                    {t.url && (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        Original <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Collapsible debug (optional) */}
                {process.env.NODE_ENV !== "production" && (
                  <details className="mt-3 text-xs text-muted-foreground/90">
                    <summary className="cursor-pointer select-none">Debug</summary>
                    <div className="mt-2 space-y-1">
                      <div>images found: {imgUrls.length}</div>
                      {imgUrls.length > 0 && (
                        <ul className="list-disc pl-5">
                          {imgUrls.map((u, i) => (
                            <li key={i} className="truncate">
                              <a href={u} target="_blank" rel="noopener noreferrer" className="underline">
                                {u}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
      </>
  );
}
