"use client";

import Loader from "@/components/Loader";
import { useEffect, useMemo, useState } from "react";

type GeneratedDoc = {
  _id: string;
  tweetId: string;
  createdAt?: string;
  style?: string;
  persona?: string;
  sentiment?: "Negative" | "Neutral" | "Positive";
  platform?: string | null;
  region?: string | null;
  urgency?: string | null;
  tone?: string | null;
  audience?: string | null;
  title?: string | null;
  comments?: string | null;
  readingLevel?: number;
  length?: number;
  includeQuotes?: boolean;
  includeDisclaimers?: boolean;
  source?: any;
  tweetRef?: any;
  model?: string;
  openai?: any;
  content?: string; // present only when includeContent=1
  status?: string;
};

type ListResponse = {
  ok: boolean;
  results: GeneratedDoc[];
  nextCursor: string | null;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export default function PreviousGenerationsPage() {
  const [items, setItems] = useState<GeneratedDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // simple filters
  const [tweetId, setTweetId] = useState("");
  const [style, setStyle] = useState("");
  const [persona, setPersona] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [includeContent, setIncludeContent] = useState(false);

  async function loadPage(opts?: { cursor?: string | null; replace?: boolean }) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (opts?.cursor) params.set("cursor", opts.cursor);
      if (tweetId) params.set("tweetId", tweetId);
      if (style) params.set("style", style);
      if (persona) params.set("persona", persona);
      if (sentiment) params.set("sentiment", sentiment);
      if (includeContent) params.set("includeContent", "1");

      const res = await fetch(`${API_BASE}/api/generate-content?` + params.toString(), {
        cache: "no-store",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Request failed: ${res.status}`);
      }
      const data: ListResponse = await res.json();
      setItems((prev) =>
        opts?.replace ? data.results : [...prev, ...data.results]
      );
      setNextCursor(data.nextCursor);
    } catch (e: any) {
      setError(e?.message || "Failed to load previous generations");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    // fresh query from top
    setItems([]);
    setNextCursor(null);
    loadPage({ replace: true });
  }

  useEffect(() => {
    loadPage({ replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
        <Loader ready={!loading} minMs={350} />

    <div className="p-4 sm:p-6 2xl:p-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-title-md2 font-semibold text-black dark:text-white">
            Previous Generations
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            A chronological list of all generated outputs.
          </p>
        </div>
        <span className="inline-flex items-center rounded-md border border-stroke px-3 py-1 text-xs text-gray-700 dark:border-strokedark dark:text-gray-300">
          TailAdmin • Next.js
        </span>
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-sm border border-stroke bg-white p-4 shadow-default dark:border-strokedark dark:bg-boxdark">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <input
            className="w-full rounded border border-stroke bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
            placeholder="Filter by Tweet ID"
            value={tweetId}
            onChange={(e) => setTweetId(e.target.value)}
          />
          <select
            className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          >
            <option value="">Style — any</option>
            <option>Press Release</option>
            <option>News Article</option>
            <option>Social Media Post</option>
            <option>Speech Excerpt</option>
            <option>Op-Ed</option>
            <option>Blog Post</option>
          </select>
          <select
            className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          >
            <option value="">Persona — any</option>
            <option>Politician</option>
            <option>Government Official</option>
            <option>Security Official</option>
            <option>Journalist</option>
            <option>Media Personality</option>
            <option>NGO Spokesperson</option>
            <option>Campaign Staffer</option>
          </select>
          <select
            className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
            value={sentiment}
            onChange={(e) => setSentiment(e.target.value)}
          >
            <option value="">Sentiment — any</option>
            <option>Negative</option>
            <option>Neutral</option>
            <option>Positive</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-black dark:text-white">
            <input
              type="checkbox"
              checked={includeContent}
              onChange={(e) => setIncludeContent(e.target.checked)}
            />
            Include content
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            className="inline-flex items-center rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            onClick={applyFilters}
          >
            Apply
          </button>
          <button
            className="inline-flex items-center rounded border border-stroke px-4 py-2 text-sm font-medium text-black hover:bg-gray-50 dark:border-strokedark dark:text-white dark:hover:bg-white/5"
            onClick={() => {
              setTweetId("");
              setStyle("");
              setPersona("");
              setSentiment("");
              setIncludeContent(false);
              setItems([]);
              setNextCursor(null);
              loadPage({ replace: true });
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-4">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {items.map((d) => (
          <div
            key={d._id}
            className="rounded-sm border border-stroke bg-white p-4 shadow-default dark:border-strokedark dark:bg-boxdark"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {_fmtDate(d.createdAt)} • <span className="font-mono">{d._id}</span>
                </div>
                <div className="mt-1 text-[0.95rem] font-semibold text-black dark:text-white">
                  {d.title || `${d.style || "—"} • ${d.persona || "—"} • ${d.sentiment || "—"}`}
                </div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  tweetId: <span className="font-mono">{d.tweetId}</span> • model: <span className="font-mono">{d.model || "—"}</span> • status: {d.status || "—"}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-200">
                  {d.platform || "General"}
                </span>
                {d.region && (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-200">
                    {d.region}
                  </span>
                )}
                {typeof d.readingLevel === "number" && (
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    RL {d.readingLevel}
                  </span>
                )}
                {typeof d.length === "number" && (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                    ~{d.length}w
                  </span>
                )}
              </div>
            </div>

            {includeContent && (
              <div className="mt-3">
                <pre className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm text-gray-800 dark:bg-black/20 dark:text-gray-100">
                  {truncate(d.content || "", 1400)}
                </pre>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`${API_BASE}/api/generate-content/${d._id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded border border-stroke px-3 py-1.5 text-xs font-medium text-black hover:bg-gray-50 dark:border-strokedark dark:text-white dark:hover:bg-white/5"
              >
                View JSON
              </a>
              {includeContent && (d.content || "").length > 0 && (
                <button
                  className="inline-flex items-center rounded border border-stroke px-3 py-1.5 text-xs font-medium text-black hover:bg-gray-50 dark:border-strokedark dark:text-white dark:hover:bg-white/5"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(d.content || "");
                    } catch {}
                  }}
                >
                  Copy Content
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Pager */}
        <div className="mt-4 flex items-center justify-center">
          {nextCursor ? (
            <button
              className="inline-flex items-center rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              disabled={loading}
              onClick={() => loadPage({ cursor: nextCursor })}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          ) : (
            !loading &&
            items.length > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                End of results
              </span>
            )
          )}
        </div>

        {loading && items.length === 0 && (
          <div className="rounded border border-stroke p-4 text-sm dark:border-strokedark">
            Loading…
          </div>
        )}
      </div>
    </div>
     </>
  );
}

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function _fmtDate(d?: string) {
  try {
    if (!d) return "—";
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}
