import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { PlaybackProvider } from '../components/PlaybackContext';
import { AccountProvider, useAccount } from '../components/AccountContext';
import { FavoritesProvider } from '../components/FavoritesContext';
import MiniPlayerOverlay from '../components/MiniPlayerOverlay';
import ChatBot from '../components/ChatBot';
import QueueSheet from '../components/QueueSheet';
import { ThemeProvider } from '../themes/ThemeProvider';
import ThemeRestartRoute from '../themes/ThemeRestartRoute';

// Hand off the native splash as soon as the animated emblem is displayed.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Layout() {
  useFonts({
    NunitoRegular: Nunito_400Regular,
    NunitoMedium: Nunito_500Medium,
    NunitoSemiBold: Nunito_600SemiBold,
    NunitoBold: Nunito_700Bold,
    NunitoExtraBold: Nunito_800ExtraBold,
  });

  return <ThemeProvider><AccountProvider><AccountNavigator /></AccountProvider></ThemeProvider>;
}

function MusicLayout({ children, accountId }) {
  const pathname = usePathname();
  return <PlaybackProvider libraryId={accountId}><FavoritesProvider>
    {children}
    <ThemeRestartRoute />
    {pathname !== '/' && <MiniPlayerOverlay />}
    {pathname !== '/' && <QueueSheet />}
    {pathname === '/Music' && <ChatBot />}
  </FavoritesProvider></PlaybackProvider>;
}

function AccountNavigator() {
  const { account } = useAccount();
  return <Stack layout={({ children }) => account
    ? <MusicLayout key={account.id} accountId={account.id}>{children}</MusicLayout>
    : children} screenOptions={{
        headerTransparent: true,
        headerTintColor: '#fff',
        headerShadowVisible: true
    }}>
      <Stack.Protected guard={!account}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(account)}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="Music" options={{ headerShown: false }} />
      <Stack.Screen name="Artist" options={{ headerShown: false }} />
      <Stack.Screen name="Player" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="RecentlyPlayed" options={{ headerShown: false }} />
      <Stack.Screen name="Albums" options={{ headerShown: false }} />
      <Stack.Screen name="Search" options={{ headerShown: false }} />
      <Stack.Screen name="Library" options={{ headerShown: false }} />
      <Stack.Screen name="BenjiePlaylist" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="Settings" options={{ headerShown: false }} />
      <Stack.Screen name="podcast" options={{ headerShown: false }} />
      <Stack.Screen name="podcast-create" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>;
}
