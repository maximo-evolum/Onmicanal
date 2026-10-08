type ImportSelection = { selected?: boolean; reviewDirty?: boolean; staleReview?: boolean; account: { bankKey?: string }; preview: { duplicate?: { blocked?: boolean } | null; periodProtection?: { blocked?: boolean } | null } };
export function canIncorporateSelectedImports(items: ImportSelection[]) {
  const selected = items.filter(item => item.selected);
  return selected.length > 0 && selected.every(item => item.account.bankKey && !item.reviewDirty && !item.staleReview && !item.preview.duplicate?.blocked && !item.preview.periodProtection?.blocked);
}

type ImportJobState = { id: string; revision: number; status: string; updatedAt: string };
// Polling and manual requests may finish out of order. Never replace a newer
// revision (or state within that revision) with an older network response.
export function mergeImportJobs<T extends ImportJobState>(current: T[], incoming: T[]): T[] {
  const jobs = new Map(current.map(job => [job.id, job]));
  for (const job of incoming) {
    const previous = jobs.get(job.id);
    const newer = !previous || job.revision > previous.revision ||
      (job.revision === previous.revision && Date.parse(job.updatedAt) >= Date.parse(previous.updatedAt));
    if (newer) jobs.set(job.id, job);
  }
  const ids = [...new Set([...incoming.map(job => job.id), ...current.map(job => job.id)])];
  return ids.map(id => jobs.get(id)!);
}

export function invalidateImportReviews<T extends { id: string; staleReview?: boolean; preview: { revision: number } }>(reviews: T[], jobs: ImportJobState[]): T[] {
  const byId = new Map(jobs.map(job => [job.id, job]));
  return reviews.map(review => {
    const job = byId.get(review.id);
    if (!job || job.revision < review.preview.revision) return review;
    return job.revision !== review.preview.revision || job.status !== 'READY'
      ? { ...review, staleReview: true } : review;
  });
}
export function filterLoadedImports<T extends { sourceFile: string; status: string }>(items: T[], query: string, status: string) {
  const term = query.trim().toLocaleLowerCase("es");
  return items.filter(item => (status === "ALL" || item.status === status) && item.sourceFile.toLocaleLowerCase("es").includes(term));
}
