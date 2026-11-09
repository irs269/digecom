import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@digecom/shared';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Notice, T } from '@/components/ui';
import { ApiError, login } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors, radius } from '@/theme';

export default function Connexion() {
  const { user } = useSession();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: '', password: '' },
  });

  if (user) return <Redirect href="/" />;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.phone, values.password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isNetwork
            ? 'Pas de connexion. Vérifie ton réseau et réessaie.'
            : err.message
          : 'Connexion impossible',
      );
    }
  });

  return (
    <SafeAreaView style={st.bg}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: 20 }}
      >
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <Image source={require('../../assets/logo.jpg')} style={st.logo} />
          <T weight="bold" style={{ color: colors.white, fontSize: 26, marginTop: 12 }}>
            Dig&apos;eCom
          </T>
          <T style={{ color: colors.blueSoft }}>E-commerçants et livreurs</T>
        </View>
        <View style={st.card}>
          {error ? <Notice tone="red">{error}</Notice> : null}
          <Controller
            control={form.control}
            name="phone"
            render={({ field, fieldState }) => (
              <Field
                testID="phone"
                label="Téléphone"
                placeholder="+269 …"
                keyboardType="phone-pad"
                autoComplete="tel"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <Field
                testID="password"
                label="Mot de passe"
                secureTextEntry
                autoComplete="current-password"
                value={field.value}
                onChangeText={field.onChange}
                onSubmitEditing={() => void submit()}
                error={fieldState.error?.message}
              />
            )}
          />
          <Button
            testID="login"
            label="Se connecter"
            loading={form.formState.isSubmitting}
            onPress={() => void submit()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.blue },
  logo: { width: 84, height: 84, borderRadius: 20 },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: 20 },
});
