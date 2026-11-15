import { Skeleton } from "@/components/ui/skeleton";

export default function TugasLoading() {
  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-24" aria-hidden="true">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-12 max-w-lg rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
        <div className="lg:col-span-8 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
