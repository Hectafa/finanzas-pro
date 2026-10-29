import * as Device from 'expo-device';

/** Nombre que el usuario verá en "Sesiones activas". */
export function deviceName(): string | undefined {
  const name = Device.deviceName ?? Device.modelName;
  return name ? name.slice(0, 80) : undefined;
}
