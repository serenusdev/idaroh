import { Skeleton } from "@/components/ui/skeleton";

export default function KehadiranLoading() {
  return (
    <div className="flex flex-col w-full pb-10 max-w-7xl mx-auto space-y-4" aria-hidden="true">
      <Skeleton className="h-36 rounded-2xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
        <div className="space-y-4">
          <div className="bg-card rounded-2xl p-5 border border-border space-y-3">
            <Skeleton className="h-5 w-48" />
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
