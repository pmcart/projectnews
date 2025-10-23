"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { TweetDoc } from "@/services/tweets-service";
import { getTweetByTweetId } from "@/services/tweets-service";
import type { GenerateContentRequest } from "@/services/generate-content-service";
import Loader from "@/components/Loader";

// TailAdmin-friendly, dependency-free page (pure Tailwind classes)
// Route: app/(dashboard)/generate-content/page.tsx
// Assumes TailAdmin base styles (colors, dark mode, border-stroke, boxdark, etc.) are available.

export default function GenerateContentPage() {
  const search = useSearchParams();
  const router = useRouter();
  const tweetId = search.get("tweetId") || "";

  // --- Load tweet details by tweetId ---
  const [tweet, setTweet] = useState<TweetDoc | null>(null);
  const [tLoading, setTLoading] = useState<boolean>(!!tweetId);
  const [tError, setTError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!tweetId) return;
      setTLoading(true);
      setTError(null);
      try {
        const t = await getTweetByTweetId(String(tweetId));
        if (!cancelled) setTweet(t);
      } catch (e: any) {
        if (!cancelled) setTError(e?.message || "Failed to load tweet");
      } finally {
        if (!cancelled) setTLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [tweetId]);

  // --- Form state ---
  const [persona, setPersona] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [style, setStyle] = useState("");
  const [platform, setPlatform] = useState("");
  const [region, setRegion] = useState("");
  const [urgency, setUrgency] = useState("");
  const [tone, setTone] = useState("");
  const [audience, setAudience] = useState("");
  const [title, setTitle] = useState("");
  const [comments, setComments] = useState("");
  const [readingLevel, setReadingLevel] = useState(8);
  const [length, setLength] = useState(250);
  const [includeQuotes, setIncludeQuotes] = useState(true);
  const [includeDisclaimers, setIncludeDisclaimers] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [copied, setCopied] = useState(false);

  // --- Submit state ---
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobInfo, setJobInfo] = useState<{ jobId?: string; message?: string } | null>(null);

  // --- API response preview state ---
  const [apiContent, setApiContent] = useState<string>("");
  const [apiModel, setApiModel] = useState<string>("");
  const [apiId, setApiId] = useState<string>("");
  const [previewTab, setPreviewTab] = useState<"request" | "response" | "json">("request");

  const commentsLimit = 1200;
  const disabled = !persona || !sentiment || !style;
  const overLimit = comments.length > commentsLimit;

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000"}/api/generate-content?limit=20`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setItems(data.results || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    const lines: string[] = [];
    if (title) lines.push(`Title: ${title}`);
    if (persona) lines.push(`Persona: ${persona}`);
    if (platform) lines.push(`Platform: ${platform}`);
    if (style) lines.push(`Style: ${style}`);
    if (tone) lines.push(`Tone: ${tone}`);
    if (sentiment) lines.push(`Sentiment: ${sentiment}`);
    if (audience) lines.push(`Target Audience: ${audience}`);
    if (region) lines.push(`Region/Country: ${region}`);
    if (urgency) lines.push(`Urgency: ${urgency}`);
    lines.push(`Reading Level (grade): ${readingLevel}`);
    lines.push(`Approx Length (words): ${length}`);
    lines.push(`Include Quotes: ${includeQuotes ? "Yes" : "No"}`);
    lines.push(`Include Disclaimers: ${includeDisclaimers ? "Yes" : "No"}`);
    if (tweetId) lines.push(`Source Tweet ID: ${tweetId}`);
    if (tweet?.url) lines.push(`Source URL: ${tweet.url}`);
    if (comments) lines.push("Additional Notes:\n" + comments);
    return lines.join("\n");
  }, [title, persona, platform, style, tone, sentiment, audience, region, urgency, readingLevel, length, includeQuotes, includeDisclaimers, comments, tweetId, tweet?.url]);

  function resetForm() {
    setPersona("");
    setSentiment("");
    setStyle("");
    setPlatform("");
    setRegion("");
    setUrgency("");
    setTone("");
    setAudience("");
    setTitle("");
    setComments("");
    setReadingLevel(8);
    setLength(250);
    setIncludeQuotes(true);
    setIncludeDisclaimers(false);
    setIsPreviewing(false);
    setCopied(false);
    setJobInfo(null);
    setSubmitError(null);
    setApiContent("");
    setApiModel("");
    setApiId("");
    setPreviewTab("request");
  }

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  }

  // --- Build payload matching GenerateContentRequest
  function buildPayload(): GenerateContentRequest {
    return {
      tweetId: tweetId,
      persona,
      sentiment,
      style,
      platform: platform || undefined,
      region: region || undefined,
      urgency: urgency || undefined,
      tone: tone || undefined,
      audience: audience || undefined,
      title: title || undefined,
      comments: comments || undefined,
      readingLevel,
      length,
      includeQuotes,
      includeDisclaimers,
      source: tweet
        ? {
            url: tweet.url ?? undefined,
            account: tweet.account ?? undefined,
          }
        : undefined,
    } as GenerateContentRequest;
  }

  // --- Submit to API and capture direct content for preview
  async function handleSubmit() {
    setSubmitError(null);
    setJobInfo(null);
    try {
      setSubmitting(true);
      const payload = buildPayload();

      const res = await fetch("http://localhost:4000/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed with ${res.status}`);
      }

      const data: {
        ok?: boolean;
        content?: string;
        model?: string;
        id?: string;
        jobId?: string;
        message?: string;
      } = await res.json();

      // Populate response preview
      if (typeof data?.content === "string") {
        setApiContent(data.content);
        setApiModel(data.model ?? "");
        setApiId(data.id ?? "");
        setIsPreviewing(true);
        setPreviewTab("response");
      }

      // Optional legacy job bubble
      const info = data?.jobId
        ? { jobId: data.jobId, message: data.message }
        : (data?.message ? { message: data.message } : null);
      setJobInfo(info ?? null);
    } catch (e: any) {
      setSubmitError(e?.message || "Failed to create job");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !disabled && !!tweetId && !overLimit && !submitting;

  return (
    <>
    <Loader ready={!loading} minMs={350} />

    <div className="p-4 sm:p-6 2xl:p-10">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-title-md2 font-semibold text-black dark:text-white">Generate Content</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Compose outputs using the source tweet and your settings.</p>
        </div>
        <span className="inline-flex items-center rounded-md border border-stroke px-3 py-1 text-xs text-gray-700 dark:border-strokedark dark:text-gray-300">TailAdmin • Next.js</span>
      </div>

      {/* Source Tweet */}
      <div className="mb-6 rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-strokedark dark:bg-boxdark">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-medium text-black dark:text-white">Source Tweet</h3>
          {tweet?.url ? (
            <a href={tweet.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600">
              View on X
            </a>
          ) : null}
        </div>

        {!tweetId && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
            Missing <span className="font-semibold">tweetId</span> in the URL. Example: <code className="ml-1 rounded bg-white/60 px-1">/generate-content?tweetId=1234</code>
          </div>
        )}

        {tweetId && tLoading && <div className="rounded border border-stroke p-4 text-sm dark:border-strokedark">Loading tweet…</div>}

        {tweetId && tError && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{tError}</div>}

        {tweetId && !tLoading && !tError && tweet && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-1">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200">
                  <span className="text-xs font-semibold text-gray-700">{(tweet.account?.[0] ?? "?").toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <div className="font-semibold leading-none">{tweet.account ?? "Unknown"}</div>
                  {tweet.datetime && <div className="text-xs text-gray-500">{new Date(tweet.datetime).toLocaleString()}</div>}
                </div>
              </div>
            </div>
            <div className="md:col-span-2">
              {tweet.text ? (
                <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-6 text-gray-900">{tweet.text}</p>
              ) : (
                <p className="text-sm text-gray-500">No text available.</p>
              )}

              {Array.isArray(tweet.images) && tweet.images.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {tweet.images.map((img: any, idx: number) => {
                    const url = typeof img === "string" ? img : img?.url;
                    if (!url) return null;
                    const alt = typeof img === "object" && img?.alt ? img.alt : "tweet image";
                    return (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-xl ring-1 ring-gray-200 transition-transform hover:scale-[1.01]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={alt} className="h-40 w-full object-cover sm:h-48" loading="lazy" />
                      </a>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left column: Controls */}
        <div className="col-span-12 xl:col-span-6">
          <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-strokedark dark:bg-boxdark">
            <div className="mb-5">
              <h3 className="text-lg font-medium text-black dark:text-white">Content Settings</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose persona, sentiment, style, and refine with optional fields.</p>
            </div>

            {/* 3 core selects */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Persona</label>
                <div className="relative">
                  <select
                    className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                  >
                    <option value="" disabled>
                      Select persona
                    </option>
                    <option>Politician</option>
                    <option>Government Official</option>
                    <option>Security Official</option>
                    <option>Journalist</option>
                    <option>Media Personality</option>
                    <option>NGO Spokesperson</option>
                    <option>Campaign Staffer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Sentiment</label>
                <select
                  className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                  value={sentiment}
                  onChange={(e) => setSentiment(e.target.value)}
                >
                  <option value="" disabled>
                    Select sentiment
                  </option>
                  <option>Negative</option>
                  <option>Neutral</option>
                  <option>Positive</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Style</label>
                <select
                  className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  <option value="" disabled>
                    Select style
                  </option>
                  <option>Press Release</option>
                  <option>News Article</option>
                  <option>Social Media Post</option>
                  <option>Speech Excerpt</option>
                  <option>Op-Ed</option>
                  <option>Blog Post</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Platform (optional)</label>
                <select
                  className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                >
                  <option value="">—</option>
                  <option>General Web</option>
                  <option>Twitter / X</option>
                  <option>Facebook</option>
                  <option>Instagram</option>
                  <option>LinkedIn</option>
                  <option>TikTok</option>
                </select>
              </div>
            </div>

            {/* Region / Urgency */}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Region / Country (optional)</label>
                <input
                  className="w-full rounded border border-stroke bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                  placeholder="e.g., Ireland, EU"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Urgency (optional)</label>
                <select
                  className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value)}
                >
                  <option value="">—</option>
                  <option>Routine</option>
                  <option>Time-sensitive</option>
                  <option>Crisis / Rapid Response</option>
                </select>
              </div>
            </div>

            {/* Tone / Audience */}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Tone (optional)</label>
                <select
                  className="w-full rounded border border-stroke bg-transparent py-2.5 pl-3 pr-8 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  <option value="">—</option>
                  <option>Formal</option>
                  <option>Conversational</option>
                  <option>Inspiring</option>
                  <option>Analytical</option>
                  <option>Conciliatory</option>
                  <option>Assertive</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-black dark:text-white">Target Audience (optional)</label>
                <input
                  className="w-full rounded border border-stroke bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                  placeholder="e.g., local voters, journalists"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </div>
            </div>

            {/* Title */}
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-black dark:text-white">Working Title (optional)</label>
              <input
                className="w-full rounded border border-stroke bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                placeholder="Add a short title or headline"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Comments */}
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm font-medium text-black dark:text-white">Additional Comments</label>
                <span className={`text-xs ${overLimit ? "text-red-500" : "text-gray-500 dark:text-gray-400"}`}>{comments.length}/{commentsLimit}</span>
              </div>
              <textarea
                rows={6}
                className="w-full rounded border border-stroke bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-primary dark:border-strokedark dark:text-white"
                placeholder="Key facts, quotes, URLs, talking points, do/don'ts..."
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
              {overLimit && (
                <p className="mt-1 text-xs text-red-500">Comments exceed the {commentsLimit} character limit.</p>
              )}
            </div>

            {/* Sliders */}
            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-black dark:text-white">Reading Level (grade)</span>
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{readingLevel}</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={1}
                  value={readingLevel}
                  onChange={(e) => setReadingLevel(parseInt(e.target.value, 10))}
                  className="range w-full"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-black dark:text-white">Approx Length (words)</span>
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{length}</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={1200}
                  step={25}
                  value={length}
                  onChange={(e) => setLength(parseInt(e.target.value, 10))}
                  className="range w-full"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex items-start gap-3 rounded border border-stroke p-3 dark:border-strokedark">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={includeQuotes} onChange={(e) => setIncludeQuotes(e.target.checked)} />
                <span className="text-sm text-black dark:text-white">
                  <span className="font-medium">Include Attributed Quotes</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">Use short, verifiable quotes if provided.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded border border-stroke p-3 dark:border-strokedark">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={includeDisclaimers}
                  onChange={(e) => setIncludeDisclaimers(e.target.checked)}
                />
                <span className="text-sm text-black dark:text-white">
                  <span className="font-medium">Include Legal/Context Disclaimers</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">Add sourcing or context notes automatically.</span>
                </span>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                className="inline-flex items-center rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                onClick={() => setIsPreviewing(true)}
                disabled={disabled}
              >
                Generate Preview
              </button>
              <button
                className="inline-flex items-center rounded border border-stroke px-4 py-2 text-sm font-medium text-black hover:bg-gray-50 dark:border-strokedark dark:text-white dark:hover:bg-white/5 disabled:opacity-50"
                onClick={copyConfig}
                disabled={!isPreviewing}
              >
                {copied ? "Copied" : "Copy Config"}
              </button>
              <button
                className="inline-flex items-center rounded px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                onClick={resetForm}
              >
                Reset
              </button>
            </div>

            {/* Submit to API action + inline feedback */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="inline-flex items-center rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                title={!tweetId ? "Tweet ID required" : overLimit ? "Comments too long" : disabled ? "Fill required fields" : ""}
              >
                {submitting ? "Sending…" : "Send to API"}
              </button>
              {jobInfo?.jobId && (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">Job created: <span className="font-mono">{jobInfo.jobId}</span></span>
              )}
              {!jobInfo?.jobId && jobInfo?.message && (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">{jobInfo.message}</span>
              )}
              {submitError && <span className="text-xs text-red-600">{submitError}</span>}
            </div>

            <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
              Heads‑up: This posts to <code>http://localhost:4000/api/generate-content</code>. You can proxy through Next.js or set <code>NEXT_PUBLIC_API_BASE_URL</code> if needed.
            </div>
          </div>
        </div>

        {/* Right column: Preview */}
        <div className="col-span-12 xl:col-span-6">
          <div className="rounded-sm border border-stroke bg-white p-6 shadow-default dark:border-strokedark dark:bg-boxdark">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-black dark:text-white">Preview</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review the composed request and the API response.</p>
              </div>
              <span
                className={`rounded-md px-2 py-1 text-xs ${isPreviewing ? "bg-primary/10 text-primary" : "border border-stroke text-gray-600 dark:border-strokedark dark:text-gray-300"}`}
              >
                {isPreviewing ? "Ready" : "Waiting"}
              </span>
            </div>

            {!isPreviewing ? (
              <div className="rounded border border-dashed border-stroke p-10 text-center text-sm text-gray-500 dark:border-strokedark dark:text-gray-400">
                Configure the left panel and click <span className="font-medium">Generate Preview</span>.
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="mb-3 flex gap-2">
                  <button
                    className={`rounded px-3 py-1 text-xs font-medium ${previewTab === "request" ? "bg-primary/10 text-primary" : "border border-stroke text-gray-600 dark:border-strokedark dark:text-gray-300"}`}
                    onClick={() => setPreviewTab("request")}
                  >
                    Request
                  </button>
                  <button
                    className={`rounded px-3 py-1 text-xs font-medium ${previewTab === "response" ? "bg-primary/10 text-primary" : "border border-stroke text-gray-600 dark:border-strokedark dark:text-gray-300"}`}
                    onClick={() => setPreviewTab("response")}
                    disabled={!apiContent}
                    title={!apiContent ? "Send to API first" : ""}
                  >
                    Response
                  </button>
                  <button
                    className={`rounded px-3 py-1 text-xs font-medium ${previewTab === "json" ? "bg-primary/10 text-primary" : "border border-stroke text-gray-600 dark:border-strokedark dark:text-gray-300"}`}
                    onClick={() => setPreviewTab("json")}
                  >
                    JSON
                  </button>
                </div>

                {previewTab === "request" && (
                  <pre className="whitespace-pre-wrap rounded bg-gray-50 p-4 text-sm text-gray-800 dark:bg-black/20 dark:text-gray-100">{summary}</pre>
                )}

                {previewTab === "response" && (
                  apiContent ? (
                    <div className="space-y-2">
                      {(apiModel || apiId) && (
                        <div className="rounded border border-stroke p-2 text-xs text-gray-600 dark:border-strokedark dark:text-gray-300">
                          {apiModel && <span className="mr-3">model: <span className="font-mono">{apiModel}</span></span>}
                          {apiId && <span>id: <span className="font-mono">{apiId}</span></span>}
                        </div>
                      )}
                      <pre className="whitespace-pre-wrap rounded bg-gray-50 p-4 text-sm text-gray-800 dark:bg-black/20 dark:text-gray-100">{apiContent}</pre>
                      <div className="flex gap-2">
                        <button
                          className="inline-flex items-center rounded border border-stroke px-3 py-1.5 text-xs font-medium text-black hover:bg-gray-50 dark:border-strokedark dark:text-white dark:hover:bg_white/5"
                          onClick={async () => {
                            try { await navigator.clipboard.writeText(apiContent); } catch {}
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded border border-dashed border-stroke p-10 text-center text-sm text-gray-500 dark:border-strokedark dark:text-gray-400">
                      No response yet. Click <span className="font-medium">Send to API</span>.
                    </div>
                  )
                )}

                {previewTab === "json" && (
                  <div id="json-tab" className="mt-2">
                    <h4 className="mb-2 text-sm font-semibold text-black dark:text-white">JSON</h4>
                    <pre className="overflow-x-auto rounded bg-gray-50 p-4 text-xs text-gray-800 dark:bg-black/20 dark:text-gray-100">{JSON.stringify(
                      {
                        persona,
                        sentiment,
                        style,
                        platform: platform || undefined,
                        region: region || undefined,
                        tone: tone || undefined,
                        audience: audience || undefined,
                        urgency: urgency || undefined,
                        title: title || undefined,
                        comments: comments || undefined,
                        readingLevel,
                        length,
                        includeQuotes,
                        includeDisclaimers,
                        source: tweet ? { tweetId: tweetId || undefined, url: tweet.url || undefined, account: tweet.account || undefined } : undefined,
                      },
                      null,
                      2
                    )}</pre>
                  </div>
                )}

                {/* Validation + Tips */}
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded border border-stroke p-3 dark:border-strokedark">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Validation</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-black dark:text-white">
                      <li className={persona ? "" : "text-red-500"}>Persona selected</li>
                      <li className={sentiment ? "" : "text-red-500"}>Sentiment selected</li>
                      <li className={style ? "" : "text-red-500"}>Style selected</li>
                    </ul>
                  </div>
                  <div className="rounded border border-stroke p-3 dark:border-strokedark">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Tips</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-black dark:text-white">
                      <li>Confirm key facts from the source tweet and include links.</li>
                      <li>Adjust tone + reading level for audience fit.</li>
                      <li>Use Platform for format constraints (e.g., character limits).</li>
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
