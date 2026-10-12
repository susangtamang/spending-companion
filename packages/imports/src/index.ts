import type {
  ImportBatch,
  ImportPreviewRow,
  ImportRowError,
  Transaction,
  TransactionKind,
  TransactionStatus,
} from "@spending-companion/contracts";

export const CSV_HEADER = [
  "sourceId",
  "date",
  "merchant",
  "amount",
  "status",
  "category",
  "kind",
] as const;

export interface ImportScope {
  readonly userId: string;
  readonly financialAccountId?: string;
  /** Institution, account-less import bucket, or another caller-defined stable scope. */
  readonly importContext: string;
}

export interface ExistingSourceIdentity extends ImportScope {
  readonly sourceId: string;
}

export interface PreviewCsvOptions extends ImportScope {
  readonly batchId: string;
  readonly fileName: string;
  readonly now: string;
  /** IDs are supplied by the caller so retries create byte-for-byte equivalent plans. */
  readonly transactionIdForRow: (rowNumber: number, sourceId: string) => string;
  readonly existing: readonly ExistingSourceIdentity[];
}

export interface CsvImportPreview {
  readonly batch: ImportBatch;
  readonly rows: readonly ImportPreviewRow[];
  readonly fingerprint: string;
}

export interface CommitPlan {
  readonly kind: "commit";
  readonly replay: boolean;
  readonly fingerprint: string;
  readonly batch: ImportBatch;
  readonly transactions: readonly Transaction[];
}

export interface PriorCommit {
  readonly batchId: string;
  readonly fingerprint: string;
  readonly committedAt: string;
}

export interface UndoPlan {
  readonly kind: "undo";
  readonly replay: boolean;
  readonly batchId: string;
  readonly transactionIds: readonly string[];
  readonly undoneAt: string;
}

interface ParsedRecord {
  readonly rowNumber: number;
  readonly fields: readonly string[];
}

interface CsvSyntaxError {
  readonly rowNumber: number;
  readonly message: string;
}

const KINDS = new Set<TransactionKind>(["purchase", "refund", "payment", "transfer", "cash"]);
const STATUSES = new Set<TransactionStatus>(["pending", "posted"]);

export function sourceIdentityKey(identity: ExistingSourceIdentity): string {
  return JSON.stringify([
    identity.userId,
    "csv",
    identity.financialAccountId ?? null,
    identity.importContext,
    identity.sourceId,
  ]);
}

