import { useEffect, useState } from "react";
import { Button, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DemoBanner } from "../../components/DemoBanner";
import { demoMode } from "../../lib/mode";
import { useAppSession } from "../../lib/session";

type Breakdown = { id: string; label: string; amountCents: number };
type Summary = { budgetCents: number; postedCents: number; pendingCents: number; spentCents: number; availableCents: number; categoryBreakdown: Breakdown[]; merchantBreakdown: Breakdown[]; isStale: boolean; dataFreshAsOf?: string };
type BudgetMode = "including_utilities" | "excluding_utilities";
const demo: Summary = { budgetCents: 250000, postedCents: 4900, pendingCents: 2999, spentCents: 7899, availableCents: 242101, categoryBreakdown: [{ id: "g", label: "Groceries", amountCents: 4250 }, { id: "d", label: "Dining", amountCents: 650 }, { id: "u", label: "Utilities", amountCents: 2999 }], merchantBreakdown: [{ id: "m", label: "Neighborhood Market", amountCents: 4250 }], isStale: false };

export default function Dashboard() {
  const { api } = useAppSession();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [mode, setMode] = useState<BudgetMode>("including_utilities");
  const [summary, setSummary] = useState<Summary | null>(demoMode ? demo : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    if (!api) return;
    setBusy(true);
    setError("");
    try { setSummary(await api.get(`/v1/summaries/monthly?month=${month}&budgetMode=${mode}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Refresh failed. Showing last results."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [month, mode]);
  return <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void load()} />}>
    <DemoBanner />
    <View style={styles.month}><Button title="Previous" accessibilityLabel="Previous dashboard month" onPress={() => setMonth(changeMonth(month, -1))} /><Text>{month}</Text><Button title="Next" accessibilityLabel="Next dashboard month" onPress={() => setMonth(changeMonth(month, 1))} /></View>
    <View style={styles.mode}><Button title="Include utilities" disabled={mode === "including_utilities"} onPress={() => setMode("including_utilities")} /><Button title="Exclude utilities" disabled={mode === "excluding_utilities"} onPress={() => setMode("excluding_utilities")} /></View>
    <Text accessibilityRole="header" style={styles.title}>Spending Companion</Text>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!summary && busy ? <Text>Loading summary…</Text> : summary && <>
      <Text style={styles.label}>{summary.availableCents < 0 ? "Over budget" : "Still available"}</Text>
      <Text accessibilityLabel={`${Math.abs(summary.availableCents / 100).toFixed(2)} dollars ${summary.availableCents < 0 ? "over budget" : "available"}`} style={[styles.amount, summary.availableCents < 0 && styles.error]}>${Math.abs(summary.availableCents / 100).toFixed(2)}</Text>
      <Text>Budget ${(summary.budgetCents / 100).toFixed(2)} · Spent ${(summary.spentCents / 100).toFixed(2)}</Text>
      <Text>Posted ${(summary.postedCents / 100).toFixed(2)} · Pending ${(summary.pendingCents / 100).toFixed(2)}</Text>
      {(summary.isStale || error) && <Text style={styles.stale}>Data may be stale{summary.dataFreshAsOf ? ` · ${summary.dataFreshAsOf}` : ""}</Text>}
      <BreakdownList title="Categories" values={summary.categoryBreakdown} />
      <BreakdownList title="Merchants" values={summary.merchantBreakdown} />
    </>}
  </ScrollView>;
}

function BreakdownList({ title, values }: { title: string; values: Breakdown[] }) { return <><Text style={styles.heading}>{title}</Text>{values.length === 0 ? <Text>No spending in this view.</Text> : values.map((value) => <View style={styles.row} key={value.id}><Text>{value.label}</Text><Text>${(value.amountCents / 100).toFixed(2)}</Text></View>)}</>; }
function changeMonth(value: string, offset: number) { const [year, month] = value.split("-").map(Number); const date = new Date(year!, month! - 1 + offset, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
const styles = StyleSheet.create({ page: { padding: 20, gap: 10 }, month: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, mode: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, title: { fontSize: 28, fontWeight: "800", marginTop: 8 }, label: { fontSize: 17 }, amount: { fontSize: 40, fontWeight: "800" }, heading: { fontSize: 20, fontWeight: "700", marginTop: 18 }, row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth }, error: { color: "#A9362A" }, stale: { color: "#7A5C00" } });
