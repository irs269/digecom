import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCalls } from '@/lib/calls/CallProvider';
import { formatDuration, ROLE_LABELS } from '@digecom/shared';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';
import { T } from './ui';

function RoundButton({
  label,
  icon,
  color,
  onPress,
  active,
  testID,
}: {
  label: string;
  icon: string;
  color: string;
  onPress: () => void;
  active?: boolean;
  testID?: string;
}) {
  return (
    <View style={{ alignItems: 'center', width: 96 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          st.round,
          { backgroundColor: active ? colors.white : color, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <T style={{ fontSize: 28, color: active ? colors.blue : colors.white }}>{icon}</T>
      </Pressable>
      <T style={{ color: colors.white, marginTop: 6, fontSize: 13 }}>{label}</T>
    </View>
  );
}

/** Écran d'appel plein écran, au-dessus de toute l'application. */
export function CallScreen() {
  const { user } = useSession();
  const { state, accept, hangup, toggleMute, toggleSpeaker } = useCalls();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (state.phase !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);

  if (state.phase === 'idle') return null;
  const call = state.call;
  const peer = call ? (call.caller.id === user?.id ? call.callee : call.caller) : null;
  const peerRole = peer ? (ROLE_LABELS[peer.role] ?? peer.role) : '';

  const status =
    state.phase === 'dialing'
      ? 'Appel en cours…'
      : state.phase === 'ringing-out'
        ? 'Ça sonne…'
        : state.phase === 'ringing-in'
          ? 'Appel Dig’eCom entrant'
          : state.phase === 'connecting'
            ? 'Connexion…'
            : state.phase === 'active'
              ? formatDuration((now - (state.connectedAt ?? now)) / 1000)
              : (state.endText ?? 'Appel terminé');

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={() => undefined}>
      <SafeAreaView style={st.bg} testID="ecran-appel">
        <View style={{ alignItems: 'center', marginTop: 48 }}>
          <View style={st.avatar}>
            <T weight="bold" style={{ fontSize: 40, color: colors.blue }}>
              {(peer?.fullName ?? '?').slice(0, 1)}
            </T>
          </View>
          <T weight="bold" style={{ color: colors.white, fontSize: 26, marginTop: 16 }}>
            {peer?.fullName ?? '…'}
          </T>
          {peer ? (
            <T style={{ color: colors.blueSoft }}>
              {call?.orderNumber ? `${peerRole} · commande #${call.orderNumber}` : peerRole}
            </T>
          ) : null}
          <T
            weight="medium"
            style={{ color: colors.white, fontSize: 18, marginTop: 20 }}
            testID="appel-statut"
          >
            {status}
          </T>
          <T style={{ color: colors.blueSoft, fontSize: 12, marginTop: 6 }}>
            Appel par Internet · numéro masqué · non enregistré
          </T>
        </View>

        <View style={st.actions}>
          {state.phase === 'ringing-in' ? (
            <>
              <RoundButton
                testID="refuser-appel"
                label="Refuser"
                icon="✕"
                color={colors.red}
                onPress={() => void hangup()}
              />
              <RoundButton
                testID="decrocher"
                label="Décrocher"
                icon="✆"
                color={colors.green}
                onPress={() => void accept()}
              />
            </>
          ) : state.phase === 'ended' ? null : (
            <>
              {state.phase === 'connecting' || state.phase === 'active' ? (
                <>
                  <RoundButton
                    label={state.muted ? 'Micro coupé' : 'Micro'}
                    icon="🎙"
                    color="rgba(255,255,255,0.18)"
                    active={state.muted}
                    onPress={toggleMute}
                  />
                  <RoundButton
                    label="Haut-parleur"
                    icon="🔊"
                    color="rgba(255,255,255,0.18)"
                    active={state.speaker}
                    onPress={toggleSpeaker}
                  />
                </>
              ) : null}
              <RoundButton
                testID="raccrocher"
                label="Raccrocher"
                icon="✕"
                color={colors.red}
                onPress={() => void hangup()}
              />
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.blueDark, justifyContent: 'space-between' },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 56,
  },
  round: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
