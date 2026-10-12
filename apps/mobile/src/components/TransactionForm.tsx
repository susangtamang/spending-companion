import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseUsdToCents } from '../domain/money';
import type { Transaction, TransactionKind, TransactionStatus } from '../domain/transaction';

type TransactionFormProps = {
  onCancel: () => void;
  onSave: (transaction: Transaction) => void;
  initialTransaction?: Transaction | null;
  onDelete?: (transaction: Transaction) => void;
  requireCategory?: boolean;
};

export function TransactionForm({ onCancel, onSave, initialTransaction, onDelete, requireCategory = true }: TransactionFormProps) {
  const [merchant, setMerchant] = useState(initialTransaction?.merchant ?? '');
  const [amount, setAmount] = useState(initialTransaction ? String(initialTransaction.amountCents / 100) : '');
  const [category, setCategory] = useState(initialTransaction?.category ?? '');
  const [date, setDate] = useState(initialTransaction?.date ?? localDateString());
  const [status, setStatus] = useState<TransactionStatus>(initialTransaction?.status ?? 'posted');
  const [kind, setKind] = useState<TransactionKind>(initialTransaction?.kind ?? 'purchase');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const cleanMerchant = merchant.trim();
    const cleanCategory = category.trim();
    if (!cleanMerchant || (requireCategory && !cleanCategory)) {
      setError(requireCategory ? 'Merchant and category are required.' : 'Merchant is required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Date must use YYYY-MM-DD.');
      return;
    }

    try {
      onSave({
        ...initialTransaction,
        id: initialTransaction?.id ?? `manual-${Date.now()}`,
        merchant: cleanMerchant,
        amountCents: parseUsdToCents(amount),
        category: cleanCategory,
        status,
        kind,
        date,
        source: initialTransaction?.source ?? 'manual',
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save transaction.');
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.title}>{initialTransaction ? 'Edit transaction' : 'Add transaction'}</Text>
      <Text style={styles.label}>Merchant</Text>
      <TextInput style={styles.input} value={merchant} onChangeText={setMerchant} placeholder="Local market" autoCapitalize="words" />
      <Text style={styles.label}>Amount (USD)</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="42.50" keyboardType="decimal-pad" />
      <Text style={styles.label}>Category{requireCategory ? '' : ' (optional)'}</Text>
      <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="Groceries" autoCapitalize="words" />
      <Text style={styles.label}>Date</Text>
      <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
      <Text style={styles.label}>Status</Text>
      <View style={styles.statusRow}>
        {(['posted', 'pending'] as const).map((option) => (
          <Pressable key={option} onPress={() => setStatus(option)} style={[styles.statusButton, status === option && styles.statusButtonActive]}>
            <Text style={[styles.statusText, status === option && styles.statusTextActive]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Type</Text>
      <View style={styles.kindRow}>
        {(['purchase', 'refund', 'payment', 'transfer'] as const).map((option) => (
          <Pressable key={option} onPress={() => setKind(option)} style={[styles.kindButton, kind === option && styles.statusButtonActive]}>
            <Text style={[styles.kindText, kind === option && styles.statusTextActive]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Pressable onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        <Pressable onPress={submit} style={styles.primaryButton}><Text style={styles.primaryText}>Save</Text></Pressable>
      </View>
      {initialTransaction && onDelete && <Pressable onPress={() => onDelete(initialTransaction)} style={styles.deleteButton}><Text style={styles.deleteText}>Delete transaction</Text></Pressable>}
    </View>
  );
}

function localDateString(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const styles = StyleSheet.create({
  form: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 },
  title: { color: '#153D35', fontSize: 24, fontWeight: '800', marginBottom: 18 },
  label: { color: '#43504B', fontSize: 13, fontWeight: '700', marginBottom: 7, marginTop: 12 },
  input: { backgroundColor: '#F4F1E8', borderColor: '#D8D5CB', borderRadius: 12, borderWidth: 1, color: '#1D2E29', fontSize: 16, paddingHorizontal: 14, paddingVertical: 12 },
  statusRow: { flexDirection: 'row', gap: 10 },
  statusButton: { borderColor: '#C9CEC9', borderRadius: 12, borderWidth: 1, flex: 1, padding: 12 },
  statusButtonActive: { backgroundColor: '#DCEAE4', borderColor: '#175C4C' },
  statusText: { color: '#68726D', fontWeight: '600', textAlign: 'center', textTransform: 'capitalize' },
  statusTextActive: { color: '#175C4C' },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindButton: { borderColor: '#C9CEC9', borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9 },
  kindText: { color: '#68726D', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  error: { color: '#A9362A', fontSize: 13, marginTop: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  secondaryButton: { borderColor: '#B8BFBB', borderRadius: 14, borderWidth: 1, flex: 1, padding: 14 },
  secondaryText: { color: '#43504B', fontWeight: '700', textAlign: 'center' },
  primaryButton: { backgroundColor: '#175C4C', borderRadius: 14, flex: 1, padding: 14 },
  primaryText: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center' },
  deleteButton: { padding: 14 },
  deleteText: { color: '#A9362A', fontWeight: '700', textAlign: 'center' },
});
