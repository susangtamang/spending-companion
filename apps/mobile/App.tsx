import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CsvImport } from './src/components/CsvImport';
import { TransactionForm } from './src/components/TransactionForm';
import { sampleTransactions } from './src/data/sampleTransactions';
import { parseUsdToCents } from './src/domain/money';
import { calculateCategoryTotals, calculateSpendingSummary, formatUsd } from './src/domain/spending';
import type { Transaction } from './src/domain/transaction';
import { loadAppData, saveAppData, type AppData } from './src/storage/appStorage';

type Screen = 'home' | 'activity' | 'import' | 'settings';
const DEFAULT_DATA: AppData = {
  transactions: sampleTransactions,
  budgetIncludingUtilitiesCents: 250_000,
  budgetExcludingUtilitiesCents: 170_000,
  latestImportAt: null,
};

export default function App() {
  const [data, setData] = useState<AppData>(DEFAULT_DATA);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [excludeUtilities, setExcludeUtilities] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthString());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadAppData()
      .then((stored) => stored && setData(stored))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) saveAppData(data).catch(() => setNotice('Changes could not be saved on this device.'));
  }, [data, ready]);

  const budgetCents = excludeUtilities ? data.budgetExcludingUtilitiesCents : data.budgetIncludingUtilitiesCents;
  const summary = useMemo(
    () => calculateSpendingSummary(data.transactions, budgetCents, selectedMonth, excludeUtilities),
    [data.transactions, budgetCents, selectedMonth, excludeUtilities],
  );
  const categoryTotals = useMemo(() => calculateCategoryTotals(data.transactions, selectedMonth), [data.transactions, selectedMonth]);

  function addTransaction(transaction: Transaction) {
    setData((current) => ({
      ...current,
      transactions: editingTransaction
        ? current.transactions.map((item) => item.id === transaction.id ? transaction : item)
        : [transaction, ...current.transactions],
    }));
    setIsFormOpen(false);
    setEditingTransaction(null);
    setNotice(editingTransaction ? 'Transaction updated.' : 'Transaction added.');
  }

  function openAddForm() {
    setEditingTransaction(null);
    setIsFormOpen(true);
  }

  function openEditForm(transaction: Transaction) {
    setEditingTransaction(transaction);
    setIsFormOpen(true);
  }

  function requestDelete(transaction: Transaction) {
    Alert.alert('Delete transaction?', `${transaction.merchant} will be permanently removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== transaction.id) }));
        setIsFormOpen(false);
        setEditingTransaction(null);
        setNotice('Transaction deleted.');
      } },
    ]);
  }

  function markPosted(id: string) {
    setData((current) => ({
      ...current,
      transactions: current.transactions.map((transaction) =>
        transaction.id === id ? { ...transaction, status: 'posted' as const } : transaction,
      ),
    }));
    setNotice('Pending transaction marked as posted.');
  }

  function importTransactions(transactions: Transaction[], importedAt: string) {
    setData((current) => ({ ...current, transactions: [...transactions, ...current.transactions], latestImportAt: importedAt }));
    setNotice(`${transactions.length} transactions imported.`);
    setScreen('activity');
  }

  if (!ready) return <View style={styles.loading}><Text style={styles.muted}>Loading your spending data…</Text></View>;

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Header screen={screen} selectedMonth={selectedMonth} />
        {notice && <Pressable onPress={() => setNotice(null)} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></Pressable>}

        {screen === 'home' && (
          <>
            <MonthSelector month={selectedMonth} onChange={setSelectedMonth} />
            <View style={styles.segmented}>
              <Pressable onPress={() => setExcludeUtilities(false)} style={[styles.segment, !excludeUtilities && styles.segmentActive]}><Text style={[styles.segmentText, !excludeUtilities && styles.segmentTextActive]}>Including utilities</Text></Pressable>
              <Pressable onPress={() => setExcludeUtilities(true)} style={[styles.segment, excludeUtilities && styles.segmentActive]}><Text style={[styles.segmentText, excludeUtilities && styles.segmentTextActive]}>Excluding utilities</Text></Pressable>
            </View>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Still available</Text>
              <Text style={styles.heroAmount}>{formatUsd(summary.availableCents)}</Text>
              <Text style={styles.heroDetail}>of {formatUsd(summary.budgetCents)} monthly budget</Text>
            </View>
            <View style={styles.summaryRow}>
              <SummaryCard label="Posted" amountCents={summary.postedCents} accent="#175C4C" />
              <SummaryCard label="Pending" amountCents={summary.pendingCents} accent="#B45F06" />
            </View>
            <SectionTitle title="Where it is going" />
            <View style={styles.card}>
              {categoryTotals.map((item, index) => (
                <View key={item.category} style={[styles.row, index < categoryTotals.length - 1 && styles.divider]}>
                  <Text style={styles.capitalize}>{item.category}</Text><Text style={styles.amount}>{formatUsd(item.amountCents)}</Text>
                </View>
              ))}
              {categoryTotals.length === 0 && <Text style={styles.empty}>No purchases in this month.</Text>}
            </View>
          </>
        )}

        {screen === 'activity' && (
          <>
            <View style={styles.sectionHeader}><SectionTitle title="All transactions" /><Pressable onPress={openAddForm} style={styles.addButton}><Text style={styles.addButtonText}>+ Add</Text></Pressable></View>
            <View style={styles.card}>
              {data.transactions.map((transaction, index) => (
                <View key={transaction.id} style={[styles.transaction, index < data.transactions.length - 1 && styles.divider]}>
                  <View style={styles.transactionInfo}>
                    <Pressable onPress={() => openEditForm(transaction)}><Text style={styles.merchant}>{transaction.merchant}</Text></Pressable>
                    <Text style={styles.metadata}>{transaction.date} · {transaction.category} · {transaction.kind}</Text>
                    {transaction.status === 'pending' && <Pressable onPress={() => markPosted(transaction.id)}><Text style={styles.postAction}>Mark as posted</Text></Pressable>}
                  </View>
                  <View style={styles.amountColumn}><Text style={styles.amount}>{formatUsd(transaction.amountCents)}</Text><Text style={[styles.badge, transaction.status === 'pending' && styles.pending]}>{transaction.status}</Text></View>
                </View>
              ))}
            </View>
          </>
        )}

        {screen === 'import' && (
          <>
            <SectionTitle title="CSV preview & import" />
            <CsvImport existing={data.transactions} onImport={importTransactions} />
            <Text style={styles.importTime}>Latest import: {data.latestImportAt ? new Date(data.latestImportAt).toLocaleString() : 'Never'}</Text>
          </>
        )}

        {screen === 'settings' && <BudgetSettings data={data} onChange={setData} />}
      </ScrollView>

      <View style={styles.nav}>
        {(['home', 'activity', 'import', 'settings'] as const).map((item) => (
          <Pressable key={item} onPress={() => setScreen(item)} style={styles.navItem}><Text style={[styles.navText, screen === item && styles.navActive]}>{item}</Text></Pressable>
        ))}
      </View>

      <Modal visible={isFormOpen} transparent animationType="slide" onRequestClose={() => setIsFormOpen(false)}>
        <View style={styles.modalBackdrop}><ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled"><TransactionForm initialTransaction={editingTransaction} onCancel={() => { setIsFormOpen(false); setEditingTransaction(null); }} onSave={addTransaction} onDelete={requestDelete} /></ScrollView></View>
      </Modal>
    </View>
  );
}

function Header({ screen, selectedMonth }: { screen: Screen; selectedMonth: string }) {
  const titles: Record<Screen, string> = { home: 'Spending Companion', activity: 'Activity', import: 'Import', settings: 'Settings' };
  return <View style={styles.header}><Text style={styles.eyebrow}>{formatMonth(selectedMonth).toUpperCase()}</Text><Text style={styles.title}>{titles[screen]}</Text>{screen === 'home' && <Text style={styles.subtitle}>Verified spending math. Clear decisions.</Text>}</View>;
}

function MonthSelector({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return <View style={styles.monthRow}><Pressable accessibilityLabel="Previous month" onPress={() => onChange(changeMonth(month, -1))} style={styles.monthButton}><Text style={styles.monthButtonText}>‹</Text></Pressable><Text style={styles.monthLabel}>{formatMonth(month)}</Text><Pressable accessibilityLabel="Next month" onPress={() => onChange(changeMonth(month, 1))} style={styles.monthButton}><Text style={styles.monthButtonText}>›</Text></Pressable></View>;
}

function SectionTitle({ title }: { title: string }) { return <Text style={styles.sectionTitle}>{title}</Text>; }

function SummaryCard({ label, amountCents, accent }: { label: string; amountCents: number; accent: string }) {
  return <View style={styles.summaryCard}><View style={[styles.dot, { backgroundColor: accent }]} /><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryAmount}>{formatUsd(amountCents)}</Text></View>;
}

function BudgetSettings({ data, onChange }: { data: AppData; onChange: (data: AppData) => void }) {
  const [including, setIncluding] = useState(String(data.budgetIncludingUtilitiesCents / 100));
  const [excluding, setExcluding] = useState(String(data.budgetExcludingUtilitiesCents / 100));
  const [error, setError] = useState<string | null>(null);
  function save() {
    try {
      onChange({ ...data, budgetIncludingUtilitiesCents: parseUsdToCents(including), budgetExcludingUtilitiesCents: parseUsdToCents(excluding) });
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid budget.'); }
  }
  return <View><SectionTitle title="Monthly budgets" /><Text style={styles.label}>Including utilities</Text><TextInput style={styles.input} value={including} onChangeText={setIncluding} keyboardType="decimal-pad" /><Text style={styles.label}>Excluding utilities</Text><TextInput style={styles.input} value={excluding} onChangeText={setExcluding} keyboardType="decimal-pad" />{error && <Text style={styles.error}>{error}</Text>}<Pressable onPress={save} style={styles.saveButton}><Text style={styles.saveText}>Save budgets</Text></Pressable><Text style={styles.privacy}>Data is stored only on this device in this demo. No bank credentials or cloud account are used.</Text></View>;
}

function currentMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function changeMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const changed = new Date(year!, monthNumber! - 1 + offset, 1);
  return `${changed.getFullYear()}-${String(changed.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year!, monthNumber! - 1, 1));
}

const styles = StyleSheet.create({
  app: { backgroundColor: '#F4F1E8', flex: 1 }, loading: { alignItems: 'center', backgroundColor: '#F4F1E8', flex: 1, justifyContent: 'center' }, content: { paddingBottom: 120, paddingHorizontal: 20, paddingTop: 68 },
  header: { marginBottom: 24 }, eyebrow: { color: '#68726D', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginBottom: 7 }, title: { color: '#153D35', fontSize: 32, fontWeight: '800', letterSpacing: -0.8 }, subtitle: { color: '#56615D', fontSize: 15, marginTop: 8 }, muted: { color: '#68726D' },
  notice: { backgroundColor: '#DCEAE4', borderRadius: 12, marginBottom: 16, padding: 12 }, noticeText: { color: '#175C4C', fontSize: 13, fontWeight: '600' },
  monthRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }, monthButton: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, height: 38, justifyContent: 'center', width: 44 }, monthButtonText: { color: '#175C4C', fontSize: 28, lineHeight: 30 }, monthLabel: { color: '#1D2E29', fontSize: 15, fontWeight: '700' },
  segmented: { backgroundColor: '#E4E1D8', borderRadius: 12, flexDirection: 'row', marginBottom: 14, padding: 3 }, segment: { borderRadius: 10, flex: 1, padding: 9 }, segmentActive: { backgroundColor: '#FFFFFF' }, segmentText: { color: '#68726D', fontSize: 12, textAlign: 'center' }, segmentTextActive: { color: '#153D35', fontWeight: '700' },
  heroCard: { backgroundColor: '#153D35', borderRadius: 24, elevation: 5, padding: 24, shadowColor: '#153D35', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 18 }, heroLabel: { color: '#C9D9D2', fontSize: 14, fontWeight: '600' }, heroAmount: { color: '#FFFFFF', fontSize: 44, fontWeight: '800', letterSpacing: -1.4, marginVertical: 8 }, heroDetail: { color: '#C9D9D2', fontSize: 14 },
  summaryRow: { flexDirection: 'row', gap: 12, marginTop: 14 }, summaryCard: { backgroundColor: '#FFFFFF', borderRadius: 18, flex: 1, padding: 18 }, dot: { borderRadius: 5, height: 10, marginBottom: 14, width: 10 }, summaryLabel: { color: '#68726D', fontSize: 13, fontWeight: '600' }, summaryAmount: { color: '#1D2E29', fontSize: 20, fontWeight: '700', marginTop: 5 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, sectionTitle: { color: '#1D2E29', fontSize: 20, fontWeight: '700', marginBottom: 12, marginTop: 24 }, card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 18 }, row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 16 }, divider: { borderBottomColor: '#E8E5DC', borderBottomWidth: StyleSheet.hairlineWidth }, capitalize: { color: '#1D2E29', fontSize: 15, textTransform: 'capitalize' }, amount: { color: '#1D2E29', fontSize: 15, fontWeight: '700' },
  empty: { color: '#68726D', paddingVertical: 20, textAlign: 'center' },
  addButton: { backgroundColor: '#DCEAE4', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 }, addButtonText: { color: '#175C4C', fontSize: 14, fontWeight: '700' }, transaction: { alignItems: 'center', flexDirection: 'row', paddingVertical: 16 }, transactionInfo: { flex: 1, paddingRight: 10 }, merchant: { color: '#1D2E29', fontSize: 16, fontWeight: '600' }, metadata: { color: '#7A817E', fontSize: 12, marginTop: 4, textTransform: 'capitalize' }, postAction: { color: '#175C4C', fontSize: 12, fontWeight: '700', marginTop: 7 }, amountColumn: { alignItems: 'flex-end' }, badge: { color: '#175C4C', fontSize: 10, fontWeight: '700', marginTop: 5, textTransform: 'uppercase' }, pending: { color: '#B45F06' },
  importTime: { color: '#68726D', fontSize: 12, marginTop: 18 }, label: { color: '#43504B', fontSize: 13, fontWeight: '700', marginBottom: 7, marginTop: 12 }, input: { backgroundColor: '#FFFFFF', borderColor: '#D8D5CB', borderRadius: 12, borderWidth: 1, color: '#1D2E29', fontSize: 16, padding: 13 }, error: { color: '#A9362A', fontSize: 13, marginTop: 12 }, saveButton: { backgroundColor: '#175C4C', borderRadius: 14, marginTop: 20, padding: 15 }, saveText: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center' }, privacy: { color: '#68726D', fontSize: 12, lineHeight: 18, marginTop: 24 },
  nav: { backgroundColor: '#FFFFFF', borderTopColor: '#DDDAD1', borderTopWidth: StyleSheet.hairlineWidth, bottom: 0, flexDirection: 'row', left: 0, paddingBottom: 24, paddingTop: 12, position: 'absolute', right: 0 }, navItem: { flex: 1 }, navText: { color: '#858C88', fontSize: 12, textAlign: 'center', textTransform: 'capitalize' }, navActive: { color: '#175C4C', fontWeight: '800' },
  modalBackdrop: { backgroundColor: 'rgba(15,31,26,0.45)', flex: 1, justifyContent: 'flex-end' }, modalScroll: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 50 },
});
