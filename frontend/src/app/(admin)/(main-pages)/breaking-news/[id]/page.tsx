"use client";
import Link from "next/link";
import { getTiktoksForTweetId } from "@/services/tweets-service";
import {
  getTweetWithEnrichmentById,
  TweetEnrichment,
  TweetWithEnrichment,
  Tweet,
} from "@/services/enrichment-service";
import TikTokEmbed from "@/components/TikTikEmbed";
import {
  ArrowLeft,
  ExternalLink,
  Images as ImagesIcon,
  Info as InfoIcon,
  MapPin,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import Loader from "@/components/Loader";

export const dynamic = "force-dynamic";


const [loading, setLoading] = useState(true);
const [items, setItems] = useState<any[]>([]);
const [error, setError] = useState<string | null>(null);

type Props = { params: { id: string } };

function pct(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  const p = Math.round(Math.min(Math.max(n, 0), 1) * 100);
  return p;
}
function isHttp(u: string) {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function fmtDate(d?: string | number | Date) {
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

/** ---------- Nominatim geocoding helpers ---------- */

type BBox = [number, number, number, number]; // [south, north, west, east]
type GeoHit = { lat: number; lon: number; displayName: string; bbox?: BBox };

async function geocodePlace(query: string): Promise<GeoHit | null> {
  if (!query?.trim()) return null;

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
    query
  )}&limit=1`;

  const res = await fetch(url, {
    headers: {
      // Identify your app per Nominatim's usage policy
      "User-Agent": "your-app-name/1.0 (contact: you@example.com)",
    },
    // Cache server-side to be kind to the free service
    next: { revalidate: 3600 }, // 1 hour
  });

  if (!res.ok) return null;

  const hits = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    boundingbox?: [string, string, string, string]; // [south, north, west, east]
  }>;

  const hit = hits?.[0];
  if (!hit) return null;

  const bbox = hit.boundingbox?.map(Number) as BBox | undefined;

  return {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    displayName: hit.display_name,
    bbox,
  };
}

function buildPlaceString(loc: {
  place?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
}) {
  const parts = [
    loc.place?.trim(),
    loc.city?.trim(),
    loc.region?.trim(),
    loc.country?.trim(),
  ].filter(Boolean) as string[];
  const seen = new Set<string>();
  return parts.filter((p) => (seen.has(p!) ? false : (seen.add(p!), true))).join(", ");
}

/** Pick the first location that has coords or can be geocoded. */
async function resolvePrimaryGeo(
  locations?: Array<{
    place?: string | null;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    lat?: number | null;
    lon?: number | null;
  }>
): Promise<(GeoHit & { label: string }) | null> {
  if (!Array.isArray(locations) || locations.length === 0) return null;

  for (const loc of locations) {
    if (typeof loc.lat === "number" && typeof loc.lon === "number") {
      const label = buildPlaceString(loc) || `${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`;
      return { lat: loc.lat, lon: loc.lon, displayName: label, bbox: undefined, label };
    }

    const query = buildPlaceString(loc);
    if (!query) continue;

    const hit = await geocodePlace(query);
    if (hit) return { ...hit, label: query };
  }

  return null;
}

/** Build a simple OpenStreetMap iframe URL with marker + bbox fallback. */
function buildOSMEmbedSrc(lat: number, lon: number, bbox?: BBox) {
  const [south, north, west, east] =
    bbox ??
    [lat - 0.02, lat + 0.02, lon - 0.03, lon + 0.03];

  const params = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    layer: "mapnik",
    marker: `${lat},${lon}`,
  });

  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

function buildOSMViewUrl(lat: number, lon: number, zoom = 14) {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
    lat
  )}&mlon=${encodeURIComponent(lon)}#map=${zoom}/${encodeURIComponent(
    lat
  )}/${encodeURIComponent(lon)}`;
}

/** ------------------------------------------------- */

export default async function TweetDetailPage({ params }: Props) {
  const data = await getTweetWithEnrichmentById(params.id);

  if (!data) {
    return (
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/breaking-news" className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <h1 className="text-2xl font-semibold">Tweet not found</h1>
        </div>
        <p className="text-sm text-gray-600">We couldn't find that item. It might have been deleted or the link is incorrect.</p>
      </section>
    );
  }

  const tweet = data as Tweet;
  const enrichment: TweetEnrichment | null = (data as TweetWithEnrichment).enrichment ?? null;
  const tiktoks = tweet.tweetId ? await getTiktoksForTweetId(String(tweet.tweetId)) : [];

  const primaryGeo = await resolvePrimaryGeo(enrichment?.locations);

  return (
     <>
                <Loader ready={!loading} minMs={350} />

    <section className="space-y-6">
      {/* Breadcrumb / Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span>›</span>
            <Link href="/dashboard/breaking-news" className="hover:underline">Breaking News</Link>
            <span>›</span>
            <span className="truncate max-w-[40ch]" title={tweet.tweetId ? String(tweet.tweetId) : params.id}>
              {tweet.tweetId ? String(tweet.tweetId) : params.id}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Incident detail</h1>
          {tweet.datetime && (
            <p className="mt-1 text-sm text-gray-500">Updated {fmtDate(tweet.datetime)}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* NEW: Generate Content button */}
          {tweet.tweetId && (
            <Link
              href={`/generate-content?tweetId=${encodeURIComponent(String(tweet.tweetId))}`}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800"
            >
              Generate Content based on this <Sparkles className="h-4 w-4" />
            </Link>
          )}

          {tweet.url && (
            <a
              href={tweet.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              View on X <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <Link
            href="/dashboard/breaking-news"
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </div>
      </div>

      {/* Main grid: left tweet content, right enrichment */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Tweet card */}
        <div className="lg:col-span-1 rounded-2xl border bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200">
                  <span className="text-xs font-semibold text-gray-700">
                    {(tweet.account?.[0] ?? "?").toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold leading-none">{tweet.account ?? "Unknown"}</span>
                    {tweet.datetime && (
                      <time className="text-xs text-gray-500" dateTime={new Date(tweet.datetime).toISOString()}>
                        {fmtDate(tweet.datetime)}
                      </time>
                    )}
                  </div>
                </div>
              </div>

              {tweet.text && (
                <p className="mt-3 whitespace-pre-wrap break-words text-[0.95rem] leading-6 text-gray-900">
                  {tweet.text}
                </p>
              )}

              {Array.isArray(tweet.images) && tweet.images.length > 0 ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
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
                        className="relative block overflow-hidden rounded-xl ring-1 ring-gray-200 transition-transform hover:scale-[1.01]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={alt} className="h-44 w-full object-cover sm:h-52" loading="lazy" />
                      </a>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-gray-500">
                  <ImagesIcon className="h-4 w-4" /> No images attached
                </div>
              )}

              {tweet.url && (
                <a href={tweet.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600">
                  View on X <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Enrichment card (spans 2 on large) */}
        <div className="lg:col-span-2 rounded-2xl border bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">AI Enrichment</h2>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {enrichment?.model_used && <span>{enrichment.model_used}</span>}
              {enrichment?.updatedAt && <span>· {fmtDate(enrichment.updatedAt)}</span>}
            </div>
          </div>

          {!enrichment && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed bg-gray-50 p-4 text-sm text-gray-600">
              <InfoIcon className="h-4 w-4" /> No enrichment found yet for this tweet.
            </div>
          )}

          {enrichment?.error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <div className="font-medium">Enrichment error</div>
              <div className="mt-1">{enrichment.error}</div>
              {enrichment.raw_snip ? (
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 text-xs text-red-800">
                  {enrichment.raw_snip}
                </pre>
              ) : null}
            </div>
          )}

          {enrichment && !enrichment.error && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {/* Left column */}
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  {enrichment.category && (
                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
                      {enrichment.category}
                    </span>
                  )}
                  {enrichment.event_type && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs">
                      {enrichment.event_type}
                    </span>
                  )}
                  {enrichment.time_window && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs">
                      {enrichment.time_window}
                    </span>
                  )}
                </div>

                {enrichment.context && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Context</div>
                    <p className="mt-1 text-sm text-gray-800">{enrichment.context}</p>
                  </div>
                )}

                {Array.isArray(enrichment.locations) && enrichment.locations.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Locations</div>
                    <ul className="mt-1 space-y-1 text-sm text-gray-800">
                      {enrichment.locations.map((loc, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-gray-500" />
                          <span>
                            {buildPlaceString(loc) ||
                              (typeof loc.lat === "number" && typeof loc.lon === "number"
                                ? `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}`
                                : "Unknown")}
                          </span>
                          {typeof loc.lat === "number" && typeof loc.lon === "number" && (
                            <span className="text-xs text-gray-500">
                              ({loc.lat.toFixed(2)}, {loc.lon.toFixed(2)})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Right column */}
              <div className="space-y-5">
                {/* Dynamic Map (from locations -> first with coords or geocoded) */}
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="h-4 w-4" />
                    <span>
                      {primaryGeo ? primaryGeo.label : "Location not available"}
                    </span>
                  </div>

                  {primaryGeo ? (
                    <div
                      className="relative w-full overflow-hidden rounded-xl ring-1 ring-gray-200"
                      style={{ height: 320 }}
                    >
                      <iframe
                        className="h-full w-full"
                        src={buildOSMEmbedSrc(primaryGeo.lat, primaryGeo.lon, primaryGeo.bbox)}
                        loading="lazy"
                        style={{ border: 0 }}
                        referrerPolicy="no-referrer-when-downgrade"
                        title="Incident location map"
                      />
                      <a
                        href={buildOSMViewUrl(primaryGeo.lat, primaryGeo.lon, 14)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute bottom-2 right-2 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-700"
                      >
                        Open in OpenStreetMap
                      </a>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-gray-50 p-4 text-sm text-gray-600">
                      Couldn’t resolve a map position from the locations above.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Confidence</div>
                    <div className="mt-1 h-2 rounded bg-gray-200">
                      <div
                        className="h-2 rounded bg-gray-800"
                        style={{ width: `${pct(enrichment.confidence)}%` }}
                        aria-label={`Confidence ${pct(enrichment.confidence)}%`}
                      />
                    </div>
                    <div className="mt-1 text-xs text-gray-600">{pct(enrichment.confidence)}%</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Credibility</div>
                    <div className="mt-1 h-2 rounded bg-gray-200">
                      <div className="h-2 rounded bg-gray-800" style={{ width: `${pct(enrichment.credibility)}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-gray-600">{pct(enrichment.credibility)}%</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Risk</div>
                    <div className="mt-1 h-2 rounded bg-gray-200">
                      <div className="h-2 rounded bg-gray-800" style={{ width: `${pct(enrichment.risk_score)}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-gray-600">{pct(enrichment.risk_score)}%</div>
                  </div>
                </div>

                {enrichment.future_scenarios?.length ? (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Potential Future Scenarios</div>
                    <ul className="mt-1 space-y-2">
                      {enrichment.future_scenarios.map((s, i) => (
                        <li key={i} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span>• {s.scenario}</span>
                            <span className="text-xs text-gray-500">{pct(s.likelihood)}%</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded bg-gray-200">
                            <div className="h-1.5 rounded bg-gray-800" style={{ width: `${pct(s.likelihood)}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {enrichment.knock_on_effects?.length ? (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Knock-On Effects</div>
                    <ul className="mt-1 space-y-2">
                      {enrichment.knock_on_effects.map((e, i) => (
                        <li key={i} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span>• {e.effect}</span>
                            <span className="text-xs text-gray-500">{pct(e.likelihood)}%</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded bg-gray-200">
                            <div className="h-1.5 rounded bg-gray-800" style={{ width: `${pct(e.likelihood)}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {enrichment.sources_to_verify?.length ? (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Sources / Verify</div>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {enrichment.sources_to_verify.map((s, i) => {
                        const href = isHttp(s) ? s : `https://www.google.com/search?q=${encodeURIComponent(s)}`;
                        return (
                          <li key={i}>
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 break-all">
                              {s}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {enrichment.notes && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Notes</div>
                    <p className="mt-1 text-sm text-gray-800">{enrichment.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Moved: TikTok carousel now at the bottom */}
      {tiktoks.length > 0 && (
        <div className="rounded-2xl border bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-600">
            <Sparkles className="h-4 w-4" /> Related TikToks
          </div>
          <div className="w-full overflow-x-auto">
            <div className="flex snap-x snap-mandatory gap-4 pb-2">
              {tiktoks.map((tt) => (
                <div key={tt._id} className="min-w-[325px] max-w-[605px] snap-start flex-shrink-0">
                  <div className="overflow-hidden rounded-xl border">
                    <TikTokEmbed url={tt.tiktokUrl} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
    </>
  );
}
