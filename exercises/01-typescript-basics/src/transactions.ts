/**
 * Milestone 1: TypeScript transactions and integer cents
 *
 * Complete the TODOs below. Run `npm run check` to ask TypeScript to check
 * your work without generating JavaScript.
 */

// TODO 1: Define a Transaction type with these fields:
// - id: string
// - merchant: string
// - amountCents: number
// - category: string
type Transaction = {
  id: string;
  merchant: string;
  amountCents: number;
  category: string;
  status: "posted" | "pending"
};

// TODO 2: Give this array the type "array of Transaction objects", then add:
// - tx-001, Grocery Store, 1299 cents, Groceries
// - tx-002, Coffee Shop, 450 cents, Dining
// - tx-003, Electric Company, 2750 cents, Utilities
const transactions: Transaction[] = [
  { id: "tx-001", merchant: "Walmart", amountCents: 4250, category: "groceries", status: "posted" },
  { id: "tx-002", merchant: "Starbucks", amountCents: 650, category: "dining", status: "posted" },
  { id: "tx-003", merchant: "Amazon", amountCents: 2999, category: "shopping", status: "pending" }
] ;

// console.log(transactions);

// TODO 3: Add parameter and return types, then calculate the total.
// Important: use the function parameter, not the global `transactions` array.
function totalAmountCents(transactions: Transaction[]): number {
  // Replace this placeholder with your calculation.
  return transactions.reduce((total, tx) => total + tx.amountCents, 0);
}

console.log(totalAmountCents(transactions));

