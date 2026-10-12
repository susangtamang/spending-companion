import { useEffect, useState } from "react";
import { Alert, Button, Platform, ScrollView, Switch, Text, View } from "react-native";
import { DemoBanner } from "../../components/DemoBanner";
import { demoMode } from "../../lib/mode";
import { useAppSession } from "../../lib/session";
import { openPlaidLinkWeb } from "../../lib/plaidWeb";

type Connection = { id: string; institutionName: string; health: string; lastSuccessfulSyncAt?: string };

async function loadPlaidLink() {
  try {
    return await import("react-native-plaid-link-sdk");
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("ReactNativePlaidLinkSdk")) {
      throw new Error("Plaid Link requires a custom Expo development build and is unavailable in Expo Go.");
    }
    throw cause;
  }
}

export default function Connect() {
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [error, setError] = useState("");
  const { api } = useAppSession();

  async function refresh() {
    if (demoMode || !api) return;
    try { setConnections(await api.get<Connection[]>("/v1/plaid/items")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load bank connections."); }
  }
  useEffect(() => { void refresh(); }, [api]);

  async function connect() {
    if (demoMode || !api) { Alert.alert("Demo mode", "Configure Clerk/API and install a custom development build. Plaid Link does not run in Expo Go."); return; }
    setBusy(true);
    try {
      if (!consentAccepted) throw new Error("Review and accept the financial-data consent before connecting.");
      const token = await api.post<{ linkToken: string; linkSessionId: string }>("/v1/plaid/link-token", { consentAccepted, consentVersion: "v1" });
      if (Platform.OS === "web") {
        await openPlaidLinkWeb({ token: token.linkToken, onExit: (linkError) => { setBusy(false); if (linkError) setError(linkError.display_message ?? "Connection was not completed."); }, onSuccess: async (publicToken, metadata) => { try { await api.post("/v1/plaid/exchange", { publicToken, linkSessionId: token.linkSessionId, institutionId: metadata.institution?.id, institutionName: metadata.institution?.name ?? "Connected institution" }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to exchange the connection."); } finally { setBusy(false); } } });
        return;
      }
      const { createPlaidLinkSession } = await loadPlaidLink();
      const session = await createPlaidLinkSession({
        token: token.linkToken,
        onEvent: () => undefined,
        onExit: ({ error: linkError }) => { setBusy(false); if (linkError) Alert.alert("Plaid Link", linkError.displayMessage ?? "Connection was not completed."); },
        onSuccess: async ({ publicToken, metadata }) => {
          try {
            await api.post("/v1/plaid/exchange", { publicToken, linkSessionId: token.linkSessionId, institutionId: metadata.institution?.id, institutionName: metadata.institution?.name ?? "Connected institution" });
            await refresh();
            Alert.alert("Connected", "Your bank connection is syncing.");
          } catch (cause) { Alert.alert("Bank connection", cause instanceof Error ? cause.message : "Unable to exchange the connection."); }
          finally { setBusy(false); }
        },
      });
      await session.open();
    } catch (cause) { setBusy(false); setError(cause instanceof Error ? cause.message : "Unable to connect."); }
  }

  async function sync(connection: Connection) { if (!api) return; try { await api.post(`/v1/plaid/items/${connection.id}/sync`); Alert.alert("Sync queued", `${connection.institutionName} will refresh shortly.`); } catch (cause) { Alert.alert("Sync", cause instanceof Error ? cause.message : "Unable to sync."); } }
  async function reconnect(connection: Connection) {
    if (!api) return;
    setBusy(true);
    try {
      const token = await api.post<{ linkToken: string }>(`/v1/plaid/items/${connection.id}/update-link-token`);
      if (Platform.OS === "web") { await openPlaidLinkWeb({ token: token.linkToken, onExit: () => setBusy(false), onSuccess: async () => { await sync(connection); setBusy(false); await refresh(); } }); return; }
      const { createPlaidLinkSession } = await loadPlaidLink();
      const session = await createPlaidLinkSession({ token: token.linkToken, onEvent: () => undefined, onExit: () => setBusy(false), onSuccess: async () => { await sync(connection); setBusy(false); await refresh(); } });
      await session.open();
    } catch (cause) { setBusy(false); Alert.alert("Reconnect", cause instanceof Error ? cause.message : "Unable to reconnect."); }
  }
  function disconnect(connection: Connection) { if (!api) return; Alert.alert("Disconnect bank", "Choose whether to retain transactions already imported. Either choice removes the Plaid Item and stops future synchronization.", [{ text: "Cancel", style: "cancel" }, { text: "Retain history", onPress: () => void remove(connection, "retain") }, { text: "Delete history", style: "destructive", onPress: () => void remove(connection, "delete") }]); }
  async function remove(connection: Connection, history: "retain" | "delete") { if (!api) return; try { await api.delete(`/v1/plaid/items/${connection.id}?transactionHistory=${history}`); await refresh(); } catch (cause) { Alert.alert("Disconnect", cause instanceof Error ? cause.message : "Unable to disconnect."); } }

  return <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
    <DemoBanner />
    <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "800" }}>Bank connections</Text>
    <Text>Plaid Link requires a custom Expo development build; it is unavailable in Expo Go. Spending Companion never receives your bank password.</Text>
    <Text>With your permission, Plaid provides account identity and up to two years of transaction history. You can disconnect at any time and choose whether imported history is retained or deleted.</Text>
    {error && <Text accessibilityRole="alert" style={{ color: "#A9362A" }}>{error}</Text>}
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}><Text style={{ flex: 1 }}>I consent to connect and synchronize my financial data.</Text><Switch accessibilityLabel="Consent to financial data synchronization" value={consentAccepted} onValueChange={setConsentAccepted} /></View>
    <Button title={busy ? "Opening…" : "Connect a US bank"} disabled={busy || !consentAccepted} onPress={connect} />
    {connections.length === 0 && <Text>No banks connected. You can continue with manual entry or CSV import.</Text>}
    {connections.map((connection) => <View key={connection.id} style={{ padding: 14, borderWidth: 1, borderColor: "#CBD5D1", borderRadius: 12, gap: 8 }}><Text style={{ fontWeight: "700" }}>{connection.institutionName}</Text><Text>{connection.health.replaceAll("_", " ")}</Text><Text>{connection.lastSuccessfulSyncAt ? `Last synced ${connection.lastSuccessfulSyncAt}` : "Initial synchronization pending"}</Text><Button title="Sync now" onPress={() => void sync(connection)} />{connection.health === "requires_update" && <Button title="Reconnect" onPress={() => void reconnect(connection)} />}<Button title="Disconnect" color="#A9362A" onPress={() => disconnect(connection)} /></View>)}
  </ScrollView>;
}
