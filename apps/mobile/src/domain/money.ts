export function parseUsdToCents(input: string): number {
  const normalized = input.trim().replace(/^\$/, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);

  if (!match) {
    throw new Error('Enter a positive dollar amount with no more than two decimal places.');
  }

  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const amountCents = dollars * 100 + cents;

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be greater than zero and within the supported range.');
  }

  return amountCents;
}
