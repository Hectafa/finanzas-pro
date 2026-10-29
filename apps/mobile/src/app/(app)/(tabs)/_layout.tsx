import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useTheme } from 'react-native-paper';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const icon = (name: IconName) => {
  const TabIcon = ({ color, size }: { color: ColorValue; size: number }) => (
    // React Navigation entrega colores de tema como texto; el valor numérico no aplica aquí.
    <MaterialCommunityIcons
      name={name}
      color={typeof color === 'number' ? undefined : (color ?? undefined)}
      size={size}
    />
  );
  return TabIcon;
};

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        headerTintColor: theme.colors.onSurface,
      }}
    >
      <Tabs.Screen
        name="inicio"
        options={{ title: 'Inicio', tabBarIcon: icon('home-variant-outline') }}
      />
      <Tabs.Screen
        name="movimientos"
        options={{ title: 'Movimientos', tabBarIcon: icon('swap-vertical') }}
      />
      <Tabs.Screen
        name="registrar"
        options={{
          title: 'Registrar',
          tabBarIcon: icon('plus-circle'),
          tabBarAccessibilityLabel: 'Registrar operación',
        }}
      />
      <Tabs.Screen
        name="negocio"
        options={{ title: 'Negocio', tabBarIcon: icon('storefront-outline') }}
      />
      <Tabs.Screen name="mas" options={{ title: 'Más', tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
