# Spending Companion demo

For complete operating instructions, see [`user-guide.md`](user-guide.md).

## Start

```powershell
cd apps/mobile
npm install
npm test
npm start
```

Scan the QR code with Expo Go, or press `a` with an Android emulator running.

## Demo flow

1. Home: switch between budgets including and excluding utilities.
2. Activity: add a posted or pending purchase and watch totals update.
3. Activity: mark a pending transaction as posted.
4. Import: preview the provided CSV, then import its verified rows.
5. Import: try importing the same rows again and observe duplicate source IDs being skipped.
6. Settings: edit both monthly budgets, restart the app, and confirm they persist.

## CSV format

```text
sourceId,date,merchant,amount,status,category,kind
bank-1001,2026-10-09,Neighborhood Market,63.24,posted,groceries,purchase
```

Supported kinds: `purchase`, `payment`, `transfer`, `cash`, and `refund`.
Only posted purchases and active pending purchases count against the spending budget.
