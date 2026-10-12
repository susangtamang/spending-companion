import type {
  Budget,
  Category,
  FinancialAccount,
  IsoDateTime,
  LocalDate,
  MoneyBreakdown,
  MonthlySummary,
  Transaction,
  UsdCents,
  YearMonth,
} from "@spending-companion/contracts";

export const SUPPORTED_US_TIMEZONES = [
  "America/New_York",
  "America/Detroit",
  "America/Indiana/Indianapolis",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Adak",
  "Pacific/Honolulu",
] as const;

export type SupportedUsTimezone = (typeof SUPPORTED_US_TIMEZONES)[number];

export interface SummaryPolicy {
  readonly timezone: SupportedUsTimezone;
  readonly calculatedAt: IsoDateTime;
  readonly dataFreshAsOf?: IsoDateTime;
  readonly staleAfterMinutes?: number;
}

export interface CalculateMonthlySummaryInput {
  readonly month: YearMonth;
  readonly budget: Budget;
  readonly transactions: readonly Transaction[];
  readonly categories: readonly Category[];
  readonly accounts: readonly FinancialAccount[];
  readonly policy: SummaryPolicy;
}

export function assertUsdCents(value: number, field = "amountCents"): asserts value is UsdCents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(field, "must be a non-negative safe integer number of USD cents");
  }
}

export function assertLocalDate(value: string, field = "date"): asserts value is LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new DomainValidationError(field, "must use YYYY-MM-DD format");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new DomainValidationError(field, "must be a real calendar date");
  }
}

export function assertYearMonth(value: string, field = "month"): asserts value is YearMonth {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new DomainValidationError(field, "must use YYYY-MM format with a real month");
  }
}

export function assertIsoDateTime(value: string, field: string): asserts value is IsoDateTime {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new DomainValidationError(field, "must be an ISO-8601 UTC timestamp");
  }
}

