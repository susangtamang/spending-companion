import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CSV_HEADER, previewCsv } from '../domain/csv';
import type { Transaction } from '../domain/transaction';

type CsvImportProps = {
  existing: readonly Transaction[];
  onImport: (transactions: Transaction[], importedAt: string) => void;
};

const EXAMPLE = `${CSV_HEADER}\nbank-1001,2026-10-09,Neighborhood Market,63.24,posted,groceries,purchase\nbank-1002,2026-10-09,Corner Cafe,8.75,pending,dining,purchase`;

export function CsvImport({ existing, onImport }: CsvImportProps) {
  const [csv, setCsv] = useState(EXAMPLE);
  const now = new Date().toISOString();
  const preview = useMemo(() => previewCsv(csv, existing, now), [csv, existing, now]);

  return (
    <View>
      <Text style={styles.help}>Paste CSV using this exact header. Quoted merchant names containing commas are supported.</Text>
      <Text style={styles.header}>{CSV_HEADER}</Text>
      <TextInput
        multiline
        value={csv}
        onChangeText={setCsv}
        style={styles.editor}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={styles.summary}>
        <Text style={styles.good}>{preview.transactions.length} ready</Text>
        <Text style={styles.duplicate}>{preview.duplicates.length} duplicates skipped</Text>
        <Text style={styles.bad}>{preview.errors.length} errors</Text>
      </View>
      {preview.errors.map((error) => <Text key={error} style={styles.error}>{error}</Text>)}
      <Pressable
        disabled={preview.transactions.length === 0 || preview.errors.length > 0}
        onPress={() => onImport(preview.transactions, now)}
        style={[styles.button, (preview.transactions.length === 0 || preview.errors.length > 0) && styles.disabled]}
      >
        <Text style={styles.buttonText}>Import verified rows</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  help: { color: '#56615D', fontSize: 14, lineHeight: 20 },
  header: { color: '#175C4C', fontFamily: 'monospace', fontSize: 11, marginTop: 14 },
  editor: { backgroundColor: '#FFFFFF', borderColor: '#D8D5CB', borderRadius: 14, borderWidth: 1, color: '#1D2E29', fontFamily: 'monospace', fontSize: 12, height: 190, marginTop: 10, padding: 14, textAlignVertical: 'top' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  good: { color: '#175C4C', fontSize: 13, fontWeight: '700' },
  duplicate: { color: '#8A5B10', fontSize: 13 },
  bad: { color: '#A9362A', fontSize: 13 },
  error: { color: '#A9362A', fontSize: 12, marginTop: 8 },
  button: { backgroundColor: '#175C4C', borderRadius: 14, marginTop: 20, padding: 15 },
  disabled: { opacity: 0.35 },
  buttonText: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center' },
});
