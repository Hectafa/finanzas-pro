import * as Device from 'expo-device';
import { Platform } from 'react-native';

/** Nombre que el usuario verá en "Sesiones activas". */
export function deviceName(): string | undefined {
  // En web no hay nombre de dispositivo; se identifica por navegador y sistema operativo.
  const name = Platform.OS === 'web' ? webName() : (Device.deviceName ?? Device.modelName);
  return name ? name.slice(0, 80) : undefined;
}

function webName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navegador';
  return Device.osName ? `${browser} en ${Device.osName}` : browser;
}
