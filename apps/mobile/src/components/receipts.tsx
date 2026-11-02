import type { AttachmentDto, DuplicateAttachmentDetails } from '@finanzas/shared';
import { useRef, useState, type ReactNode } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  HelperText,
  Icon,
  IconButton,
  Portal,
  Text,
  useTheme,
} from 'react-native-paper';
import { ApiError } from '../lib/api';
import { API_URL } from '../lib/client';
import { confirmAction, notify } from '../lib/confirm';
import { describeDuplicates, resolveFileUrl } from '../lib/finance';
import { newId } from '../lib/id';
import { useAttachments, useRemoveAttachment, useUploadAttachment } from '../lib/queries';
import { pickReceipt, ReceiptPickError, receiptFormData, type ReceiptFile } from '../lib/receipts';
import { Field, styles } from './ui';

const THUMB = 96;

/** Mensaje claro para los errores de subida que el usuario puede resolver. */
function uploadErrorMessage(e: unknown): string {
  if (e instanceof ReceiptPickError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 413) return 'El archivo supera 10 MB';
    return Object.values(e.fieldErrors)[0] ?? e.message;
  }
  return 'No fue posible subir el comprobante. Intenta de nuevo';
}

interface PendingDuplicate {
  transactionId: string;
  file: ReceiptFile;
  id: string;
  details: DuplicateAttachmentDetails;
}

/**
 * Sube fotos de comprobante. Si el archivo ya existe en la empresa, abre un diálogo que muestra
 * dónde está y pide un motivo para adjuntarlo de todos modos. El `dialog` debe renderizarse.
 */
export function useReceiptUploader(currency: string) {
  const upload = useUploadAttachment();
  // Un id por foto: reintentar la misma foto (p. ej. tras un error de red) no la duplica.
  const ids = useRef(new Map<string, string>());
  const [pending, setPending] = useState<PendingDuplicate | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const send = async (
    transactionId: string,
    file: ReceiptFile,
    duplicateReason?: string,
  ): Promise<'done' | 'duplicate'> => {
    const id = ids.current.get(file.uri) ?? newId();
    ids.current.set(file.uri, id);
    try {
      await upload.mutateAsync({
        transactionId,
        form: await receiptFormData(file, { id, duplicateReason }),
      });
      ids.current.delete(file.uri);
      return 'done';
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_ATTACHMENT') {
        setReason('');
        setReasonError(undefined);
        setPending({ transactionId, file, id, details: e.details as DuplicateAttachmentDetails });
        return 'duplicate';
      }
      throw new Error(uploadErrorMessage(e));
    }
  };

  const confirmDuplicate = async () => {
    if (!pending) return;
    if (reason.trim().length < 3) {
      setReasonError('Explica brevemente por qué se repite');
      return;
    }
    try {
      await send(pending.transactionId, pending.file, reason.trim());
      setPending(null);
    } catch (e) {
      setReasonError((e as Error).message);
    }
  };

  const dialog = (
    <Portal>
      <Dialog visible={!!pending} onDismiss={() => setPending(null)} style={styles.dialog}>
        <Dialog.Title>Comprobante repetido</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">Esta misma foto ya está adjunta en:</Text>
          {pending
            ? describeDuplicates(pending.details, currency).map((line, i) => (
                <Text key={i} variant="bodyMedium" style={styles.mtSmall}>
                  • {line}
                </Text>
              ))
            : null}
          <Text variant="bodyMedium" style={[styles.mt, { marginBottom: 8 }]}>
            Si de verdad corresponde también a este movimiento, explica por qué. Quedará registrado.
          </Text>
          <Field
            label="Motivo"
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              setReasonError(undefined);
            }}
            error={reasonError}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => setPending(null)} disabled={upload.isPending}>
            No adjuntar
          </Button>
          <Button
            onPress={() => void confirmDuplicate()}
            loading={upload.isPending}
            disabled={upload.isPending}
          >
            Adjuntar de todos modos
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );

  return { send, dialog, uploading: upload.isPending };
}

/** Botones para tomar o elegir la foto. En la web solo se elige un archivo (no hay cámara). */
export function ReceiptPickButtons({
  onPicked,
  disabled,
}: {
  onPicked: (file: ReceiptFile) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const file = await pickReceipt(source);
      if (file) onPicked(file);
    } catch (e) {
      setError(uploadErrorMessage(e));
    }
  };
  return (
    <View>
      <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
        {Platform.OS !== 'web' ? (
          <Button
            mode="outlined"
            icon="camera-outline"
            onPress={() => void pick('camera')}
            disabled={disabled}
          >
            Tomar foto
          </Button>
        ) : null}
        <Button
          mode="outlined"
          icon="image-outline"
          onPress={() => void pick('library')}
          disabled={disabled}
        >
          {Platform.OS === 'web' ? 'Elegir imagen' : 'Elegir de la galería'}
        </Button>
      </View>
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </View>
  );
}

