import { StyleSheet, Text, View } from "react-native";
import { demoMode } from "../lib/mode";
export function DemoBanner() { return demoMode ? <View style={s.box}><Text style={s.text}>DEMO MODE · Local sample data only. No bank is connected.</Text></View> : null; }
const s = StyleSheet.create({ box: { backgroundColor: "#FFF1C7", padding: 10 }, text: { color: "#765A00", fontSize: 12, fontWeight: "700", textAlign: "center" } });
