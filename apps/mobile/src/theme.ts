import { MD3LightTheme, type MD3Theme } from 'react-native-paper';

export const theme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#0B5D4B',
    onPrimary: '#FFFFFF',
    primaryContainer: '#CDEBE1',
    onPrimaryContainer: '#002019',
    secondary: '#4A635C',
    secondaryContainer: '#CCE8DF',
    background: '#F7FAF8',
    surface: '#FFFFFF',
    error: '#B3261E',
  },
};
