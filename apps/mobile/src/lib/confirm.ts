import { Alert } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
}

/** Pide confirmación con el diálogo nativo. En web: confirm.web.ts (Alert.alert no muestra botones allí). */
export function confirmAction({
  title,
  message,
  confirmText,
  destructive,
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmText,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function notify(title: string, message: string): void {
  Alert.alert(title, message);
}
