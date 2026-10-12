import { Tabs } from "expo-router";
import { LiveGate } from "../../components/LiveGate";
export default function TabLayout() { return <LiveGate><Tabs screenOptions={{ headerStyle: { backgroundColor: "#F4F1E8" }, headerTintColor: "#153D35", tabBarActiveTintColor: "#175C4C" }}><Tabs.Screen name="index" options={{ title: "Dashboard" }} /><Tabs.Screen name="activity" options={{ title: "Activity" }} /><Tabs.Screen name="connect" options={{ title: "Banks" }} /><Tabs.Screen name="settings" options={{ title: "Settings" }} /></Tabs></LiveGate>; }