export function normalizeMerchant(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function validateTransaction(transaction: Transaction): void {
  if (!transaction.id.trim()) throw new DomainValidationError("id", "is required");
  if (!transaction.userId.trim()) throw new DomainValidationError("userId", "is required");
  if (transaction.currencyCode !== "USD") throw new DomainValidationError("currencyCode", "must be USD");
  assertUsdCents(transaction.amountCents, `${transaction.id}.amountCents`);
  assertLocalDate(transaction.occurrenceDate, `${transaction.id}.occurrenceDate`);
  if (transaction.postedDate !== undefined) assertLocalDate(transaction.postedDate, `${transaction.id}.postedDate`);
  if (transaction.status === "posted" && transaction.postedDate === undefined) {
    throw new DomainValidationError(`${transaction.id}.postedDate`, "is required for posted transactions");
  }
  if (!transaction.displayMerchant.trim()) {
    throw new DomainValidationError(`${transaction.id}.displayMerchant`, "is required");
  }
  const expectedMerchant = normalizeMerchant(transaction.displayMerchant);
  if (!expectedMerchant || transaction.normalizedMerchant !== expectedMerchant) {
    throw new DomainValidationError(`${transaction.id}.normalizedMerchant`, "does not match deterministic normalization");
  }
}

export function transactionMonth(transaction: Transaction): YearMonth {
  validateTransaction(transaction);
  const date = transaction.status === "posted" ? transaction.postedDate! : transaction.occurrenceDate;
  return date.slice(0, 7);
}

export function calculateMonthlySummary(input: CalculateMonthlySummaryInput): MonthlySummary {
  validateInputs(input);
  const categories = uniqueMap(input.categories, "category");
  const accounts = uniqueMap(input.accounts, "account");
  const eligible: Transaction[] = [];

  for (const transaction of input.transactions) {
    validateTransaction(transaction);
    if (transaction.kind !== "purchase") continue;
    if (transaction.status !== "posted" && transaction.status !== "pending") continue;
    if (transaction.status === "pending" && transaction.reconciledToTransactionId !== undefined) continue;
    if (transactionMonth(transaction) !== input.month) continue;

    if (transaction.financialAccountId !== undefined) {
      const account = accounts.get(transaction.financialAccountId);
      if (!account || !account.includeInSpending) continue;
    }

    const category = resolveCategory(transaction, categories);
    if (input.budget.mode === "excluding_utilities" && category?.isUtility === true) continue;
    eligible.push(transaction);
  }

  let postedCents = 0;
  let pendingCents = 0;
  for (const transaction of eligible) {
    if (transaction.status === "posted") postedCents = safeAdd(postedCents, transaction.amountCents);
    else pendingCents = safeAdd(pendingCents, transaction.amountCents);
  }
  const spentCents = safeAdd(postedCents, pendingCents);
  const availableCents = input.budget.amountCents - spentCents;
  if (!Number.isSafeInteger(availableCents)) throw new DomainValidationError("availableCents", "exceeds safe integer range");

  const categoryBreakdown = buildBreakdown(eligible, (transaction) => {
    const category = resolveCategory(transaction, categories);
    return { id: category?.id ?? "uncategorized", label: category?.name ?? "Uncategorized" };
  });
  const merchantBreakdown = buildBreakdown(eligible, (transaction) => ({
    id: transaction.normalizedMerchant,
    label: transaction.displayMerchant.trim(),
  }));
  assertBreakdownTotal(categoryBreakdown, spentCents, "categoryBreakdown");
  assertBreakdownTotal(merchantBreakdown, spentCents, "merchantBreakdown");

  const staleAfterMinutes = input.policy.staleAfterMinutes ?? 60 * 24;
  if (!Number.isFinite(staleAfterMinutes) || staleAfterMinutes < 0) {
    throw new DomainValidationError("staleAfterMinutes", "must be a non-negative finite number");
  }
  const isStale = input.policy.dataFreshAsOf === undefined
    || Date.parse(input.policy.calculatedAt) - Date.parse(input.policy.dataFreshAsOf) > staleAfterMinutes * 60_000;

  return {
    month: input.month,
    timezone: input.policy.timezone,
    budgetMode: input.budget.mode,
    budgetCents: input.budget.amountCents,
    postedCents,
    pendingCents,
    spentCents,
    availableCents,
    overspentCents: Math.max(0, -availableCents),
    transactionCount: eligible.length,
    categoryBreakdown,
    merchantBreakdown,
    calculatedAt: input.policy.calculatedAt,
    ...(input.policy.dataFreshAsOf === undefined ? {} : { dataFreshAsOf: input.policy.dataFreshAsOf }),
    isStale,
  };
}

function validateInputs(input: CalculateMonthlySummaryInput): void {
  assertYearMonth(input.month);
  if (!SUPPORTED_US_TIMEZONES.includes(input.policy.timezone)) {
    throw new DomainValidationError("timezone", "must be a supported US timezone");
  }
  assertIsoDateTime(input.policy.calculatedAt, "calculatedAt");
  if (input.policy.dataFreshAsOf !== undefined) assertIsoDateTime(input.policy.dataFreshAsOf, "dataFreshAsOf");
  assertUsdCents(input.budget.amountCents, "budget.amountCents");
  if (input.budget.month !== undefined) {
    assertYearMonth(input.budget.month, "budget.month");
    if (input.budget.month !== input.month) throw new DomainValidationError("budget.month", "must match requested month");
  }
}

function uniqueMap<T extends { readonly id: string }>(values: readonly T[], name: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) throw new DomainValidationError(`${name}.id`, `duplicate ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

function resolveCategory(transaction: Transaction, categories: ReadonlyMap<string, Category>): Category | undefined {
  const id = transaction.categoryOverrideId ?? transaction.sourceCategoryId;
  return id === undefined ? undefined : categories.get(id);
}

function buildBreakdown(
  transactions: readonly Transaction[],
  identify: (transaction: Transaction) => { readonly id: string; readonly label: string },
): MoneyBreakdown[] {
  const totals = new Map<string, { label: string; amountCents: number; transactionCount: number }>();
  for (const transaction of transactions) {
    const identity = identify(transaction);
    const existing = totals.get(identity.id);
    totals.set(identity.id, {
      label: existing === undefined || identity.label < existing.label ? identity.label : existing.label,
      amountCents: safeAdd(existing?.amountCents ?? 0, transaction.amountCents),
      transactionCount: (existing?.transactionCount ?? 0) + 1,
    });
  }
  return [...totals.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((left, right) => right.amountCents - left.amountCents || left.id.localeCompare(right.id, "en-US"));
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainValidationError("total", "exceeds safe integer range");
  return result;
}

function assertBreakdownTotal(breakdown: readonly MoneyBreakdown[], expected: number, field: string): void {
  const actual = breakdown.reduce((total, row) => safeAdd(total, row.amountCents), 0);
  if (actual !== expected) throw new DomainValidationError(field, "does not reconcile to spentCents");
}

export class DomainValidationError extends Error {
  public constructor(public readonly field: string, message: string) {
    super(`${field} ${message}`);
    this.name = "DomainValidationError";
  }
}
