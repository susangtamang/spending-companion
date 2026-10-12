import type { BankingStore } from "./types.js";
import type { BankingService } from "./service.js";

export interface SyncWorkerOptions {
  readonly batchSize?: number;
  readonly staleAfterMs?: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

export interface SyncWorkerResult {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
}

/** One bounded worker pass; the process scheduler controls polling cadence. */
export class BankingSyncWorker {
  private readonly batchSize: number;
  private readonly staleAfterMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  public constructor(
    private readonly store: BankingStore,
    private readonly service: BankingService,
    options: SyncWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 10;
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.now = options.now ?? (() => new Date());
  }

  public async runOnce(): Promise<SyncWorkerResult> {
    const claimedAt = this.now();
    const jobs = await this.store.claimSyncJobs({
      limit: this.batchSize,
      staleBefore: new Date(claimedAt.valueOf() - this.staleAfterMs),
      maxAttempts: this.maxAttempts,
      claimedAt,
    });
    let completed = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        await this.service.processSyncJob(job);
        completed += 1;
      } catch {
        failed += 1;
      }
    }
    return { claimed: jobs.length, completed, failed };
  }
}
