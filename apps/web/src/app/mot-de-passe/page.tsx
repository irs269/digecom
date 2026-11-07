'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { passwordPolicySchema, type MeResponse } from '@digecom/shared';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const formSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
    newPassword: passwordPolicySchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'Les deux mots de passe ne correspondent pas',
    path: ['confirm'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Le nouveau mot de passe doit être différent de l’actuel',
    path: ['newPassword'],
  });
type FormValues = z.infer<typeof formSchema>;

export default function ChangePasswordPage() {
  const router = useRouter();
  const toast = useToast();
  const { state, setUser, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/connexion');
  }, [state.status, router]);

  if (state.status !== 'authenticated') return null;
  const forced = state.user.mustChangePassword;

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null);
    try {
      const me = await apiFetch<MeResponse>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setUser(me);
      toast('Mot de passe modifié. Tes autres sessions ont été fermées.', 'success');
      router.replace('/tableau-de-bord');
    } catch (err) {
      if (err instanceof ApiRequestError && Array.isArray(err.details)) {
        for (const d of err.details as { path: string; message: string }[]) {
          if (d.path === 'currentPassword' || d.path === 'newPassword') {
            setFieldError(d.path, { message: d.message });
          }
        }
      }
      setError(err instanceof ApiRequestError ? err.message : 'Modification impossible. Réessaie.');
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="flex w-full max-w-[440px] flex-col gap-6">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.jpg"
            alt="Logo Dig'eCom Agency"
            width={56}
            height={56}
            className="h-14 w-14 rounded-full border-2 border-white object-cover"
          />
          <div className="flex flex-col">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">
              {forced ? 'Choisis ton mot de passe' : 'Changer mon mot de passe'}
            </h1>
            <p className="text-sm text-ink-muted">
              {forced
                ? 'Ton compte a un mot de passe temporaire. Remplace-le pour continuer.'
                : 'Tes autres sessions seront fermées.'}
            </p>
          </div>
        </div>
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 rounded-xl border border-surface-border bg-white p-6"
          aria-label="Changement de mot de passe"
        >
          <Field
            label={forced ? 'Mot de passe temporaire' : 'Mot de passe actuel'}
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <Field
            label="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            hint="10 caractères minimum, avec au moins une lettre et un chiffre"
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <Field
            label="Confirme le nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-status-red-bg px-3 py-2.5 text-sm font-medium text-status-red-fg"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          {forced ? (
            <Button variant="ghost" onClick={() => void logout()}>
              Se déconnecter
            </Button>
          ) : (
            <Link href="/tableau-de-bord" className="text-center text-sm font-semibold">
              Annuler
            </Link>
          )}
        </form>
      </div>
    </main>
  );
}
