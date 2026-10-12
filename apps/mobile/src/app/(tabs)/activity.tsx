import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DemoBanner } from "../../components/DemoBanner";
import { demoMode } from "../../lib/mode";
import { useAppSession } from "../../lib/session";

type Tx = { id: string; source: "manual" | "csv" | "plaid"; financialAccountId?: string; displayMerchant: string; amountCents: number; status: "posted" | "pending" | "removed"; kind: string; occurrenceDate: string; sourceCategoryId?: string; categoryOverrideId?: string; note?: string };
type PreviewRow = { rowNumber: number; disposition: "valid" | "invalid" | "duplicate"; errors: Array<{ message: string }> };
type ImportPreview = { id: string; expiresAt: string; rows: PreviewRow[] };
type ImportBatch = { id: string; fileName: string; status: "previewed" | "committed" | "undone"; totalRows: number; importedRows: number; invalidRows: number; duplicateRows: number };
type Category = { id: string; name: string; archivedAt?: string };
type Account = { id: string; name: string };

export default function Activity() {
  const { api } = useAppSession();
  const [rows, setRows] = useState<Tx[]>([]);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Tx | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  async function load() {
    if (demoMode || !api) return;
    setBusy(true);
    setError("");
    try {
      const [transactions, history, categoryRows, accountRows] = await Promise.all([
        loadMonthTransactions(api, month),
        api.get<{ data: ImportBatch[] }>("/v1/imports"),
        api.get<Category[]>("/v1/categories"),
        api.get<Account[]>("/v1/accounts"),
      ]);
      setRows(transactions);
      setImports(history.data);
      setCategories(categoryRows.filter((category) => !category.archivedAt));
      setAccounts(accountRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh. Showing saved results.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [month]);
  const visible = useMemo(() => rows.filter((row) =>
    (status === "all" || row.status === status)
    && (source === "all" || row.source === source)
    && (accountId === "all" || row.financialAccountId === accountId)
    && (categoryId === "all" || (row.categoryOverrideId ?? row.sourceCategoryId) === categoryId)
    && row.displayMerchant.toLowerCase().includes(query.toLowerCase())), [rows, status, source, accountId, categoryId, query]);

  async function save(transaction: Tx) {
    if (!api) return;
    setBusy(true);
    try {
      const updated = await api.patch<Tx>(`/v1/transactions/${transaction.id}`, {
        displayMerchant: transaction.displayMerchant,
        categoryOverrideId: transaction.categoryOverrideId ?? null,
        note: transaction.note ?? null,
      });
      setRows((values) => values.map((value) => value.id === updated.id ? updated : value));
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  function remove(transaction: Tx) {
    Alert.alert("Delete transaction?", "Only manually entered transactions can be deleted.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api?.delete(`/v1/transactions/${transaction.id}`);
          setRows((values) => values.filter((value) => value.id !== transaction.id));
          setSelected(null);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Delete failed."); }
      } },
    ]);
  }

  async function selectCsv() {
    if (!api) return;
    const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values"], copyToCacheDirectory: true });
    if (result.canceled) return;
    setBusy(true);
    setError("");
    try {
      const asset = result.assets[0]!;
      const form = new FormData();
      form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType ?? "text/csv" } as unknown as Blob);
      setPreview(await api.postForm<ImportPreview>("/v1/imports/csv/preview", form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CSV preview failed.");
    } finally { setBusy(false); }
  }

  async function commitPreview() {
    if (!api || !preview) return;
    setBusy(true);
    try {
      await api.post("/v1/imports/csv/commit", { previewId: preview.id });
      setPreview(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CSV import failed.");
      setBusy(false);
    }
  }

  async function undoImport(batch: ImportBatch) {
    if (!api) return;
    try {
      await api.post(`/v1/imports/${batch.id}/undo`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Import undo failed."); }
  }

  return <View style={styles.page}>
    <DemoBanner />
    <View style={styles.month}>
      <Button title="Previous" accessibilityLabel="Previous month" onPress={() => setMonth(changeMonth(month, -1))} />
      <Text>{month}</Text>
      <Button title="Next" accessibilityLabel="Next month" onPress={() => setMonth(changeMonth(month, 1))} />
    </View>
    <TextInput accessibilityLabel="Search merchants" placeholder="Search merchants" value={query} onChangeText={setQuery} style={styles.input} />
    <View style={styles.filters}>{["all", "posted", "pending"].map((value) => <Pressable accessibilityRole="button" accessibilityState={{ selected: status === value }} key={value} onPress={() => setStatus(value)} style={[styles.pill, status === value && styles.active]}><Text>{value}</Text></Pressable>)}</View>
    <View style={styles.filters}>{["all", "plaid", "csv", "manual"].map((value) => <Pressable accessibilityRole="button" accessibilityState={{ selected: source === value }} key={value} onPress={() => setSource(value)} style={[styles.pill, source === value && styles.active]}><Text>{value}</Text></Pressable>)}</View>
    {accounts.length > 0 && <View style={styles.filters}><Pressable accessibilityRole="button" accessibilityState={{ selected: accountId === "all" }} onPress={() => setAccountId("all")} style={[styles.pill, accountId === "all" && styles.active]}><Text>All accounts</Text></Pressable>{accounts.map((account) => <Pressable accessibilityRole="button" accessibilityState={{ selected: accountId === account.id }} key={account.id} onPress={() => setAccountId(account.id)} style={[styles.pill, accountId === account.id && styles.active]}><Text>{account.name}</Text></Pressable>)}</View>}
    {categories.length > 0 && <View style={styles.filters}><Pressable accessibilityRole="button" accessibilityState={{ selected: categoryId === "all" }} onPress={() => setCategoryId("all")} style={[styles.pill, categoryId === "all" && styles.active]}><Text>All categories</Text></Pressable>{categories.map((category) => <Pressable accessibilityRole="button" accessibilityState={{ selected: categoryId === category.id }} key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.pill, categoryId === category.id && styles.active]}><Text>{category.name}</Text></Pressable>)}</View>}
    {busy && <Text accessibilityRole="alert">Loading…</Text>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <ScrollView>
      <View style={styles.actions}><Button title="Add manual transaction" onPress={() => setManualOpen(true)} /><Button title="Import CSV" onPress={() => void selectCsv()} /></View>
      {preview && <ImportPreviewCard preview={preview} busy={busy} onCommit={() => void commitPreview()} onCancel={() => setPreview(null)} />}
      {visible.map((transaction) => <Pressable accessibilityLabel={`${transaction.displayMerchant}, ${(transaction.amountCents / 100).toFixed(2)} dollars, ${transaction.status}`} key={transaction.id} onPress={() => setSelected(transaction)} style={styles.row}><View><Text style={styles.merchant}>{transaction.displayMerchant}</Text><Text>{transaction.occurrenceDate} · {transaction.status} · {transaction.source}</Text></View><Text>${(transaction.amountCents / 100).toFixed(2)}</Text></Pressable>)}
      {!busy && visible.length === 0 && <Text style={styles.empty}>No matching transactions.</Text>}
      <Text style={styles.heading}>CSV import history</Text>
      {imports.map((batch) => <View key={batch.id} style={styles.importRow}><Text>{batch.fileName} · {batch.status} · {batch.importedRows}/{batch.totalRows} imported</Text>{batch.status === "committed" && <Button title="Undo import" onPress={() => Alert.alert("Undo this import?", "Transactions created by this batch will be removed.", [{ text: "Cancel", style: "cancel" }, { text: "Undo", style: "destructive", onPress: () => void undoImport(batch) }])} />}</View>)}
    </ScrollView>
    <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>{selected && <Editor value={selected} categories={categories} busy={busy} onCancel={() => setSelected(null)} onSave={save} onDelete={remove} />}</Modal>
    <Modal visible={manualOpen} animationType="slide" onRequestClose={() => setManualOpen(false)}><ManualEntry busy={busy} onCancel={() => setManualOpen(false)} onSave={async (body) => { if (!api) return false; setBusy(true); try { const created = await api.post<Tx>("/v1/transactions", body); setRows((values) => [created, ...values]); setManualOpen(false); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : "Manual entry failed. Your draft is saved on this device."); return false; } finally { setBusy(false); } }} /></Modal>
  </View>;
}

function ImportPreviewCard({ preview, busy, onCommit, onCancel }: { preview: ImportPreview; busy: boolean; onCommit: () => void; onCancel: () => void }) {
  const count = (disposition: PreviewRow["disposition"]) => preview.rows.filter((row) => row.disposition === disposition).length;
  return <View style={styles.card}><Text style={styles.heading}>CSV preview</Text><Text>{count("valid")} valid · {count("duplicate")} duplicates · {count("invalid")} invalid</Text>{preview.rows.filter((row) => row.disposition === "invalid").slice(0, 5).map((row) => <Text key={row.rowNumber} style={styles.error}>Row {row.rowNumber}: {row.errors.map((error) => error.message).join("; ")}</Text>)}<Button title="Confirm import" disabled={busy || count("valid") === 0} onPress={onCommit} /><Button title="Cancel preview" onPress={onCancel} /></View>;
}

function ManualEntry({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (body: object) => Promise<boolean> }) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { void AsyncStorage.getItem(MANUAL_DRAFT_KEY).then((stored) => { if (!stored) return; try { const draft = JSON.parse(stored) as { merchant?: string; amount?: string; date?: string }; if (draft.merchant) setMerchant(draft.merchant); if (draft.amount) setAmount(draft.amount); if (draft.date) setDate(draft.date); } catch { void AsyncStorage.removeItem(MANUAL_DRAFT_KEY); } }).finally(() => setHydrated(true)); }, []);
  useEffect(() => { if (hydrated) void AsyncStorage.setItem(MANUAL_DRAFT_KEY, JSON.stringify({ merchant, amount, date })); }, [hydrated, merchant, amount, date]);
  const cents = parseCents(amount);
  return <ScrollView contentContainerStyle={styles.editor}><Text accessibilityRole="header" style={styles.title}>Add transaction</Text><Text>Your draft stays on this device if the network is unavailable.</Text><TextInput accessibilityLabel="Merchant" placeholder="Merchant" value={merchant} onChangeText={setMerchant} style={styles.input} /><TextInput accessibilityLabel="Amount in dollars" placeholder="0.00" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} style={styles.input} /><TextInput accessibilityLabel="Transaction date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} style={styles.input} /><Button title="Save transaction" disabled={busy || !merchant.trim() || cents === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)} onPress={() => void onSave({ status: "posted", kind: "purchase", amountCents: cents, displayMerchant: merchant.trim(), occurrenceDate: date }).then((saved) => { if (saved) void AsyncStorage.removeItem(MANUAL_DRAFT_KEY); })} /><Button title="Cancel" onPress={onCancel} /></ScrollView>;
}

