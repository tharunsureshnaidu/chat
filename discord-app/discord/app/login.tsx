import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { ApiClient } from '@dis/api';
import { useDisStore } from '@dis/store';

const api = new ApiClient(
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
);

export default function LoginScreen() {
  const router = useRouter();
  const setAuth = useDisStore((s) => s.setAuth);

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    if (tab === 'register' && !username.trim()) return;

    setError('');
    setLoading(true);

    try {
      const res =
        tab === 'login'
          ? await api.login(email.trim(), password)
          : await api.register(username.trim(), email.trim(), password);

      await SecureStore.setItemAsync('token', res.token);
      await SecureStore.setItemAsync('user', JSON.stringify(res.user));
      api.setToken(res.token);
      setAuth(res.token, res.user);
      router.replace('/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.title}>
            {tab === 'login' ? 'Welcome back!' : 'Create an account'}
          </Text>
          <Text style={styles.subtitle}>
            {tab === 'login'
              ? "We're so excited to see you again!"
              : 'Join the conversation.'}
          </Text>

          {/* Tab switcher */}
          <View style={styles.tabs}>
            {(['login', 'register'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tab, tab === t && styles.activeTab]}
                onPress={() => { setTab(t); setError(''); }}
              >
                <Text style={[styles.tabText, tab === t && styles.activeTabText]}>
                  {t === 'login' ? 'Log In' : 'Register'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'register' && (
            <>
              <Text style={styles.label}>USERNAME</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Your username"
                placeholderTextColor="#6d6f78"
                autoCapitalize="none"
              />
            </>
          )}

          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#6d6f78"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <Text style={styles.label}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#6d6f78"
            secureTextEntry
            autoComplete="password"
          />

          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {tab === 'login' ? 'Log In' : 'Register'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#313338' },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: {
    backgroundColor: '#2b2d31',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#b5bac1', textAlign: 'center', marginBottom: 20 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#1e1f22',
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
    gap: 4,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  activeTab: { backgroundColor: '#5865f2' },
  tabText: { color: '#949ba4', fontSize: 13, fontWeight: '500' },
  activeTabText: { color: '#fff' },
  label: { fontSize: 11, fontWeight: '600', color: '#b5bac1', marginBottom: 6 },
  input: {
    backgroundColor: '#1e1f22',
    color: '#fff',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 14,
  },
  errorBox: { backgroundColor: '#3d1515', borderRadius: 6, padding: 10, marginBottom: 10 },
  errorText: { color: '#f38ba8', fontSize: 13 },
  button: {
    backgroundColor: '#5865f2',
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
