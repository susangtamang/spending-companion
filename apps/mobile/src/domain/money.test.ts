import { describe, expect, it } from 'vitest';

import { parseUsdToCents } from './money';

describe('parseUsdToCents', () => {
  it.each([
    ['42', 4_200],
    ['42.5', 4_250],
    ['$42.50', 4_250],
    [' 0.01 ', 1],
  ])('parses %s without floating-point arithmetic', (input, expected) => {
    expect(parseUsdToCents(input)).toBe(expected);
  });

  it.each(['', '0', '-5', '12.345', 'hello'])('rejects invalid amount %s', (input) => {
    expect(() => parseUsdToCents(input)).toThrow();
  });
});
