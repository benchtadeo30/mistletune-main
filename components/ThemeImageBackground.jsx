import { ImageBackground } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { useTheme } from '../themes/ThemeProvider';

/** Keeps plain Default pages filled by the selected color when artwork is disabled. */
export default function ThemeImageBackground({ source, style, ...props }) {
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  return (
    <ImageBackground
      {...props}
      autoplay={isFocused && props.autoplay !== false}
      source={theme.id === 'default' ? null : source}
      style={[style, theme.id === 'default' && { backgroundColor: theme.colors.primary }]}
    />
  );
}
