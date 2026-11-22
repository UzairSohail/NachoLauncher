import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button, colors, ErrorBanner, Screen, styles } from "../components/ui";
import { KEYS, loadKeys, saveKey, type KeyInfo, type StoredKeys } from "../lib/keys";

const describeError = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** Enough of a key to tell which one is saved, without showing it. */
const maskKey = (key: string) => `•••• ${key.slice(-4)}`;

function KeyCard({
  info,
  stored,
  onSaved,
}: {
  info: KeyInfo;
  stored: StoredKeys;
  onSaved: (message: string) => Promise<void>;
}) {
  const current = stored.keys[info.id] ?? null;
  const needsUsername = info.id === "retroAchievementsWebApiKey";
  const [value, setValue] = useState("");
  const [username, setUsername] = useState(stored.retroAchievementsUsername ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUsername(stored.retroAchievementsUsername ?? "");
  }, [stored.retroAchievementsUsername]);

  const save = async () => {
    const key = value.trim();
    const user = username.trim();
    if (!key) {
      setError("Paste the key first.");
      return;
    }
    if (needsUsername && !user) {
      setError("Enter your RetroAchievements username too.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await info.check(key, user);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await saveKey(info.id, key, needsUsername ? user : undefined);
      setValue("");
      await onSaved(
        result.account
          ? `${info.name} key saved for ${result.account}.`
          : `${info.name} key saved.`
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert(
      `Remove the ${info.name} key?`,
      "It's removed from every computer the next time each one syncs its settings.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await saveKey(info.id, null);
              await onSaved(`${info.name} key removed.`);
            } catch (cause) {
              setError(describeError(cause));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={styles.title}>{info.name}</Text>
        {info.recommended && (
          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "600" }}>
            RECOMMENDED
          </Text>
        )}
      </View>
      <Text style={[styles.small, current && { color: colors.success }]}>
        {current
          ? needsUsername && stored.retroAchievementsUsername
            ? `Saved for ${stored.retroAchievementsUsername} (${maskKey(current)})`
            : `Saved (${maskKey(current)})`
          : "Not set"}
      </Text>
      <Text style={styles.small}>{info.description}</Text>
      {needsUsername && (
        <TextInput
          style={[styles.input, { marginTop: 6 }]}
          placeholder="RetroAchievements username"
          placeholderTextColor={colors.muted}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="RetroAchievements username"
        />
      )}
      <TextInput
        style={[styles.input, { marginTop: 6 }]}
        placeholder={current ? "Paste a new key to replace it" : "Paste your key"}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        accessibilityLabel={`${info.name} key`}
      />
      <ErrorBanner message={error} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <Button title="Check and save" onPress={save} loading={busy} style={{ flex: 1 }} />
        <Button
          title="Get a key"
          kind="secondary"
          onPress={() => void Linking.openURL(info.keyUrl)}
        />
      </View>
      {current && (
        <Button
          title="Remove"
          kind="danger"
          onPress={remove}
          disabled={busy}
          style={{ minHeight: 40 }}
        />
      )}
    </View>
  );
}

export default function KeysScreen() {
  const [stored, setStored] = useState<StoredKeys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStored(await loadKeys());
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = async (message: string) => {
    setNotice(message);
    await load();
  };

  let lastGroup: string | null = null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.small}>
          Keys are checked with their service, then saved encrypted in your Google
          Drive. Each computer picks them up the next time Nacho Launcher syncs its
          settings, within a minute or so while it's open.
        </Text>
        {notice && <Text style={[styles.body, { color: colors.success }]}>{notice}</Text>}
        <ErrorBanner message={error} />
        {!stored && !error && <ActivityIndicator color={colors.accent} />}
        {stored &&
          KEYS.map((info) => {
            const heading = info.group !== lastGroup ? info.group : null;
            lastGroup = info.group;
            return (
              <View key={info.id} style={{ gap: 8 }}>
                {heading && (
                  <Text style={[styles.title, { marginTop: 8 }]}>{heading}</Text>
                )}
                <KeyCard info={info} stored={stored} onSaved={onSaved} />
              </View>
            );
          })}
      </ScrollView>
    </Screen>
  );
}
