import { useEffect, useState } from "react";
import { Alert, Button, ScrollView, Share, Switch, Text, TextInput, View } from "react-native";
import { DemoBanner } from "../../components/DemoBanner";
import { demoMode } from "../../lib/mode";
import { useAppSession } from "../../lib/session";

type Account = { id: string; name: string; mask?: string; includeInSpending: boolean };
type Candidate = { pendingTransactionId: string; postedTransactionId: string; score?: number; requiresConfirmation: boolean };
type ExportJob = { id: string; downloadUrl: string };
type Budget = { id: string; mode: "including_utilities" | "excluding_utilities"; month?: string; amountCents: number };
type Category = { id: string; name: string; isUtility: boolean; isSystem: boolean };

export default function Settings() {
  const { api, getToken, signOut } = useAppSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgetDollars, setBudgetDollars] = useState("2500.00");
  const [categoryName, setCategoryName] = useState("");
  const [categoryUtility, setCategoryUtility] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (demoMode || !api) return;
    setBusy(true);
    setError("");
    try {
      const [accountRows, candidateRows, budgetRows, categoryRows] = await Promise.all([
        api.get<Account[]>("/v1/accounts"),
        api.get<Candidate[]>("/v1/reconciliations"),
        api.get<Budget[]>("/v1/budgets"),
        api.get<Category[]>("/v1/categories"),
      ]);
      setAccounts(accountRows);
      setCandidates(candidateRows);
      setBudgets(budgetRows);
      setCategories(categoryRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh failed. Showing saved results.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(account: Account, value: boolean) {
    setAccounts((rows) => rows.map((row) => row.id === account.id ? { ...row, includeInSpending: value } : row));
    try {
      await api?.patch(`/v1/accounts/${account.id}`, { includeInSpending: value });
    } catch (cause) {
      setAccounts((rows) => rows.map((row) => row.id === account.id ? account : row));
      setError(cause instanceof Error ? cause.message : "Account update failed.");
    }
  }

  async function decide(candidate: Candidate, decision: "confirm" | "reject") {
    if (!api) return;
    try {
      await api.post(`/v1/reconciliations/${candidate.pendingTransactionId}/${decision}`, { postedTransactionId: candidate.postedTransactionId });
      setCandidates((rows) => rows.filter((row) => row !== candidate));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reconciliation update failed.");
    }
  }

  async function exportData() {
    if (!api) return;
    setError("");
    try {
      const job = await api.post<ExportJob>("/v1/exports", { format: "json" });
      const contents = await api.getText(job.downloadUrl);
      await Share.share({ title: "Spending Companion data export", message: contents });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed.");
    }
  }

  async function saveBudget() {
    if (!api) return;
    const amountCents = parseCents(budgetDollars);
    if (amountCents === null) { setError("Enter a valid USD budget, such as 2500.00."); return; }
    try {
      const current = budgets.find((budget) => budget.mode === "including_utilities" && !budget.month);
      const saved = current
        ? await api.patch<Budget>(`/v1/budgets/${current.id}`, { mode: current.mode, amountCents })
        : await api.post<Budget>("/v1/budgets", { mode: "including_utilities", amountCents });
      setBudgets((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      Alert.alert("Budget saved", "Your default monthly budget is updated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Budget update failed."); }
  }

  async function createCategory() {
    if (!api || !categoryName.trim()) return;
    try {
      const created = await api.post<Category>("/v1/categories", { name: categoryName.trim(), isUtility: categoryUtility });
      setCategories((rows) => [...rows, created]);
      setCategoryName("");
      setCategoryUtility(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Category creation failed."); }
  }

  async function deleteEverything() {
    if (!api) return;
    setError("");
    try {
      const freshToken = await getToken({ skipCache: true });
      if (!freshToken) throw new Error("Sign in again before deleting your account.");
      await api.post("/v1/me/deletion", { confirmation: "DELETE", reauthenticationToken: freshToken });
      Alert.alert("Account deleted", "Your Spending Companion data and bank connections were removed.");
      await signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account deletion failed.");
    }
  }

  return <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
    <DemoBanner />
    <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "800" }}>Settings & privacy</Text>
    {busy && <Text accessibilityRole="alert">Loading settings…</Text>}
    {error && <Text accessibilityRole="alert" style={{ color: "#A9362A" }}>{error}</Text>}
    <Text style={{ fontSize: 19, fontWeight: "700" }}>Accounts included in spending</Text>
    {accounts.map((account) => <View key={account.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text>{account.name}{account.mask ? ` · ${account.mask}` : ""}</Text>
      <Switch accessibilityLabel={`Include ${account.name} in spending`} value={account.includeInSpending} onValueChange={(value) => void toggle(account, value)} />
    </View>)}
    <Text style={{ fontSize: 19, fontWeight: "700", marginTop: 12 }}>Pending match review</Text>
    {candidates.map((candidate) => <View key={`${candidate.pendingTransactionId}:${candidate.postedTransactionId}`} style={{ gap: 7, padding: 12, backgroundColor: "white", borderRadius: 12 }}>
      <Text>Possible replacement · score {candidate.score ?? "provider"}</Text>
      <Text>Pending {candidate.pendingTransactionId}{"\n"}Posted {candidate.postedTransactionId}</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button title="Confirm match" onPress={() => void decide(candidate, "confirm")} />
        <Button title="Not a match" onPress={() => void decide(candidate, "reject")} />
      </View>
    </View>)}
    {!busy && candidates.length === 0 && <Text>No matches need review.</Text>}
    <Button title="Refresh" onPress={() => void load()} />
    <Text style={{ fontSize: 19, fontWeight: "700", marginTop: 12 }}>Default monthly budget</Text>
    <TextInput accessibilityLabel="Default monthly budget in dollars" keyboardType="decimal-pad" value={budgetDollars} onChangeText={setBudgetDollars} style={{ borderWidth: 1, borderColor: "#CCC", borderRadius: 10, padding: 12, backgroundColor: "white" }} />
    <Button title="Save budget" onPress={() => void saveBudget()} />
    <Text style={{ fontSize: 19, fontWeight: "700", marginTop: 12 }}>Categories</Text>
    {categories.map((category) => <Text key={category.id}>{category.name}{category.isUtility ? " · utility" : ""}{category.isSystem ? " · built in" : ""}</Text>)}
    <TextInput accessibilityLabel="New category name" placeholder="New category" value={categoryName} onChangeText={setCategoryName} style={{ borderWidth: 1, borderColor: "#CCC", borderRadius: 10, padding: 12, backgroundColor: "white" }} />
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text>Utility category</Text><Switch accessibilityLabel="New category is a utility" value={categoryUtility} onValueChange={setCategoryUtility} /></View>
    <Button title="Add category" disabled={!categoryName.trim()} onPress={() => void createCategory()} />
    <Button title="Export and share my data" onPress={() => void exportData()} />
    <Button title="Delete account and bank data" color="#A9362A" onPress={() => Alert.alert(
      "Delete everything?",
      "Connected Plaid Items will be revoked before account data is erased.",
      [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void deleteEverything() }],
    )} />
    <Button title="Sign out" onPress={() => void signOut()} />
    <Text>Existing local v1 data is never uploaded automatically. Claiming it requires a separate preview and explicit consent.</Text>
  </ScrollView>;
}

function parseCents(value: string): number | null { const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim()); if (!match) return null; const [whole = "", fraction = ""] = value.trim().split("."); const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0")); return Number.isSafeInteger(cents) ? cents : null; }
