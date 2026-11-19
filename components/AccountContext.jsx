import { createContext, useContext, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { cleanRemovedLibraries, currentAccount, deleteAccount, login, logout, saveAccount } from './accountStore';

const AccountContext = createContext(null);
export const useAccount = () => useContext(AccountContext);

export function AccountProvider({ children }) {
  const [account, setAccount] = useState(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    currentAccount().then(value => {
      if (active) setAccount(value);
      cleanRemovedLibraries().catch(() => {});
    }).catch(() => {
      if (active) { setFailed(true); SplashScreen.hide(); }
    });
    return () => { active = false; };
  }, [attempt]);
  if (failed) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', gap: 16 }}>
    <Text>Couldn’t open accounts on this device.</Text>
    <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(n => n + 1); }}><Text>Try again</Text></Pressable>
  </View>;
  if (account === undefined) return null;
  return <AccountContext.Provider value={{
    account,
    signIn: async (email, password) => setAccount(await login(email, password)),
    update: async values => setAccount(await saveAccount(account.id, values)),
    signOut: async () => { await logout(); setAccount(null); },
    remove: async () => {
      await deleteAccount(account.id);
      setAccount(null);
      cleanRemovedLibraries().catch(() => {});
    },
  }}>{children}</AccountContext.Provider>;
}
