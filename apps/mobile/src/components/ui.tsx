import type { MetricDto } from '@finanzas/shared';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type KeyboardTypeOptions } from 'react-native';
import {
  ActivityIndicator,
  Banner,
  Button,
  Card,
  Chip,
  Dialog,
  HelperText,
  Icon,
  List,
  Portal,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays } from '@finanzas/shared';
import { formatDate, formatMoney, metricStatusLabel, parseDisplayDate } from '../lib/format';

/** Ancho máximo del contenido en pantallas grandes (computadora, tableta): evita líneas y formularios estirados. */
export const CONTENT_MAX_WIDTH = 960;

/** `narrow`: formularios cortos (inicio de sesión, registro) que en computadora se ven mejor angostos. */
export function Screen({
  children,
  scroll = true,
  narrow = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  narrow?: boolean;
}) {
  const theme = useTheme();
  const content = <View style={[styles.content, narrow && styles.narrow]}>{children}</View>;
  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      edges={['bottom', 'left', 'right']}
    >
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'email' | 'password' | 'new-password' | 'name' | 'off';
  multiline?: boolean;
  placeholder?: string;
  /** Texto fijo antes del valor, p. ej. "$" en importes. */
  prefix?: string;
}) {
  return (
    <View>
      <TextInput
        mode="outlined"
        label={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        error={!!props.error}
        secureTextEntry={props.secure}
        keyboardType={props.keyboardType}
        autoComplete={props.autoComplete}
        multiline={props.multiline}
        placeholder={props.placeholder}
        left={props.prefix ? <TextInput.Affix text={props.prefix} /> : undefined}
        autoCapitalize={
          props.keyboardType === 'email-address' || props.secure ? 'none' : 'sentences'
        }
        accessibilityLabel={props.label}
      />
      <HelperText type="error" visible={!!props.error}>
        {props.error ?? ' '}
      </HelperText>
    </View>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  /** Sangría para opciones hijas (p. ej. subcategorías). */
  indent?: boolean;
}

/**
 * Campo de selección: se ve como un campo de texto y abre una lista en un diálogo.
 * Funciona igual en teléfono y en web (Paper no trae un select nativo).
 */
export function SelectField(props: {
  label: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  error?: string;
  /** Texto cuando no hay opciones (p. ej. "Primero crea una cuenta"). */
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = props.options.find((o) => o.value === props.value);
  return (
    <View>
      {/* La zona táctil va encima del campo como hermana, no lo envuelve: en web el ícono del
          campo es un <button> y no puede quedar dentro de otro botón. */}
      <View>
        <TextInput
          mode="outlined"
          label={props.label}
          value={selected?.label ?? ''}
          error={!!props.error}
          editable={false}
          disabled={props.disabled}
          right={<TextInput.Icon icon="menu-down" />}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setOpen(true)}
          disabled={props.disabled}
          accessibilityRole="button"
          accessibilityLabel={`${props.label}: ${selected?.label ?? 'sin seleccionar'}`}
        />
      </View>
      <HelperText type="error" visible={!!props.error}>
        {props.error ?? ' '}
      </HelperText>
      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.dialog}>
          <Dialog.Title>{props.label}</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView>
              {props.options.length === 0 ? (
                <Text variant="bodyMedium" style={styles.mt}>
                  {props.emptyText ?? 'No hay opciones disponibles'}
                </Text>
              ) : null}
              {props.options.map((o) => (
                <List.Item
                  key={o.value}
                  title={o.label}
                  description={o.description}
                  style={o.indent ? { paddingLeft: 24 } : undefined}
                  left={(p) => (
                    <List.Icon
                      {...p}
                      icon={o.value === props.value ? 'radiobox-marked' : 'radiobox-blank'}
                    />
                  )}
                  onPress={() => {
                    props.onChange(o.value);
                    setOpen(false);
                  }}
                  accessibilityState={{ selected: o.value === props.value }}
                />
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setOpen(false)}>Cerrar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

/**
 * Fecha de negocio. Se escribe como DD/MM/AAAA y se entrega como YYYY-MM-DD. `today` es "hoy" en
 * la zona de la empresa (no la del teléfono). Mientras el texto no sea una fecha válida, entrega
 * el texto tal cual para que la validación del formulario lo rechace.
 */
export function DateField(props: {
  label: string;
  value: string;
  today: string;
  onChange: (iso: string) => void;
  error?: string;
}) {
  const [text, setText] = useState(() =>
    parseDisplayDate(formatDate(props.value)) ? formatDate(props.value) : '',
  );
  const [typed, setTyped] = useState(false);
  const yesterday = addDays(props.today, -1);
  const pick = (iso: string) => {
    setTyped(false);
    setText(formatDate(iso));
    props.onChange(iso);
  };
  const localError = typed && !parseDisplayDate(text) ? 'Usa el formato DD/MM/AAAA' : undefined;
  return (
    <View>
      <View style={[styles.row, { gap: 8, marginBottom: 8 }]}>
        <Chip
          selected={props.value === props.today}
          showSelectedCheck
          onPress={() => pick(props.today)}
        >
          Hoy
        </Chip>
        <Chip
          selected={props.value === yesterday}
          showSelectedCheck
          onPress={() => pick(yesterday)}
        >
          Ayer
        </Chip>
      </View>
      <Field
        label={props.label}
        value={text}
        placeholder="DD/MM/AAAA"
        keyboardType="numbers-and-punctuation"
        onChangeText={(t) => {
          setTyped(true);
          setText(t);
          props.onChange(parseDisplayDate(t) ?? t);
        }}
        error={localError ?? props.error}
      />
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <Banner visible={!!message} icon="alert-circle-outline">
      {message ?? ''}
    </Banner>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLabel={label}>
      <ActivityIndicator />
      <Text variant="bodyMedium" style={styles.mt}>
        {label}
      </Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner
      visible
      icon="cloud-alert"
      actions={onRetry ? [{ label: 'Reintentar', onPress: onRetry }] : []}
    >
      {message}
    </Banner>
  );
}

/** Cifra del dashboard. El estado se muestra con texto e ícono además del color. */
export function MetricCard({
  title,
  metric,
  currency,
}: {
  title: string;
  metric: MetricDto;
  currency: string;
}) {
  const theme = useTheme();
  const icon =
    metric.status === 'CONFIRMED'
      ? 'check-circle-outline'
      : metric.status === 'ESTIMATED'
        ? 'progress-clock'
        : 'minus-circle-outline';
  const statusText = metricStatusLabel(metric.status);
  return (
    <Card
      mode="outlined"
      style={styles.metric}
      accessibilityLabel={`${title}: ${metric.value === null ? statusText : formatMoney(metric.value, currency)}`}
    >
      <Card.Content>
        <Text variant="labelLarge" style={{ color: theme.colors.secondary }}>
          {title}
        </Text>
        <Text variant="headlineSmall" style={styles.mtSmall}>
          {formatMoney(metric.value, currency)}
        </Text>
        <View style={[styles.row, styles.mtSmall]}>
          <Icon source={icon} size={16} color={theme.colors.onSurfaceVariant} />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 4 }}>
            {statusText}
          </Text>
        </View>
        {metric.note ? (
          <Text
            variant="bodySmall"
            style={[styles.mtSmall, { color: theme.colors.onSurfaceVariant }]}
          >
            {metric.note}
          </Text>
        ) : null}
      </Card.Content>
    </Card>
  );
}

/** Aviso honesto para módulos que aún no existen. */
export function PhaseNotice({ phase, description }: { phase: number; description: string }) {
  return (
    <Card mode="contained" style={styles.mtLarge}>
      <Card.Title
        title={`Disponible en la Fase ${phase}`}
        left={(p) => <Icon {...p} source="hammer-wrench" />}
      />
      <Card.Content>
        <Text variant="bodyMedium">{description}</Text>
      </Card.Content>
    </Card>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: {
    padding: 16,
    gap: 4,
    flexGrow: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  narrow: { maxWidth: 480 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center' },
  metric: { flexBasis: '47%', flexGrow: 1 },
  permissionGroup: { flexBasis: '47%', flexGrow: 1, minWidth: 260 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  mt: { marginTop: 12 },
  mtSmall: { marginTop: 4 },
  mtLarge: { marginTop: 24 },
  dialog: { maxWidth: 520, width: '92%', alignSelf: 'center', maxHeight: '80%' },
  dialogScroll: { paddingHorizontal: 0, maxHeight: 420 },
});
