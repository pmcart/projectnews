// components/TikTokEmbed.tsx
"use client";

import { useEffect, useState } from "react";

type Props = {
  url: string; // e.g. https://www.tiktok.com/@username/video/1234567890
};

export default function TikTokEmbed({ url }: Props) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // create a unique ID for this embed
    const embedId = `tiktok-embed-${Math.random().toString(36).slice(2)}`;

    // callback: wait a bit for TikTok to render, then mark loaded
    const timer = setTimeout(() => setLoaded(true), 2000);

    // inject script (or re-run)
    if (!document.querySelector("#tiktok-embed-script")) {
      const script = document.createElement("script");
      script.src = "https://www.tiktok.com/embed.js";
      script.async = true;
      script.id = "tiktok-embed-script";
      document.body.appendChild(script);
    } else {
      const script = document.createElement("script");
      script.src = "https://www.tiktok.com/embed.js";
      script.async = true;
      document.body.appendChild(script);
    }

    return () => clearTimeout(timer);
  }, [url]);

  return (
    <div className="relative w-full">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl border bg-gray-100">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"></div>
        </div>
      )}

      <blockquote
        className="tiktok-embed"
        cite={url}
        data-video-id={url.split("/").pop()}
        style={{ maxWidth: "605px", minWidth: "325px" }}
      >
        <a href={url}>View on TikTok</a>
      </blockquote>
    </div>
  );
}
