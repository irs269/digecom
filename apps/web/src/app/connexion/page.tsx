'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Le formulaire valide la saisie ; la normalisation +269 est faite par l'API (schéma partagé).
const formSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, 'Numéro de téléphone requis')
    .regex(/^(\+269|00269)?[\s.-]*(\d[\s.-]*){7}$/, 'Format attendu : +269 XXX XX XX'),
  password: z.string().min(1, 'Mot de passe requis'),
});
type FormValues = z.infer<typeof formSchema>;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, login } = useAuth();
  const [error, setError] = useState<string | null>(
    params.get('expire') ? 'Ta session a expiré. Reconnecte-toi.' : null,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (state.status === 'authenticated') router.replace('/tableau-de-bord');
  }, [state.status, router]);

  const onSubmit = handleSubmit(async ({ phone, password }) => {
    setError(null);
    try {
      await login(phone, password);
      router.replace('/tableau-de-bord');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Connexion impossible. Réessaie.');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Connexion">
      <Field
        label="Téléphone"
        type="tel"
        inputMode="tel"
        autoComplete="username"
        placeholder="+269 330 00 01"
        error={errors.phone?.message}
        {...register('phone')}
      />
      <Field
        label="Mot de passe"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-status-red-bg px-3 py-2.5 text-sm font-medium text-status-red-fg"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="accent" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Connexion…' : 'Se connecter'}
      </Button>
      <p className="text-center text-sm text-ink-muted">
        E-commerçant ou livreur sur iPhone ?{' '}
        {/* Application mobile (PWA) : page statique hors du routeur Next. */}
        <a href="/app" className="font-semibold text-brand-blue hover:underline">
          Ouvrir l’application Dig’eCom
        </a>
      </p>
    </form>
  );
}

export default function ConnexionPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-brand-blue px-4 py-12 text-white">
      <div
        aria-hidden="true"
        className="absolute -right-[120px] -top-[120px] h-[360px] w-[360px] rounded-full bg-brand-orange"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-[160px] -left-[100px] h-[420px] w-[420px] rounded-full border-[1.5px] border-white/50"
      />
      <div className="relative flex w-full max-w-[420px] flex-col gap-7">
        <div className="flex flex-wrap items-center gap-4">
          <Image
            src="/logo.jpg"
            alt="Logo Dig'eCom Agency"
            width={76}
            height={76}
            priority
            className="h-[76px] w-[76px] rounded-full border-[3px] border-white object-cover"
          />
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[32px] font-extrabold leading-tight tracking-tight">
              Dig&apos;eCom – Back-office
            </h1>
            <p className="text-[15px] text-brand-blue-soft">Connecte-toi avec ton téléphone.</p>
          </div>
        </div>
        <div className="rounded-xl bg-white p-6 text-ink shadow-xl">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-xs text-brand-blue-soft">
          Les e-commerçants et les livreurs utilisent l&apos;application mobile.
        </p>
      </div>
    </main>
  );
}
