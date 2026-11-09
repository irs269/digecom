import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { Button, T } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';

/** Aiguillage après connexion : chaque profil a son espace. */
export default function Index() {
  const { user, logout } = useSession();
  if (!user) return <Redirect href="/connexion" />;
  if (user.mustChangePassword) return <Redirect href="/mot-de-passe" />;
  if (user.role === 'SELLER') return <Redirect href="/vendeur" />;
  if (user.role === 'COURIER') return <Redirect href="/livreur" />;
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
      <T weight="bold" style={{ fontSize: 20, marginBottom: 8 }}>
        {user.fullName}
      </T>
      <T style={{ color: colors.muted, marginBottom: 16 }}>
        Le profil « {user.roleLabel} » utilise le back-office web. L’application mobile est réservée
        aux e-commerçants et aux livreurs.
      </T>
      <Button label="Se déconnecter" variant="outline" onPress={() => void logout()} />
    </View>
  );
}