function Editor({ value, categories, busy, onCancel, onSave, onDelete }: { value: Tx; categories: Category[]; busy: boolean; onCancel: () => void; onSave: (value: Tx) => void; onDelete: (value: Tx) => void }) {
  const [merchant, setMerchant] = useState(value.displayMerchant);
  const [category, setCategory] = useState(value.categoryOverrideId ?? "");
  const [note, setNote] = useState(value.note ?? "");
  return <ScrollView contentContainerStyle={styles.editor}><Text accessibilityRole="header" style={styles.title}>Transaction details</Text><Text>Amount ${(value.amountCents / 100).toFixed(2)} · {value.status} · {value.source}</Text><TextInput accessibilityLabel="Merchant" value={merchant} onChangeText={setMerchant} style={styles.input} /><Text style={styles.heading}>Category</Text><View style={styles.filters}><Pressable accessibilityRole="button" accessibilityState={{ selected: !category }} onPress={() => setCategory("")} style={[styles.pill, !category && styles.active]}><Text>None</Text></Pressable>{categories.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: category === item.id }} key={item.id} onPress={() => setCategory(item.id)} style={[styles.pill, category === item.id && styles.active]}><Text>{item.name}</Text></Pressable>)}</View><TextInput accessibilityLabel="Transaction note" value={note} onChangeText={setNote} style={styles.input} /><Button title="Save changes" disabled={busy || !merchant.trim()} onPress={() => onSave({ ...value, displayMerchant: merchant.trim(), categoryOverrideId: category || undefined, note: note || undefined })} />{value.source === "manual" && <Button title="Delete transaction" color="#A9362A" onPress={() => onDelete(value)} />}<Button title="Cancel" onPress={onCancel} /></ScrollView>;
}

