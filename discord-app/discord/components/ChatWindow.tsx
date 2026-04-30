/**
 * ChatWindow — Message list using React Native FlatList (natively virtualised).
 *
 * Auto-scrolls to bottom on new messages. Shows "sending..." for pending
 * optimistic messages. Each MessageRow is memoized.
 */
import { memo, useEffect, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, type ListRenderItem } from 'react-native';
import { useDisStore } from '@dis/store';
import type { Message } from '@dis/types';

// ─── Single message row ───────────────────────────────────────────────────────

const MessageRow = memo(function MessageRow({ item }: { item: Message }) {
  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return isToday
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <View style={[styles.row, item.pending && styles.pendingRow]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.username[0]?.toUpperCase()}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={styles.username}>{item.username}</Text>
          <Text style={styles.time}>{formatTime(item.created_at)}</Text>
          {item.pending && <Text style={styles.sending}>sending…</Text>}
        </View>
        <Text style={styles.content}>{item.content}</Text>
      </View>
    </View>
  );
});

// ─── Chat window ─────────────────────────────────────────────────────────────

interface Props {
  channelId: string;
}

const ChatWindow = memo(function ChatWindow({ channelId }: Props) {
  const messages = useDisStore((s) => s.messages[channelId] ?? []);
  const listRef = useRef<FlatList<Message>>(null);
  const prevLengthRef = useRef(messages.length);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    if (messages.length > prevLengthRef.current && messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  const renderItem: ListRenderItem<Message> = ({ item }) => (
    <MessageRow item={item} />
  );

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(m) => m.id}
      renderItem={renderItem}
      style={styles.list}
      contentContainerStyle={styles.content}
      onContentSizeChange={() =>
        listRef.current?.scrollToEnd({ animated: false })
      }
      removeClippedSubviews
      maxToRenderPerBatch={20}
      windowSize={10}
      initialNumToRender={15}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
        </View>
      }
    />
  );
});

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingVertical: 8 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#6d6f78', fontSize: 13 },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 10,
  },
  pendingRow: { opacity: 0.5 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#5865f2',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  body: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  username: { color: '#fff', fontWeight: '700', fontSize: 14 },
  time: { color: '#949ba4', fontSize: 11 },
  sending: { color: '#949ba4', fontSize: 11, fontStyle: 'italic' },
  content: { color: '#dbdee1', fontSize: 14, lineHeight: 20 },
});

export default ChatWindow;
