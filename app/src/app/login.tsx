import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '@/components/toast';
import { Button, Card, Field, Input, PasswordInput, T } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { C, S } from '@/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: S.xl, gap: S.xl }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: S.sm }}>
            <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: C.brand600, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chatbubble-ellipses" size={32} color="#fff" />
            </View>
            <T v="title">WhatsApp CRM</T>
            <T v="small">Sign in to your business</T>
          </View>
          <Card style={{ gap: S.lg }}>
            <Field label="Email">
              <Input value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="email" placeholder="you@business.com" returnKeyType="next" />
            </Field>
            <Field label="Password">
              <PasswordInput value={password} onChangeText={setPassword} textContentType="password" autoComplete="password" placeholder="••••••••" onSubmitEditing={submit} returnKeyType="go" />
            </Field>
            <Button title="Sign in" onPress={submit} loading={busy} disabled={!email.trim() || !password} />
          </Card>
          <T v="tiny" style={{ textAlign: 'center' }}>One login opens all your businesses. Server: {API_URL.replace(/^https?:\/\//, '')}</T>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
