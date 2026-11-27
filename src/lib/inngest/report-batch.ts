export const REPORT_BATCH_CHUNK_SIZE = 10;

export function chunk<T>(items: T[], size = REPORT_BATCH_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Chunk size must be positive");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

export interface BatchStepRunner<R> { run(name: string, work: () => Promise<R>): Promise<R>; }

export async function runReportBatch<T, R>(items: T[], runner: BatchStepRunner<R[]>, render: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (const [chunkIndex, group] of chunk(items).entries()) {
    const result = await runner.run(`generate-report-cards-${chunkIndex + 1}`, async () => {
      const output: R[] = [];
      for (const item of group) output.push(await render(item));
      return output;
    });
    results.push(...result);
  }
  return results;
}
