import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, type OrderStatus } from '@digecom/shared';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, toneColors } from '../theme';

export function T({
  style,
  weight = 'regular',
  ...props
}: TextProps & { weight?: keyof typeof fonts }) {
  return <Text {...props} style={[{ fontFamily: fonts[weight], color: colors.ink }, style]} />;
}

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing,
}: {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const content = <View style={s.screenInner}>{children}</View>;
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
            ) : undefined
          }
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'orange' | 'outline' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const v = variants[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: v.bg, borderColor: v.border },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <T weight="semibold" style={{ color: v.fg, fontSize: 15 }}>
          {label}
        </T>
      )}
    </Pressable>
  );
}

const variants = {
  primary: { bg: colors.blue, fg: colors.white, border: colors.blue },
  orange: { bg: colors.orange, fg: colors.ink, border: colors.orange },
  outline: { bg: colors.white, fg: colors.blue, border: colors.blue },
  danger: { bg: colors.white, fg: colors.red, border: colors.red },
  ghost: { bg: 'transparent', fg: colors.muted, border: 'transparent' },
};

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <T weight="medium" style={s.label}>
        {label}
      </T>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        style={[s.input, error ? { borderColor: colors.red } : null, props.style]}
      />
      {error ? <T style={s.error}>{error}</T> : null}
    </View>
  );
}

export function Badge({ status }: { status: OrderStatus }) {
  const tone = toneColors[ORDER_STATUS_TONE[status]];
  return (
    <View style={[s.badge, { backgroundColor: tone.bg }]}>
      <T weight="medium" style={{ color: tone.fg, fontSize: 12 }}>
        {ORDER_STATUS_LABELS[status]}
      </T>
    </View>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <T weight="bold" style={{ fontSize: 22 }}>
        {children}
      </T>
      {sub ? <T style={{ color: colors.muted, marginTop: 2 }}>{sub}</T> : null}
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <T
        style={{ color: strong ? colors.ink : colors.muted }}
        weight={strong ? 'semibold' : 'regular'}
      >
        {label}
      </T>
      <T weight={strong ? 'bold' : 'medium'}>{value}</T>
    </View>
  );
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <T weight="semibold" style={{ fontSize: 16 }}>
        {title}
      </T>
      {text ? (
        <T style={{ color: colors.muted, textAlign: 'center', marginTop: 6 }}>{text}</T>
      ) : null}
    </Card>
  );
}

export function Notice({
  tone = 'blue',
  children,
}: {
  tone?: keyof typeof toneColors;
  children: ReactNode;
}) {
  const c = toneColors[tone];
  return (
    <View style={[s.notice, { backgroundColor: c.bg }]}>
      <T style={{ color: c.fg }}>{children}</T>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator color={colors.blue} />
    </View>
  );
}

/** Frise des étapes (✓ pour les étapes franchies). */
export function Steps({ steps }: { steps: { label: string; done: boolean; current?: boolean }[] }) {
  return (
    <View style={{ marginVertical: 8 }}>
      {steps.map((st, i) => (
        <View key={st.label} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ alignItems: 'center', width: 28 }}>
            <View
              style={[
                s.dot,
                st.done && { backgroundColor: colors.green, borderColor: colors.green },
                st.current && { borderColor: colors.orange },
              ]}
            >
              {st.done ? <T style={{ color: colors.white, fontSize: 11 }}>✓</T> : null}
            </View>
            {i < steps.length - 1 ? <View style={s.stem} /> : null}
          </View>
          <T
            weight={st.current ? 'semibold' : 'regular'}
            style={{ color: st.done || st.current ? colors.ink : colors.muted, paddingBottom: 14 }}
          >
            {st.label}
          </T>
        </View>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { padding: 16 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1.5,
    marginTop: 8,
  },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6 },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 50,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
  },
  error: { color: colors.red, fontSize: 12, marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  notice: { borderRadius: radius.md, padding: 12, marginBottom: 12 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stem: { width: 2, flex: 1, minHeight: 14, backgroundColor: colors.line },
});
