import { cn } from "../../lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-3", className)} />;
}

/** Placeholder card matching a notification row's silhouette. */
export function CardSkeleton() {
  return (
    <div className="rounded-card border border-transparent bg-surface-2/60 p-[var(--card-pad)]">
      <div className="flex items-start gap-2.5">
        <Skeleton className="size-7 rounded-lg" />
        <div className="flex-1 space-y-2 pt-0.5">
          <Skeleton className="w-3/4" />
          <Skeleton className="w-full" />
          <Skeleton className="w-1/3" />
        </div>
      </div>
    </div>
  );
}
