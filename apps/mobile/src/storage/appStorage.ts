import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Transaction } from '../domain/transaction';

const STORAGE_KEY = 'spending-companion:v1';

export type AppData = {
  transactions: readonly Transaction[];
  budgetIncludingUtilitiesCents: number;
  budgetExcludingUtilitiesCents: number;
  latestImportAt: string | null;
};

export async function loadAppData(): Promise<AppData | null> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored ? (JSON.parse(stored) as AppData) : null;
}

export async function saveAppData(data: AppData): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
