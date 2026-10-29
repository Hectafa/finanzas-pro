import type { ConfirmOptions } from './confirm';

/** Versión de navegador: los diálogos del sistema bloquean la página, igual que en el teléfono. */
export function confirmAction({ title, message }: ConfirmOptions): Promise<boolean> {
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}

export function notify(title: string, message: string): void {
  window.alert(`${title}\n\n${message}`);
}
