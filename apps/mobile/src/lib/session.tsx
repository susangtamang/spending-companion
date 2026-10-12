import { useAuth, useClerk } from "@clerk/expo";
import { createContext, useContext, type PropsWithChildren } from "react";
import { SpendingApi } from "./api";
import { apiUrl } from "./mode";

type SessionValue = { signedIn: boolean; api: SpendingApi | null; getToken: (options?: { skipCache?: boolean }) => Promise<string | null>; signOut: () => Promise<void> };
const noToken = async (_options?: { skipCache?: boolean }) => null;
const noSignOut = async () => undefined;
const SessionContext = createContext<SessionValue>({ signedIn: false, api: null, getToken: noToken, signOut: noSignOut });
export function DemoSession({ children }: PropsWithChildren) { return <SessionContext.Provider value={{ signedIn:false, api:null, getToken:noToken, signOut:noSignOut }}>{children}</SessionContext.Provider>; }
export function LiveSession({ children }: PropsWithChildren) { const { isSignedIn, getToken } = useAuth(); const { signOut } = useClerk(); const api = new SpendingApi(apiUrl!, { getToken }); return <SessionContext.Provider value={{ signedIn:!!isSignedIn, api, getToken, signOut: async () => { await signOut(); } }}>{children}</SessionContext.Provider>; }
export function useAppSession() { return useContext(SessionContext); }
