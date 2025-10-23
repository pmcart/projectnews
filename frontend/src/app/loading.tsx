export default function Loading() {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/5 dark:bg-white/5">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}