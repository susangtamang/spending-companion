import type {
  BankConnection,
  Budget,
  Category,
  FinancialAccount,
  MonthlySummary,
  ReconciliationCandidate,
  Transaction,
} from "./index.js";

export const fixtureUserId = "user_fixture_001";
export const fixtureNow = "2026-10-09T18:00:00.000Z";

export const fixtureCategories = [
  { id: "cat_groceries", name: "Groceries", isUtility: false },
  { id: "cat_dining", name: "Dining", isUtility: false },
  { id: "cat_utilities", name: "Utilities", isUtility: true },
].map((category): Category => ({
  ...category,
  isSystem: true,
  createdAt: fixtureNow,
  updatedAt: fixtureNow,
}));

export const fixtureConnection: BankConnection = {
  id: "connection_fixture_001",
  userId: fixtureUserId,
  provider: "plaid",
  institutionId: "ins_109508",
  institutionName: "First Platypus Bank",
  health: "healthy",
  consentVersion: "v1",
  consentedAt: fixtureNow,
  lastSuccessfulSyncAt: fixtureNow,
  createdAt: fixtureNow,
  updatedAt: fixtureNow,
};

export const fixtureAccount: FinancialAccount = {
  id: "account_fixture_checking",
  userId: fixtureUserId,
  connectionId: fixtureConnection.id,
  sourceAccountId: "plaid_account_fixture_checking",
  name: "Plaid Checking",
  mask: "0000",
  type: "checking",
  includeInSpending: true,
  currencyCode: "USD",
  createdAt: fixtureNow,
  updatedAt: fixtureNow,
};

const transactionBase = {
  userId: fixtureUserId,
  financialAccountId: fixtureAccount.id,
  source: "plaid" as const,
  kind: "purchase" as const,
  currencyCode: "USD" as const,
  createdAt: fixtureNow,
  updatedAt: fixtureNow,
};

export const fixtureTransactions: readonly Transaction[] = [
  {
    ...transactionBase,
    id: "transaction_posted_grocery",
    sourceTransactionId: "plaid_tx_001",
    status: "posted",
    amountCents: 4250,
    rawMerchant: "WALMART #1234",
    displayMerchant: "Walmart",
    normalizedMerchant: "walmart",
    sourceCategoryId: "cat_groceries",
    occurrenceDate: "2026-10-03",
    postedDate: "2026-10-04",
  },
  {
    ...transactionBase,
    id: "transaction_posted_dining",
    sourceTransactionId: "plaid_tx_002",
    status: "posted",
    amountCents: 650,
    rawMerchant: "STARBUCKS STORE 001",
    displayMerchant: "Starbucks",
    normalizedMerchant: "starbucks",
    sourceCategoryId: "cat_dining",
    occurrenceDate: "2026-10-05",
    postedDate: "2026-10-06",
  },
  {
    ...transactionBase,
    id: "transaction_pending_utility",
    sourceTransactionId: "plaid_tx_pending_003",
    status: "pending",
    amountCents: 2999,
    rawMerchant: "CITY ENERGY PENDING",
    displayMerchant: "City Energy",
    normalizedMerchant: "city energy",
    sourceCategoryId: "cat_utilities",
    occurrenceDate: "2026-10-08",
  },
];

export const fixtureBudgets: readonly Budget[] = [
  {
    id: "budget_default_including",
    userId: fixtureUserId,
    mode: "including_utilities",
    amountCents: 250000,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  },
  {
    id: "budget_default_excluding",
    userId: fixtureUserId,
    mode: "excluding_utilities",
    amountCents: 170000,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  },
];

export const fixtureExpectedSummary: MonthlySummary = {
  month: "2026-10",
  timezone: "America/Chicago",
  budgetMode: "including_utilities",
  budgetCents: 250000,
  postedCents: 4900,
  pendingCents: 2999,
  spentCents: 7899,
  availableCents: 242101,
  overspentCents: 0,
  transactionCount: 3,
  categoryBreakdown: [
    { id: "cat_groceries", label: "Groceries", amountCents: 4250, transactionCount: 1 },
    { id: "cat_dining", label: "Dining", amountCents: 650, transactionCount: 1 },
    { id: "cat_utilities", label: "Utilities", amountCents: 2999, transactionCount: 1 },
  ],
  merchantBreakdown: [
    { id: "walmart", label: "Walmart", amountCents: 4250, transactionCount: 1 },
    { id: "starbucks", label: "Starbucks", amountCents: 650, transactionCount: 1 },
    { id: "city energy", label: "City Energy", amountCents: 2999, transactionCount: 1 },
  ],
  calculatedAt: fixtureNow,
  dataFreshAsOf: fixtureNow,
  isStale: false,
};

export const fixtureReconciliationCandidate: ReconciliationCandidate = {
  pendingTransactionId: "transaction_pending_utility",
  postedTransactionId: "transaction_posted_utility_replacement",
  reason: "provider_link",
  factors: ["account", "amount", "merchant", "date"],
  requiresConfirmation: false,
};