function Thumbnail({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: AttachmentDto;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const isImage = attachment.mimeType.startsWith('image/');
  return (
    <View>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Ver comprobante ${attachment.fileName}`}
        style={{
          width: THUMB,
          height: THUMB,
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceVariant,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isImage ? (
          <Image
            source={{ uri: resolveFileUrl(attachment.url, API_URL) }}
            style={{ width: THUMB, height: THUMB }}
            resizeMode="cover"
          />
        ) : (
          <>
            <Icon source="file-pdf-box" size={40} />
            <Text variant="labelSmall" numberOfLines={1} style={{ paddingHorizontal: 4 }}>
              {attachment.fileName}
            </Text>
          </>
        )}
      </Pressable>
      {attachment.duplicateReason ? (
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, width: THUMB }}>
          Repetido
        </Text>
      ) : null}
      {onRemove ? (
        <IconButton
          icon="close"
          size={14}
          mode="contained"
          onPress={onRemove}
          style={{ position: 'absolute', top: -8, right: -8, margin: 0 }}
          accessibilityLabel={`Retirar comprobante ${attachment.fileName}`}
        />
      ) : null}
    </View>
  );
}

/** Comprobantes de un movimiento: miniaturas, visor, agregar y retirar. */
export function ReceiptsSection({
  transactionId,
  currency,
  canEdit,
}: {
  transactionId: string;
  currency: string;
  canEdit: boolean;
}): ReactNode {
  const theme = useTheme();
  const list = useAttachments(transactionId);
  const remove = useRemoveAttachment();
  const uploader = useReceiptUploader(currency);
  const [viewing, setViewing] = useState<AttachmentDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (file: ReceiptFile) => {
    setError(null);
    try {
      await uploader.send(transactionId, file);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const open = (a: AttachmentDto) => {
    if (a.mimeType === 'application/pdf') void Linking.openURL(resolveFileUrl(a.url, API_URL));
    else setViewing(a);
  };

  const doRemove = async (a: AttachmentDto) => {
    const ok = await confirmAction({
      title: 'Retirar comprobante',
      message: 'Dejará de verse en el movimiento. El archivo se conserva en el historial.',
      confirmText: 'Retirar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ transactionId, id: a.id });
    } catch (e) {
      notify('No fue posible retirarlo', e instanceof ApiError ? e.message : 'Intenta de nuevo');
    }
  };

  const items = list.data ?? [];
  return (
    <View style={styles.mt}>
      <Text variant="titleSmall">Comprobantes</Text>
      {list.isPending ? <ActivityIndicator style={styles.mt} /> : null}
      {list.isError ? (
        <HelperText type="error">No se pudieron cargar los comprobantes</HelperText>
      ) : null}
      {!list.isPending && items.length === 0 ? (
        <Text
          variant="bodySmall"
          style={[styles.mtSmall, { color: theme.colors.onSurfaceVariant }]}
        >
          Sin comprobantes.
        </Text>
      ) : null}
      {items.length > 0 ? (
        <ScrollView horizontal contentContainerStyle={{ gap: 16, paddingVertical: 12 }}>
          {items.map((a) => (
            <Thumbnail
              key={a.id}
              attachment={a}
              onOpen={() => open(a)}
              onRemove={canEdit ? () => void doRemove(a) : undefined}
            />
          ))}
        </ScrollView>
      ) : null}
      {canEdit ? (
        <View style={styles.mtSmall}>
          {uploader.uploading ? (
            <View style={[styles.row, { gap: 8 }]}>
              <ActivityIndicator />
              <Text variant="bodyMedium">Subiendo…</Text>
            </View>
          ) : (
            <ReceiptPickButtons onPicked={(f) => void add(f)} />
          )}
          {error ? <HelperText type="error">{error}</HelperText> : null}
        </View>
      ) : null}
      {uploader.dialog}

      <Portal>
        <Dialog visible={!!viewing} onDismiss={() => setViewing(null)} style={styles.dialog}>
          <Dialog.Title numberOfLines={1}>{viewing?.fileName}</Dialog.Title>
          <Dialog.Content>
            {viewing ? (
              <Image
                source={{ uri: resolveFileUrl(viewing.url, API_URL) }}
                style={{ width: '100%', height: 420 }}
                resizeMode="contain"
                accessibilityLabel={`Comprobante ${viewing.fileName}`}
              />
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            {viewing ? (
              <Button onPress={() => void Linking.openURL(resolveFileUrl(viewing.url, API_URL))}>
                Abrir original
              </Button>
            ) : null}
            <Button onPress={() => setViewing(null)}>Cerrar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
