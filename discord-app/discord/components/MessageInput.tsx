/**
 * MessageInput — Chat text input with 2000-char limit and send button.
 *
 * Uses KeyboardAvoidingView on iOS to stay above the keyboard.
 * Shows a character counter when near the limit.
 */
import { memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useDisStore } from '@dis/store';

interface Props {
  onSend: (content: string) => void;
}

const MAX_LENGTH = 2000;

const MessageInput = memo(function MessageInput({ onSend }: Props) {
  const [value, setValue] = useState('');
  const channels = useDisStore((s) => s.channels);
  const activeChannelId = useDisStore((s) => s.activeChannelId);
  const activeChannel = channels.find((c) => c.id === activeChannelId);

  const canSend = value.trim().length > 0 && value.trim().length <= MAX_LENGTH;

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend(value.trim());
    setValue('');
  }, [canSend, onSend, value]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder={
            activeChannel ? `Message #${activeChannel.name}` : 'Select a channel'
          }
          placeholderTextColor="#6d6f78"
          multiline
          maxLength={MAX_LENGTH + 10}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={submit}
        />

        {/* Over-limit warning */}
        {value.length > MAX_LENGTH - 100 && (
          <Text
            style={[
              styles.counter,
              value.length > MAX_LENGTH && styles.counterOver,
            ]}
          >
            {MAX_LENGTH - value.length}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          onPress={submit}
          disabled={!canSend}
          activeOpacity={0.7}
        >
          <Text style={styles.sendIcon}>▶</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#383a40',
    margin: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#dbdee1',
    fontSize: 15,
    maxHeight: 120,
    paddingVertical: 0,
  },
  counter: { color: '#fee75c', fontSize: 11, alignSelf: 'flex-end', marginBottom: 2 },
  counterOver: { color: '#f38ba8' },
  sendBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendIcon: { color: '#b5bac1', fontSize: 16 },
});

export default MessageInput;
