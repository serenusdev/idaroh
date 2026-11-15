import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense loading skeleton for the laporan page.
 */
export default function LaporanLoading() {
  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-24" aria-hidden="true">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column skeleton */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-card rounded-xl p-5 border border-border space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-28 rounded-full" />
              <Skeleton className="h-7 w-28 rounded-full" />
            </div>
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-14 rounded-lg" />
          </div>
        </div>
        {/* Right column skeleton */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-card rounded-xl p-5 border border-border space-y-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
          <div className="bg-card rounded-xl p-5 border border-border space-y-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
