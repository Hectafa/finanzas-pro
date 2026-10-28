import { PhaseNotice, Screen } from '../../../components/ui';

export default function MovimientosScreen() {
  return (
    <Screen>
      <PhaseNotice
        phase={2}
        description="Aquí verás ingresos, gastos y transferencias con búsqueda, filtros y estado de sincronización de cada operación."
      />
    </Screen>
  );
}
