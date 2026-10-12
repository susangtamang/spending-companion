# ADR 0002: Supported financial accounts

Status: Accepted

## Decision

Version 1 connects US checking accounts and credit-card accounts through Plaid Transactions.

Savings accounts may be visible as connected account metadata but are excluded from purchase-budget totals until a later product decision defines transfer and savings-withdrawal behavior. Investments, liabilities, payment initiation, and money movement are out of scope.

## Rationale

Checking and credit accounts cover the primary purchase-spending use case while avoiding ambiguous savings transfers and unrelated financial products.
