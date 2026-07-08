import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AuthPromptCard from '../../src/components/AuthPromptCard';
import { useAuth } from '../../src/contexts/AuthContext';
import { useSupportThreadRealtime } from '../../src/hooks/useSupportThreadRealtime';
import { getSupportThread, sendSupportMessage, type SupportMessage } from '../../src/services/customerSupport';
import { customerTheme } from '../../src/theme/palette';

export default function SupportScreen() {
  const { user } = useAuth();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  const load = useCallback(async () => {
    try {
      const res = await getSupportThread();
      setConversationId(res.conversation?.id ?? null);
      setMessages(res.messages);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load your messages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void load();
    }
  }, [user, load]);

  useSupportThreadRealtime(conversationId, load);

  const onSend = async () => {
    const body = draft.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    try {
      const res = await sendSupportMessage(body);
      setConversationId(res.conversation.id);
      setDraft('');
      await load();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to send your message.');
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.promptWrap}>
        <AuthPromptCard
          title="Sign in for support"
          message="Sign in to message our support team and see replies."
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={customerTheme.accent} size="large" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.senderType === 'customer' ? styles.bubbleCustomer : styles.bubbleAgent,
              ]}
            >
              <Text style={styles.bubbleText}>{item.body}</Text>
              <Text style={styles.bubbleTime}>{new Date(item.createdAt).toLocaleTimeString()}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Send us a message and our team will reply here and by email.</Text>
          }
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message…"
          placeholderTextColor={customerTheme.textSoft}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, !draft.trim() || sending ? styles.sendButtonDisabled : null]}
          disabled={!draft.trim() || sending}
          onPress={() => void onSend()}
        >
          <Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  promptWrap: {
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  listContent: {
    gap: 10,
    padding: 16,
    paddingBottom: 8,
  },
  bubble: {
    borderRadius: 16,
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleCustomer: {
    alignSelf: 'flex-end',
    backgroundColor: customerTheme.accentSoft,
  },
  bubbleAgent: {
    alignSelf: 'flex-start',
    backgroundColor: customerTheme.surfaceMuted,
  },
  bubbleText: {
    color: customerTheme.text,
    fontSize: 15,
    lineHeight: 20,
  },
  bubbleTime: {
    color: customerTheme.textSoft,
    fontSize: 11,
    marginTop: 4,
  },
  empty: {
    color: customerTheme.textMuted,
    marginTop: 48,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  error: {
    color: customerTheme.danger,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  composer: {
    alignItems: 'flex-end',
    borderTopColor: customerTheme.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  input: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    color: customerTheme.text,
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendButton: {
    backgroundColor: customerTheme.accent,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