function parseCents(value: string): number | null { const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim()); if (!match) return null; const [whole = "", fraction = ""] = value.trim().split("."); const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0")); return Number.isSafeInteger(result) ? result : null; }
const MANUAL_DRAFT_KEY = "spending-companion.manual-draft.v1";
async function loadMonthTransactions(api: NonNullable<ReturnType<typeof useAppSession>["api"]>, month: string): Promise<Tx[]> { const [year, monthNumber] = month.split("-").map(Number); const from = `${month}-01`; const to = `${month}-${String(new Date(year!, monthNumber!, 0).getDate()).padStart(2, "0")}`; const rows: Tx[] = []; let cursor: string | undefined; do { const page = await api.get<{ data: Tx[]; nextCursor?: string }>(`/v1/transactions?from=${from}&to=${to}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); rows.push(...page.data); cursor = page.nextCursor; } while (cursor); return rows; }
function changeMonth(value: string, offset: number) { const [year, month] = value.split("-").map(Number); const date = new Date(year!, month! - 1 + offset, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
const styles = StyleSheet.create({ page: { flex: 1, padding: 16, gap: 12 }, month: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, input: { borderWidth: 1, borderColor: "#CCC", borderRadius: 10, padding: 12, backgroundColor: "white" }, filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, pill: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 22, backgroundColor: "#EEE" }, active: { backgroundColor: "#BFDACF" }, error: { color: "#A9362A" }, row: { minHeight: 44, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between" }, merchant: { fontWeight: "700", fontSize: 16 }, empty: { padding: 24, textAlign: "center" }, editor: { padding: 24, gap: 16 }, title: { fontSize: 26, fontWeight: "800" }, heading: { fontSize: 18, fontWeight: "700", marginTop: 18 }, actions: { gap: 8, marginBottom: 8 }, card: { padding: 14, borderWidth: 1, borderColor: "#CBD5D1", borderRadius: 12, gap: 8 }, importRow: { paddingVertical: 10, gap: 6 } });
