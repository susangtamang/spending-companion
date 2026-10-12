/** Converts Plaid's signed decimal amount to exact integer cents without binary multiplication. */
export function plaidAmountToSignedCents(amount: number | string): number {
  const text = typeof amount === "number" ? numberToDecimal(amount) : amount.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error("Plaid amount must be a finite decimal value.");
  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] ?? "0";
  const fraction = match[3] ?? "";
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new Error("Plaid amount has sub-cent precision.");
  }
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Plaid amount exceeds safe integer cents.");
  return Object.is(sign * cents, -0) ? 0 : sign * cents;
}

function numberToDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Plaid amount must be finite.");
  const text = value.toString();
  if (!/[eE]/.test(text)) return text;
  const [coefficient = "", exponentText = "0"] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const sign = coefficient.startsWith("-") ? "-" : coefficient.startsWith("+") ? "+" : "";
  const digits = coefficient.replace(/^[+-]/, "").replace(".", "");
  const decimalIndex = (coefficient.replace(/^[+-]/, "").indexOf(".") < 0
    ? coefficient.replace(/^[+-]/, "").length
    : coefficient.replace(/^[+-]/, "").indexOf(".")) + exponent;
  if (decimalIndex <= 0) return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
