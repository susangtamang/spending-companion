import { AuthView } from "@clerk/expo/native";
import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";
import { demoMode } from "../lib/mode";
import { useAppSession } from "../lib/session";
export function LiveGate({children}:PropsWithChildren){const {signedIn}=useAppSession();if(demoMode)return children;if(!signedIn)return <View style={{flex:1,padding:20}}><Text style={{fontSize:24,fontWeight:"800",marginBottom:16}}>Sign in with email code</Text><AuthView mode="signInOrUp" isDismissible={false}/></View>;return children;}
