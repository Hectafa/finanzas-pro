import { List } from 'react-native-paper';
import { Screen } from '../../../components/ui';

const MODULES = [
  { title: 'Ventas e ingresos', icon: 'cash-register', phase: 3 },
  { title: 'Compras', icon: 'cart-outline', phase: 3 },
  { title: 'Inventario y recetas', icon: 'food-variant', phase: 3 },
  { title: 'Cuentas por cobrar y pagar', icon: 'scale-balance', phase: 3 },
  { title: 'Terminales de pago', icon: 'credit-card-outline', phase: 3 },
  { title: 'Préstamos', icon: 'bank-outline', phase: 4 },
] as const;

export default function NegocioScreen() {
  return (
    <Screen>
      {MODULES.map((m) => (
        <List.Item
          key={m.title}
          title={m.title}
          description={`Disponible en la Fase ${m.phase}`}
          left={(p) => <List.Icon {...p} icon={m.icon} />}
          disabled
        />
      ))}
    </Screen>
  );
}
