import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { clerkKey, demoMode } from "../lib/mode";
import { DemoSession, LiveSession } from "../lib/session";

function Routes() { return <Stack screenOptions={{ headerShown: false }} />; }
export default function RootLayout() {
  if (demoMode) return <DemoSession><Routes /></DemoSession>;
  return <ClerkProvider publishableKey={clerkKey!} tokenCache={tokenCache}><LiveSession><Routes /></LiveSession></ClerkProvider>;
}
