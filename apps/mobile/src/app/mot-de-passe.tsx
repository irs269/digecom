import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, type ChangePasswordInput, type MeResponse } from '@digecom/shared';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button, Card, Field, Notice, Screen, Title } from '@/components/ui';
import { api, updateUser } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Premier mot de passe imposé par l'administrateur : à changer avant d'utiliser l'application. */
export default function MotDePasse() {
  const { user, logout } = useSession();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  if (!user) return <Redirect href="/connexion" />;
  if (!user.mustChangePassword) return <Redirect href="/" />;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      updateUser(await api<MeResponse>('/auth/change-password', { method: 'POST', body: values }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  });

  return (
    <Screen>
      <Title sub="Choisis ton propre mot de passe pour continuer.">Nouveau mot de passe</Title>
      <Card>
        {error ? <Notice tone="red">{error}</Notice> : null}
        {(['currentPassword', 'newPassword'] as const).map((name) => (
          <Controller
            key={name}
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
              <Field
                label={name === 'currentPassword' ? 'Mot de passe actuel' : 'Nouveau mot de passe'}
                secureTextEntry
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        ))}
        <Button
          label="Enregistrer"
          loading={form.formState.isSubmitting}
          onPress={() => void submit()}
        />
        <Button label="Se déconnecter" variant="ghost" onPress={() => void logout()} />
      </Card>
    </Screen>
  );
}
