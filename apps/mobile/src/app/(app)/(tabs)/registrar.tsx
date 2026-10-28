import { List, Text } from 'react-native-paper';
import { Screen } from '../../../components/ui';

const ACTIONS = [
  { title: 'Ingreso', icon: 'arrow-down-bold-circle-outline', phase: 2 },
  { title: 'Gasto', icon: 'arrow-up-bold-circle-outline', phase: 2 },
  { title: 'Transferencia entre cuentas', icon: 'bank-transfer', phase: 2 },
  { title: 'Foto de comprobante', icon: 'camera-outline', phase: 2 },
  { title: 'Venta', icon: 'cash-register', phase: 3 },
  { title: 'Compra', icon: 'cart-outline', phase: 3 },
  { title: 'Pago o cobro', icon: 'handshake-outline', phase: 3 },
] as const;

export default function RegistrarScreen() {
  return (
    <Screen>
      <Text variant="bodyMedium">Registro rápido de operaciones. Se habilitará conforme avancen las fases.</Text>
      {ACTIONS.map((a) => (
        <List.Item
          key={a.title}
          title={a.title}
          description={`Disponible en la Fase ${a.phase}`}
          left={(p) => <List.Icon {...p} icon={a.icon} />}
          disabled
          accessibilityState={{ disabled: true }}
        />
      ))}
    </Screen>
  );
}
