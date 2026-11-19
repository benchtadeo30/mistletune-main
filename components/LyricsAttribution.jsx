import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function Contributor({ label, contributor }) {
  if (!contributor?.name) return null;
  if (!contributor.url) return <Text style={styles.text}> · {label} {contributor.name}</Text>;
  return <>
    <Text style={styles.text}> · {label} </Text>
    <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(contributor.url).catch(() => {}); }}>
      <Text style={[styles.text, styles.link]}>{contributor.name}</Text>
    </Pressable>
  </>;
}

export default function LyricsAttribution({ attribution }) {
  if (!attribution?.provider) return null;
  return <View style={styles.row}>
    <Text style={styles.text}>{attribution.provider}</Text>
    <Contributor label="Uploaded by" contributor={attribution.uploader} />
    <Contributor label="Made by" contributor={attribution.maker} />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', paddingVertical: 12 },
  text: { color: '#a9b99f', fontSize: 11, lineHeight: 16 },
  link: { textDecorationLine: 'underline' },
});