export function parseUsdCents(value: string): number | undefined {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const [whole = "", fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

export function previewCsv(csv: string, options: PreviewCsvOptions): CsvImportPreview {
  requireNonEmptyOptions(options);
  const parsed = parseCsvRecords(csv);
  const rows: ImportPreviewRow[] = [];

  if (parsed.records.length === 0) {
    rows.push(invalidRow(1, "header", "missing_header", `Expected header: ${CSV_HEADER.join(",")}`));
  } else if (!sameHeader(parsed.records[0]?.fields ?? [])) {
    rows.push(invalidRow(1, "header", "invalid_header", `Expected header: ${CSV_HEADER.join(",")}`));
  }

  for (const error of parsed.errors) {
    rows.push(invalidRow(error.rowNumber, undefined, "malformed_csv", error.message));
  }

  const headerValid = parsed.records.length > 0 && sameHeader(parsed.records[0]?.fields ?? []);
  const existingKeys = new Set(options.existing.map(sourceIdentityKey));
  const batchKeys = new Set<string>();

  if (headerValid) {
    for (const record of parsed.records.slice(1)) {
      const validated = validateRecord(record, options);
      if (validated.errors.length > 0 || !validated.transaction || !validated.sourceId) {
        rows.push({ rowNumber: record.rowNumber, disposition: "invalid", errors: validated.errors });
        continue;
      }

      const key = sourceIdentityKey({
        userId: options.userId,
        ...(options.financialAccountId === undefined ? {} : { financialAccountId: options.financialAccountId }),
        importContext: options.importContext,
        sourceId: validated.sourceId,
      });
      const duplicate = existingKeys.has(key) || batchKeys.has(key);
      batchKeys.add(key);
      rows.push({
        rowNumber: record.rowNumber,
        disposition: duplicate ? "duplicate" : "valid",
        transaction: validated.transaction,
        errors: [],
        ...(validated.suggestedCategoryId === undefined
          ? {}
          : { suggestedCategoryId: validated.suggestedCategoryId }),
      });
    }
  }

  rows.sort((a, b) => a.rowNumber - b.rowNumber);
  const validCount = rows.filter((row) => row.disposition === "valid").length;
  const duplicateCount = rows.filter((row) => row.disposition === "duplicate").length;
  const invalidCount = rows.filter((row) => row.disposition === "invalid").length;
  const batch: ImportBatch = {
    id: options.batchId,
    userId: options.userId,
    fileName: options.fileName,
    status: "previewed",
    totalRows: validCount + duplicateCount + invalidCount,
    importedRows: 0,
    duplicateRows: duplicateCount,
    invalidRows: invalidCount,
    createdAt: options.now,
  };

  return { batch, rows, fingerprint: fingerprintPreview(batch, rows, options) };
}

export function planCommit(
  preview: CsvImportPreview,
  committedAt: string,
  prior?: PriorCommit,
): CommitPlan {
  if (prior) {
    if (prior.batchId !== preview.batch.id || prior.fingerprint !== preview.fingerprint) {
      throw new Error("Idempotency conflict: batch ID was already committed with different CSV content.");
    }
    return {
      kind: "commit",
      replay: true,
      fingerprint: preview.fingerprint,
      batch: committedBatch(preview, prior.committedAt),
      transactions: validTransactions(preview),
    };
  }
  return {
    kind: "commit",
    replay: false,
    fingerprint: preview.fingerprint,
    batch: committedBatch(preview, committedAt),
    transactions: validTransactions(preview),
  };
}

export function planUndo(
  batch: ImportBatch,
  transactionIds: readonly string[],
  undoneAt: string,
  alreadyUndoneAt?: string,
): UndoPlan {
  if (batch.status === "previewed") throw new Error("Only a committed import can be undone.");
  const replay = batch.status === "undone" || alreadyUndoneAt !== undefined;
  return {
    kind: "undo",
    replay,
    batchId: batch.id,
    transactionIds: [...new Set(transactionIds)].sort(),
    undoneAt: alreadyUndoneAt ?? batch.undoneAt ?? undoneAt,
  };
}

function validateRecord(record: ParsedRecord, options: PreviewCsvOptions): {
  readonly errors: ImportRowError[];
  readonly sourceId?: string;
  readonly suggestedCategoryId?: string;
  readonly transaction?: Transaction;
} {
  const errors: ImportRowError[] = [];
  if (record.fields.length !== CSV_HEADER.length) {
    errors.push(rowError(record.rowNumber, undefined, "column_count", `Expected ${CSV_HEADER.length} columns, received ${record.fields.length}.`));
    return { errors };
  }
  const [sourceId = "", date = "", merchant = "", amount = "", statusText = "", category = "", kindText = ""] = record.fields.map((field) => field.trim());
  if (!sourceId) errors.push(rowError(record.rowNumber, "sourceId", "required", "sourceId is required."));
  if (!isCalendarDate(date)) errors.push(rowError(record.rowNumber, "date", "invalid_date", "date must be an actual YYYY-MM-DD calendar date."));
  if (!merchant) errors.push(rowError(record.rowNumber, "merchant", "required", "merchant is required."));
  const amountCents = parseUsdCents(amount);
  if (amountCents === undefined) errors.push(rowError(record.rowNumber, "amount", "invalid_amount", "amount must be non-negative USD with at most two decimal places."));
  const status = STATUSES.has(statusText as TransactionStatus) ? statusText as "pending" | "posted" : undefined;
  if (!status) errors.push(rowError(record.rowNumber, "status", "invalid_status", "status must be pending or posted."));
  const kind = KINDS.has(kindText as TransactionKind) ? kindText as TransactionKind : undefined;
  if (!kind) errors.push(rowError(record.rowNumber, "kind", "invalid_kind", "kind is not supported."));
  if (errors.length > 0 || amountCents === undefined || !status || !kind) return { errors, ...(sourceId ? { sourceId } : {}) };

  const transaction: Transaction = {
    id: options.transactionIdForRow(record.rowNumber, sourceId),
    userId: options.userId,
    ...(options.financialAccountId === undefined ? {} : { financialAccountId: options.financialAccountId }),
    source: "csv",
    sourceTransactionId: sourceId,
    status,
    kind,
    amountCents,
    currencyCode: "USD",
    rawMerchant: merchant,
    displayMerchant: merchant,
    normalizedMerchant: normalizeMerchant(merchant),
    ...(category ? { sourceCategoryId: category } : {}),
    occurrenceDate: date,
    ...(status === "posted" ? { postedDate: date } : {}),
    importBatchId: options.batchId,
    createdAt: options.now,
    updatedAt: options.now,
  };
  return { errors, sourceId, transaction, ...(category ? { suggestedCategoryId: category } : {}) };
}

function parseCsvRecords(csv: string): { records: ParsedRecord[]; errors: CsvSyntaxError[] } {
  const records: ParsedRecord[] = [];
  const errors: CsvSyntaxError[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let rowNumber = 1;
  let recordStart = 1;

  const pushRecord = (): void => {
    fields.push(field);
    if (!(fields.length === 1 && fields[0] === "")) records.push({ rowNumber: recordStart, fields });
    fields = [];
    field = "";
    afterQuote = false;
  };

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index] ?? "";
    const next = csv[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else { field += char; if (char === "\n") rowNumber += 1; }
      continue;
    }
    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") {
      errors.push({ rowNumber: recordStart, message: "Unexpected character after closing quote." });
      afterQuote = false;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { fields.push(field); field = ""; afterQuote = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") index += 1;
      pushRecord(); rowNumber += 1; recordStart = rowNumber;
    } else field += char;
  }
  if (quoted) errors.push({ rowNumber: recordStart, message: "Unclosed quoted field." });
  else if (field.length > 0 || fields.length > 0) pushRecord();
  return { records, errors };
}

function sameHeader(fields: readonly string[]): boolean {
  return fields.length === CSV_HEADER.length && fields.every((field, index) => field.trim() === CSV_HEADER[index]);
}

function rowError(rowNumber: number, field: string | undefined, code: string, message: string): ImportRowError {
  return { rowNumber, ...(field === undefined ? {} : { field }), code, message };
}

function invalidRow(rowNumber: number, field: string | undefined, code: string, message: string): ImportPreviewRow {
  return { rowNumber, disposition: "invalid", errors: [rowError(rowNumber, field, code, message)] };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizeMerchant(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function fingerprintPreview(batch: ImportBatch, rows: readonly ImportPreviewRow[], options: ImportScope): string {
  const canonical = JSON.stringify({
    batchId: batch.id,
    userId: options.userId,
    financialAccountId: options.financialAccountId ?? null,
    importContext: options.importContext,
    rows: rows.map((row) => ({
      rowNumber: row.rowNumber,
      disposition: row.disposition,
      transaction: row.transaction,
      errors: row.errors,
    })),
  });
  // Deterministic FNV-1a-style 32-bit digest; this is an idempotency fingerprint, not a security hash.
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `csv-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validTransactions(preview: CsvImportPreview): Transaction[] {
  return preview.rows.flatMap((row) => row.disposition === "valid" && row.transaction ? [row.transaction] : []);
}

function committedBatch(preview: CsvImportPreview, committedAt: string): ImportBatch {
  const importedRows = preview.rows.filter((row) => row.disposition === "valid").length;
  return { ...preview.batch, status: "committed", importedRows, committedAt };
}

function requireNonEmptyOptions(options: PreviewCsvOptions): void {
  for (const [name, value] of [["batchId", options.batchId], ["fileName", options.fileName], ["userId", options.userId], ["importContext", options.importContext], ["now", options.now]] as const) {
    if (!value.trim()) throw new Error(`${name} is required.`);
  }
}
