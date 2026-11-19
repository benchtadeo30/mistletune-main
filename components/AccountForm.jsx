import { useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image, ImageBackground } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import * as SplashScreen from 'expo-splash-screen';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../themes/ThemeProvider';
import { useAccount } from './AccountContext';
import { saveAccount } from './accountStore';

function luminance(hex) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function readable(background, preferred) {
  const a = luminance(background), b = luminance(preferred);
  if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5) return preferred;
  return a > 0.179 ? '#000000' : '#ffffff';
}

function Action({ children, onPress, busy, primary = false }) {
  const { theme: { colors } } = useTheme();
  const background = primary ? colors.gold : colors.surface;
  return <Pressable accessibilityRole="button" disabled={busy} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: primary ? colors.gold : colors.surfaceBorder, opacity: pressed || busy ? 0.65 : 1 }]}>
    <Text style={[styles.label, { color: readable(background, primary ? colors.ink : colors.cream) }]}>{children}</Text>
  </Pressable>;
}

async function pickPhoto() {
  const selection = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
  if (selection.canceled) return undefined;
  const uri = selection.assets[0].uri;
  let output;
  let context, original, thumbnail;
  try {
    context = ImageManipulator.manipulate(uri);
    original = await context.renderAsync();
    const size = Math.min(original.width, original.height);
    context.crop({ originX: Math.floor((original.width - size) / 2), originY: Math.floor((original.height - size) / 2), width: size, height: size });
    context.resize({ width: 256, height: 256 });
    thumbnail = await context.renderAsync();
    output = await thumbnail.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
    if (!output.base64) throw new Error();
    return 'data:image/jpeg;base64,' + output.base64;
  } catch {
    throw new Error('Couldn’t open that image. Try another photo.');
  } finally {
    thumbnail?.release();
    original?.release();
    context?.release();
    if (Platform.OS !== 'web') for (const path of [uri, output?.uri]) {
      if (path?.startsWith(Paths.cache.uri + (Paths.cache.uri.endsWith('/') ? '' : '/'))) {
        try { const file = new File(path); if (file.exists) await file.delete(); } catch {}
      }
    }
  }
}

