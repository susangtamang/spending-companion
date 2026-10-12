import { describe, expect, it } from "vitest";
import {
  CSV_HEADER,
  planCommit,
  planUndo,
  previewCsv,
  sourceIdentityKey,
  type PreviewCsvOptions,
} from "../src/index.js";

const header = CSV_HEADER.join(",");
const baseOptions: PreviewCsvOptions = {
  batchId: "batch-001",
  fileName: "checking.csv",
  userId: "user-001",
  financialAccountId: "account-001",
  importContext: "first-bank-checking",
  now: "2026-10-09T18:00:00.000Z",
  existing: [],
  transactionIdForRow: (row, sourceId) => `transaction-${row}-${sourceId}`,
};

describe("CSV preview", () => {
  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const preview = previewCsv(
      `${header}\nsource-1,2026-10-09,"Bob's ""Market"", West\nSide",12.34,posted,groceries,purchase`,
      baseOptions,
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.disposition).toBe("valid");
    expect(preview.rows[0]?.transaction?.displayMerchant).toBe("Bob's \"Market\", West\nSide");
    expect(preview.rows[0]?.transaction?.amountCents).toBe(1234);
  });

  it("reports malformed quoted input instead of producing a transaction", () => {
    const preview = previewCsv(`${header}\nsource-1,2026-10-09,"Unclosed,12.34,posted,,purchase`, baseOptions);
    expect(preview.rows.some((row) => row.errors.some((error) => error.code === "malformed_csv"))).toBe(true);
    expect(preview.rows.every((row) => row.disposition === "invalid")).toBe(true);
  });

  it("rejects invalid headers, amounts, and actual calendar dates", () => {
    const wrongHeader = previewCsv("id,date,merchant,amount,status,category,kind\n1,2026-10-09,A,1.00,posted,,purchase", baseOptions);
    expect(wrongHeader.rows[0]?.errors[0]?.code).toBe("invalid_header");

    const preview = previewCsv(`${header}\nsource-1,2026-02-29,Store,1.001,posted,,purchase`, baseOptions);
    expect(preview.rows[0]?.errors.map((error) => error.code)).toEqual(["invalid_date", "invalid_amount"]);

    const leap = previewCsv(`${header}\nsource-1,2028-02-29,Store,1,posted,,purchase`, baseOptions);
    expect(leap.rows[0]?.disposition).toBe("valid");
  });

  it("marks repeated source IDs in one batch as duplicates", () => {
    const preview = previewCsv(
      `${header}\nsame,2026-10-01,One,1.00,posted,,purchase\nsame,2026-10-02,Two,2.00,posted,,purchase`,
      baseOptions,
    );
    expect(preview.rows.map((row) => row.disposition)).toEqual(["valid", "duplicate"]);
  });

  it("deduplicates only within user, source, account, and import context scope", () => {
    const identity = { ...baseOptions, sourceId: "existing" };
    const csv = `${header}\nexisting,2026-10-01,Store,1.00,posted,,purchase`;
    const duplicate = previewCsv(csv, { ...baseOptions, existing: [identity] });
    expect(duplicate.rows[0]?.disposition).toBe("duplicate");

    const otherAccount = previewCsv(csv, {
      ...baseOptions,
      existing: [{ ...identity, financialAccountId: "account-002" }],
    });
    expect(otherAccount.rows[0]?.disposition).toBe("valid");
    expect(sourceIdentityKey(identity)).not.toBe(sourceIdentityKey({ ...identity, importContext: "other" }));
  });

  it("returns row-level validation errors without hiding valid rows", () => {
    const preview = previewCsv(
      `${header}\ngood,2026-10-01,Store,5.25,pending,,purchase\nbad,2026-13-01,,x,cancelled,,unknown`,
      baseOptions,
    );
    expect(preview.rows[0]?.disposition).toBe("valid");
    expect(preview.rows[1]?.disposition).toBe("invalid");
    expect(preview.batch).toMatchObject({ totalRows: 2, duplicateRows: 0, invalidRows: 1 });
    expect(preview.rows[1]?.errors.length).toBeGreaterThan(1);
  });
});

describe("atomic storage plans", () => {
  it("creates a commit plan containing only valid transactions", () => {
    const preview = previewCsv(
      `${header}\ngood,2026-10-01,Store,5.25,posted,,purchase\nbad,2026-02-30,Store,1.00,posted,,purchase`,
      baseOptions,
    );
    const plan = planCommit(preview, "2026-10-09T18:01:00.000Z");
    expect(plan.replay).toBe(false);
    expect(plan.transactions.map((transaction) => transaction.sourceTransactionId)).toEqual(["good"]);
    expect(plan.batch).toMatchObject({ status: "committed", importedRows: 1 });
  });

  it("returns the same commit plan for an idempotent retry and rejects changed content", () => {
    const preview = previewCsv(`${header}\none,2026-10-01,Store,5.25,posted,,purchase`, baseOptions);
    const first = planCommit(preview, "2026-10-09T18:01:00.000Z");
    const retry = planCommit(preview, "ignored", {
      batchId: preview.batch.id,
      fingerprint: preview.fingerprint,
      committedAt: first.batch.committedAt ?? "",
    });
    expect(retry).toMatchObject({ replay: true, batch: first.batch, transactions: first.transactions });

    const changed = previewCsv(`${header}\ntwo,2026-10-01,Store,5.25,posted,,purchase`, baseOptions);
    expect(() => planCommit(changed, "ignored", {
      batchId: preview.batch.id,
      fingerprint: preview.fingerprint,
      committedAt: first.batch.committedAt ?? "",
    })).toThrow(/Idempotency conflict/);
  });

  it("plans a deterministic undo and treats a repeated undo as a replay", () => {
    const preview = previewCsv(`${header}\none,2026-10-01,Store,5.25,posted,,purchase`, baseOptions);
    const commit = planCommit(preview, "2026-10-09T18:01:00.000Z");
    const first = planUndo(commit.batch, ["b", "a", "a"], "2026-10-09T18:02:00.000Z");
    expect(first).toEqual({
      kind: "undo",
      replay: false,
      batchId: "batch-001",
      transactionIds: ["a", "b"],
      undoneAt: "2026-10-09T18:02:00.000Z",
    });
    const undone = { ...commit.batch, status: "undone" as const, undoneAt: first.undoneAt };
    expect(planUndo(undone, ["b", "a"], "ignored")).toMatchObject({ replay: true, undoneAt: first.undoneAt });
  });
});
