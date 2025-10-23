"use client";

import { useEffect, useRef, useState } from "react";

type InitialLoaderProps = {
  /** When true, the loader hides. If omitted, it hides right after hydration. */
  ready?: boolean;
  /** Minimum time (ms) the loader should stay visible to avoid flicker. Default 250. */
  minMs?: number;
  /** Optional delay (ms) before showing (helps avoid flash on super-fast pages). Default 0. */
  delayMs?: number;
  /** Optional: custom overlay className */
  className?: string;
};

export default function Loader({
  ready,
  minMs = 250,
  delayMs = 0,
  className,
}: InitialLoaderProps) {
  const [mounted, setMounted] = useState(false);        // hydration complete
  const [visible, setVisible] = useState(true);         // overlay visibility
  const startRef = useRef<number | null>(null);
  const delayTimer = useRef<any>(null);

  // Mark hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Start timer when we actually show
  useEffect(() => {
    if (!mounted) return;
    if (delayMs > 0) {
      delayTimer.current = setTimeout(() => {
        if (startRef.current == null) startRef.current = Date.now();
        setVisible(true);
      }, delayMs);
      // Hide immediately if ready during delay
      if (ready) {
        clearTimeout(delayTimer.current);
        setVisible(false);
      }
    } else {
      if (startRef.current == null) startRef.current = Date.now();
      setVisible(true);
    }
    return () => clearTimeout(delayTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Decide when to hide
  useEffect(() => {
    if (!mounted) return;
    const nowReady = ready ?? true; // if ready is undefined, hide right after hydration cycle
    if (!nowReady) return;

    const finish = () => setVisible(false);

    const elapsed = startRef.current ? Date.now() - startRef.current : 0;
    const remaining = Math.max(0, minMs - elapsed);

    const t = setTimeout(finish, remaining);
    return () => clearTimeout(t);
  }, [mounted, ready, minMs]);

  if (!visible) return null;

  return (
    <div
      className={
        className ??
        "fixed inset-0 z-[9998] grid place-items-center bg-white/75 dark:bg-black/60 backdrop-blur-sm"
      }
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      {/* Spinner */}
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
