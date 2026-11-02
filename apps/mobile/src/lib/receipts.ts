import { ATTACHMENT_MAX_BYTES } from '@finanzas/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { receiptFileName } from './finance';

/** Foto lista para subir: siempre JPG reducido, sin importar cómo la entregó la cámara o la galería. */
export interface ReceiptFile {
  uri: string;
  name: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/** Lado mayor de la foto: suficiente para leer un ticket (y para el OCR de la Fase 5). */
export const RECEIPT_MAX_SIDE = 2000;
const JPEG_QUALITY = 0.7;

export class ReceiptPickError extends Error {}

/**
 * Abre la cámara o la galería y devuelve la foto reducida a JPG. null si el usuario cancela.
 * La conversión a JPG también resuelve las fotos HEIC del iPhone, que el servidor no acepta.
 */
export async function pickReceipt(source: 'camera' | 'library'): Promise<ReceiptFile | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new ReceiptPickError(
        'Sin permiso para usar la cámara. Actívalo en los ajustes del teléfono.',
      );
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > RECEIPT_MAX_SIDE) {
    context.resize(
      asset.width >= asset.height ? { width: RECEIPT_MAX_SIDE } : { height: RECEIPT_MAX_SIDE },
    );
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return {
    uri: saved.uri,
    name: receiptFileName(asset.fileName),
    mimeType: 'image/jpeg',
    width: saved.width,
    height: saved.height,
  };
}

/**
 * Cuerpo multipart para la API. En el teléfono, React Native lee el archivo desde su uri; en la
 * web hay que entregarle un Blob.
 */
export async function receiptFormData(
  file: ReceiptFile,
  fields: { id: string; duplicateReason?: string },
): Promise<FormData> {
  const form = new FormData();
  form.append('id', fields.id);
  if (fields.duplicateReason) form.append('duplicateReason', fields.duplicateReason);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    if (blob.size > ATTACHMENT_MAX_BYTES) {
      throw new ReceiptPickError('La foto supera 10 MB incluso reducida');
    }
    form.append('file', blob, file.name);
  } else {
    // Forma que React Native entiende para adjuntar un archivo local.
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
  return form;
}
