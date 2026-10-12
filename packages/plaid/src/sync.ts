import type { PlaidProvider, PlaidTransactionRecord, RemovedTransaction, SyncPage, SyncPlan } from "./types.js";
import { PlaidProviderError } from "./types.js";

export function planSync(originalCursor: string | undefined, pages: readonly SyncPage[]): SyncPlan {
  if (pages.length === 0) throw new Error("At least one sync page is required.");
  let expectedCursor = originalCursor;
  const added = new Map<string, PlaidTransactionRecord>();
  const modified = new Map<string, PlaidTransactionRecord>();
  const removed = new Map<string, RemovedTransaction>();
  for (const page of pages) {
    if (page.requestedCursor !== expectedCursor) throw new Error("Sync page cursor chain is not contiguous.");
    for (const row of page.added) { added.set(row.transactionId, row); modified.delete(row.transactionId); removed.delete(row.transactionId); }
    for (const row of page.modified) { (added.has(row.transactionId) ? added : modified).set(row.transactionId, row); removed.delete(row.transactionId); }
    for (const row of page.removed) { added.delete(row.transactionId); modified.delete(row.transactionId); removed.set(row.transactionId, row); }
    expectedCursor = page.nextCursor;
  }
  if (pages.slice(0, -1).some((page) => !page.hasMore) || pages.at(-1)?.hasMore) throw new Error("Sync pagination is incomplete.");
  return { ...(originalCursor ? { originalCursor } : {}), nextCursor: expectedCursor!, added: [...added.values()], modified: [...modified.values()], removed: [...removed.values()] };
}

export async function fetchCompleteSync(provider: PlaidProvider, accessToken: string, originalCursor?: string, maxMutationRetries = 2): Promise<SyncPlan> {
  for (let attempt = 0; ; attempt += 1) {
    const pages: SyncPage[] = [];
    let cursor = originalCursor;
    try {
      do { const page = await provider.syncPage(accessToken, cursor); pages.push(page); cursor = page.nextCursor; } while (pages.at(-1)?.hasMore);
      return planSync(originalCursor, pages);
    } catch (error) {
      if (!(error instanceof PlaidProviderError) || error.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" || attempt >= maxMutationRetries) throw error;
    }
  }
}
