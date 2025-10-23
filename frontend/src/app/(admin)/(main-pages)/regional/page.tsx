"use client";
import Link from "next/link";
import { ExternalLink, ArrowRight, Image as ImageIcon } from "lucide-react";
import { getRegionalNews, type NewsDoc } from "@/services/regional-news.service";
import { useState } from "react";
import Loader from "@/components/Loader";

export const dynamic = "force-dynamic";

const COUNTRY_OPTIONS = [
  { value: "us", label: "United States" },
  { value: "ie", label: "Ireland" },
  { value: "gb", label: "United Kingdom" },
  { value: "ca", label: "Canada" },
  { value: "au", label: "Australia" },
  { value: "in", label: "India" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "it", label: "Italy" },
  { value: "es", label: "Spain" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "All" }, // empty == omit -> us_all
  { value: "world", label: "World" },
  { value: "nation", label: "Nation" },
  { value: "business", label: "Business" },
  { value: "technology", label: "Technology" },
  { value: "entertainment", label: "Entertainment" },
  { value: "science", label: "Science" },
  { value: "sports", label: "Sports" },
  { value: "health", label: "Health" },
];

const [loading, setLoading] = useState(true);
const [items, setItems] = useState<any[]>([]);
const [error, setError] = useState<string | null>(null);

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts[1]?.[0] ?? "";
  return (first + last).toUpperCase() || first.toUpperCase() || "?";
}

function formatDateTime(d?: string | number | Date | null) {
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

type PageProps = {
  searchParams?: {
    region?: string;
    category?: string;
    limit?: string;
  };
};

export default async function RegionalNewsPage({ searchParams }: PageProps) {
  const region = (searchParams?.region ?? "us").toLowerCase();
  const category = searchParams?.category?.toLowerCase(); // if missing -> server returns us_all
  const limit = Number(searchParams?.limit ?? "50");

  const articles: NewsDoc[] = await getRegionalNews({ region, category, limit });

  return (
         <>
                    <Loader ready={!loading} minMs={350} />
    

    <section className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Regional News</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {region.toUpperCase()} · {category ? category : "all"} — latest articles from your feed.
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

      {/* Filters */}
      <form
        action="/regional"
        method="GET"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-end"
      >
        {/* keep current limit unless user changes it elsewhere */}
        <input type="hidden" name="limit" value={String(limit)} />

        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Country</label>
          <select
            name="region"
            defaultValue={region}
            className="block w-full rounded-xl border bg-background px-3 py-2 text-sm"
          >
            {COUNTRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
          <select
            name="category"
            defaultValue={category ?? ""}
            className="block w-full rounded-xl border bg-background px-3 py-2 text-sm"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:pb-[2px]">
          <button
            type="submit"
            className="mt-2 inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground sm:mt-0"
          >
            OK
          </button>
        </div>
      </form>

      {/* Empty state */}
      {articles.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
            <ImageIcon className="h-5 w-5" />
          </div>
          No articles found for {region.toUpperCase()} {category ? `· ${category}` : "· all"}.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {articles.map((a, idx) => {
            const id = String(a._id ?? idx);
            const href = a.resolvedLink || a.link || "#";
            const sourceName =
              a.sourceName ||
              (href && href !== "#"
                ? new URL(href).hostname.replace(/^www\./, "")
                : "Source");

            return (
              <li
                key={id}
                className="group rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: content */}
                  <div className="min-w-0 flex-1">
                    {/* Source row */}
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 ring-1 ring-border">
                        <span className="text-xs font-semibold text-foreground/80">
                          {initials(sourceName)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold leading-none">{sourceName}</span>
                          {a.pubDate && (
                            <time
                              className="text-xs text-muted-foreground"
                              dateTime={new Date(a.pubDate).toISOString()}
                            >
                              {formatDateTime(a.pubDate)}
                            </time>
                          )}
                        </div>
                        {(a.region || a.category) && (
                          <div className="mt-0.5 text-xs text-muted-foreground/80">
                            {[a.region, a.category].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Title */}
                    {a.title && (
                      <h3 className="mt-3 text-[1.05rem] font-semibold leading-6">
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-4 hover:underline"
                        >
                          {a.title}
                        </a>
                      </h3>
                    )}

                    {/* Description */}
                    {a.description && (
                      <p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">
                        {a.description}
                      </p>
                    )}

                    {/* Chips */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                      {typeof a.category === "string" && a.category.length > 0 && (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                          {a.category}
                        </span>
                      )}
                      {a.sourceUrl && (
                        <a
                          href={a.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 hover:bg-accent hover:text-accent-foreground"
                        >
                          Source site <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
                    >
                      Open <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>

                {/* Collapsible debug (optional) */}
                {process.env.NODE_ENV !== "production" && (
                  <details className="mt-3 text-xs text-muted-foreground/90">
                    <summary className="cursor-pointer select-none">Debug</summary>
                    <div className="mt-2 space-y-1">
                      <div>resolvedLink: {a.resolvedLink ?? "-"}</div>
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
