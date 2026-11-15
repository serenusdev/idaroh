import { Skeleton } from "@/components/ui/skeleton";

export default function JadwalLoading() {
  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-24" aria-hidden="true">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-12 max-w-md rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <div className="lg:col-span-7 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
