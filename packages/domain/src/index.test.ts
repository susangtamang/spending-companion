import { describe, expect, it } from "vitest";

import {
  fixtureAccount,
  fixtureBudgets,
  fixtureCategories,
  fixtureExpectedSummary,
  fixtureNow,
  fixtureTransactions,
} from "@spending-companion/contracts/fixtures";
import type { Budget, FinancialAccount, Transaction } from "@spending-companion/contracts";
import {
  assertLocalDate,
  assertUsdCents,
  calculateMonthlySummary,
  normalizeMerchant,
} from "./index.js";

const includingBudget = fixtureBudgets[0]!;

function calculate(
  transactions: readonly Transaction[] = fixtureTransactions,
  budget: Budget = includingBudget,
  accounts: readonly FinancialAccount[] = [fixtureAccount],
) {
  return calculateMonthlySummary({
    month: "2026-10",
    budget,
    transactions,
    categories: fixtureCategories,
    accounts,
    policy: { timezone: "America/Chicago", calculatedAt: fixtureNow, dataFreshAsOf: fixtureNow },
  });
}

describe("validation and normalization", () => {
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])("rejects invalid cents: %s", (value) => {
    expect(() => assertUsdCents(value)).toThrow();
  });

  it("accepts zero cents", () => expect(() => assertUsdCents(0)).not.toThrow());

  it.each(["2026-02-30", "2026-13-01", "2026-1-01", "not-a-date"])("rejects invalid date %s", (date) => {
    expect(() => assertLocalDate(date)).toThrow();
  });

  it("handles leap years", () => {
    expect(() => assertLocalDate("2024-02-29")).not.toThrow();
    expect(() => assertLocalDate("2025-02-29")).toThrow();
  });

  it("normalizes merchants deterministically", () => {
    expect(normalizeMerchant("  CAFÉ & Market #42 ")).toBe("caf and market 42");
    expect(normalizeMerchant("ＡＭＡＺＯＮ   Store")).toBe("amazon store");
  });
});

describe("monthly spending summary", () => {
  it("matches the shared deterministic fixture", () => {
    const result = calculate();
    expect(result).toMatchObject({
      month: fixtureExpectedSummary.month,
      budgetCents: fixtureExpectedSummary.budgetCents,
      postedCents: fixtureExpectedSummary.postedCents,
      pendingCents: fixtureExpectedSummary.pendingCents,
      spentCents: fixtureExpectedSummary.spentCents,
      availableCents: fixtureExpectedSummary.availableCents,
      transactionCount: fixtureExpectedSummary.transactionCount,
    });
    expect(result.categoryBreakdown).toEqual(expect.arrayContaining(fixtureExpectedSummary.categoryBreakdown));
    expect(result.merchantBreakdown).toEqual(expect.arrayContaining(fixtureExpectedSummary.merchantBreakdown));
  });

  it("uses postedDate for posted and occurrenceDate for pending", () => {
    const posted = { ...fixtureTransactions[0]!, occurrenceDate: "2026-09-30", postedDate: "2026-10-01" };
    const pending = { ...fixtureTransactions[2]!, occurrenceDate: "2026-09-30" };
    const result = calculate([posted, pending]);
    expect(result.postedCents).toBe(4250);
    expect(result.pendingCents).toBe(0);
  });

  it("counts only posted or unreconciled pending purchases", () => {
    const base = fixtureTransactions[0]!;
    const excluded: Transaction[] = [
      { ...base, id: "removed", status: "removed" },
      { ...base, id: "refund", kind: "refund" },
      { ...base, id: "payment", kind: "payment" },
      { ...fixtureTransactions[2]!, id: "reconciled", reconciledToTransactionId: "posted-id" },
    ];
    expect(calculate(excluded).spentCents).toBe(0);
  });

  it("excludes utilities via category metadata and honors category overrides", () => {
    const budget: Budget = { ...includingBudget, mode: "excluding_utilities", amountCents: 170000 };
    const utilityWithRenamedDisplay = { ...fixtureCategories[2]!, name: "Power" };
    const categories = [fixtureCategories[0]!, fixtureCategories[1]!, utilityWithRenamedDisplay];
    const overridden = { ...fixtureTransactions[0]!, categoryOverrideId: "cat_utilities" };
    const result = calculateMonthlySummary({
      month: "2026-10", budget, transactions: [overridden], categories, accounts: [fixtureAccount],
      policy: { timezone: "America/Chicago", calculatedAt: fixtureNow },
    });
    expect(result.spentCents).toBe(0);
  });

  it("excludes disabled and unknown financial accounts but includes accountless manual entries", () => {
    const disabled = { ...fixtureAccount, includeInSpending: false };
    const unknown = { ...fixtureTransactions[0]!, financialAccountId: "missing" };
    const manual = { ...fixtureTransactions[1]! };
    delete (manual as { financialAccountId?: string }).financialAccountId;
    expect(calculate([fixtureTransactions[0]!, unknown, manual], includingBudget, [disabled]).spentCents).toBe(650);
  });

  it("reconciles category and merchant breakdowns exactly", () => {
    const result = calculate();
    const sum = (rows: readonly { amountCents: number }[]) => rows.reduce((total, row) => total + row.amountCents, 0);
    expect(sum(result.categoryBreakdown)).toBe(result.spentCents);
    expect(sum(result.merchantBreakdown)).toBe(result.spentCents);
  });

  it("reports negative availability and positive overspending", () => {
    const result = calculate(fixtureTransactions, { ...includingBudget, amountCents: 5000 });
    expect(result.availableCents).toBe(-2899);
    expect(result.overspentCents).toBe(2899);
  });

  it("requires supported US timezone policy", () => {
    expect(() => calculateMonthlySummary({
      month: "2026-10", budget: includingBudget, transactions: [], categories: [], accounts: [],
      policy: { timezone: "Europe/London" as "America/Chicago", calculatedAt: fixtureNow },
    })).toThrow("supported US timezone");
  });

  it("marks missing or old freshness timestamps stale", () => {
    const base = { month: "2026-10" as const, budget: includingBudget, transactions: [], categories: [], accounts: [] };
    expect(calculateMonthlySummary({ ...base, policy: { timezone: "America/Chicago", calculatedAt: fixtureNow } }).isStale).toBe(true);
    expect(calculateMonthlySummary({ ...base, policy: {
      timezone: "America/Chicago", calculatedAt: fixtureNow, dataFreshAsOf: "2026-10-07T17:59:59.999Z",
    } }).isStale).toBe(true);
  });
});