function AccountPanel({ mode, initialEmail = '', onEdit, onClose }) {
  const { account, signIn, update, signOut, remove } = useAccount();
  const { theme } = useTheme();
  const c = theme.colors;
  const ink = readable(c.surface, c.cream);
  const [username, setUsername] = useState(account?.username || '');
  const [email, setEmail] = useState(account?.email || initialEmail);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [photo, setPhoto] = useState(account?.photo || null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const viewing = mode === 'view';
  const signingIn = mode === 'login';
  const editing = mode === 'edit';
  async function run(action) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) {
      const message = cause?.message || 'Couldn’t save this change. Try again.';
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally { locked.current = false; setBusy(false); }
  }
  async function submit() {
    const values = { username, email, password, confirmation, photo };
    if (signingIn) return signIn(email, password);
    if (editing) { await update(values); onClose(); return; }
    await saveAccount(null, values);
    router.dismissTo({ pathname: '/login', params: { email: email.trim() } });
  }
  const label = (value) => <Text style={[styles.label, { color: ink }]}>{value}</Text>;
  function field(title, value, onChangeText, options) {
    return <View style={styles.field}>{label(title)}
      <TextInput accessibilityLabel={title} editable={!busy} value={value} onChangeText={onChangeText}
        autoCapitalize="none" autoCorrect={false} {...options}
        style={[styles.input, { color: readable(c.surfaceDeep, c.cream), backgroundColor: c.surfaceDeep, borderColor: c.surfaceBorder }]} />
    </View>;
  }
  const avatar = photo ? <Image source={{ uri: photo }} contentFit="cover" style={styles.photo} />
    : <Ionicons name={viewing ? 'person-outline' : 'camera-outline'} size={32} color={readable(c.surfaceDeep, c.gold)} />;
  return <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.surfaceBorder }]}>
    <Text accessibilityRole="header" style={[styles.heading, { color: ink }]}>{viewing ? 'Account' : editing ? 'Edit account' : signingIn ? 'Log in' : 'Create account'}</Text>
    {!signingIn && (viewing ? <View style={[styles.avatar, { backgroundColor: c.surfaceDeep, borderColor: c.gold }]}>{avatar}</View> :
      <View style={styles.photoGroup}>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose profile photo" disabled={busy}
          onPress={() => run(async () => { const picked = await pickPhoto(); if (picked) setPhoto(picked); })}
          style={[styles.avatar, { backgroundColor: c.surfaceDeep, borderColor: c.gold }]}>{avatar}</Pressable>
        {label('Profile photo (optional)')}
        {photo && <Action busy={busy} onPress={() => setPhoto(null)}>Remove photo</Action>}
      </View>)}
    {viewing ? <>
      <Text style={[styles.name, { color: ink }]}>{account.username}</Text>
      <Text style={{ color: ink, textAlign: 'center' }}>{account.email}</Text>
      <Action busy={busy} primary onPress={onEdit}>Edit account</Action>
      <Action busy={busy} onPress={() => run(signOut)}>Log out</Action>
      <Action busy={busy} onPress={() => Alert.alert('Delete your account?', 'Your profile and this account’s music library will be removed from MistleTunes. Your original music files will stay on your device.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => run(remove) },
      ])}>Delete account</Action>
    </> : <>
      {!signingIn && field('Username', username, setUsername, { autoComplete: 'username', maxLength: 80 })}
      {field('Email', email, setEmail, { autoComplete: 'email', keyboardType: 'email-address', maxLength: 254 })}
      {field(editing ? 'New password (optional)' : 'Password', password, setPassword, { secureTextEntry: true, autoComplete: signingIn ? 'current-password' : 'new-password' })}
      {!signingIn && field('Confirm password', confirmation, setConfirmation, { secureTextEntry: true, autoComplete: 'new-password' })}
      <Action busy={busy} primary onPress={() => run(submit)}>{editing ? 'Save changes' : signingIn ? 'Log in' : 'Create account'}</Action>
      <Action busy={busy} onPress={editing ? onClose : signingIn ? () => router.push('/register') : () => router.dismissTo('/login')}>{editing ? 'Cancel' : signingIn ? 'Create account' : 'Back to login'}</Action>
    </>}
    {busy && <ActivityIndicator color={ink} />}
    {!!error && <Text accessibilityRole="alert" style={[styles.label, { color: ink }]}>{error}</Text>}
  </View>;
}

export function AccountSettings() {
  const [editing, setEditing] = useState(false);
  return <AccountPanel key={editing ? 'edit' : 'view'} mode={editing ? 'edit' : 'view'} onEdit={() => setEditing(true)} onClose={() => setEditing(false)} />;
}

export function AuthScreen({ mode }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const initialEmail = typeof params.email === 'string' ? params.email : '';
  return <ImageBackground source={theme.assets.settings} autoplay contentFit="cover"
    style={{ flex: 1, backgroundColor: theme.colors.primary }}>
    <KeyboardAvoidingView onLayout={() => SplashScreen.hide()} style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.page, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {theme.plain && <Image source={theme.assets.loadingCharacter} autoplay contentFit="contain" style={styles.mascot} />}
        <AccountPanel key={mode + initialEmail} mode={mode} initialEmail={initialEmail} />
      </ScrollView>
    </KeyboardAvoidingView>
  </ImageBackground>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, gap: 12 },
  panel: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: 20, gap: 12, borderRadius: 22, borderWidth: 1.5 },
  heading: { fontFamily: 'NunitoExtraBold', fontSize: 28 },
  label: { fontSize: 16, fontFamily: 'NunitoBold' },
  name: { fontSize: 20, textAlign: 'center', fontFamily: 'NunitoExtraBold' },
  avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, overflow: 'hidden', alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  photoGroup: { alignItems: 'center', gap: 6 },
  field: { gap: 4 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, fontSize: 16 },
  button: { borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  mascot: { width: 84, height: 84, alignSelf: 'center' },
});
