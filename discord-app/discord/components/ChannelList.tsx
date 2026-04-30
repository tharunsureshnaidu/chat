/**
 * ChannelList — Sidebar showing joined channels, WS status dot, and logout.
 *
 * Displays a green/yellow/gray dot for connected/reconnecting/disconnected.
 * Handles logout by clearing SecureStore + Zustand and navigating to /login.
 */
import { memo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useDisStore } from '@dis/store';
import type { Channel } from '@dis/types';

const ChannelList = memo(function ChannelList() {
  const router = useRouter();
  const channels = useDisStore((s) => s.channels);
  const activeChannelId = useDisStore((s) => s.activeChannelId);
  const setActiveChannel = useDisStore((s) => s.setActiveChannel);
  const user = useDisStore((s) => s.user);
  const wsStatus = useDisStore((s) => s.wsStatus);
  const clearAuth = useDisStore((s) => s.clearAuth);

  const statusColor =
    wsStatus === 'connected'
      ? '#57f287'
      : wsStatus === 'reconnecting'
      ? '#fee75c'
      : '#747f8d';

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('user');
    clearAuth();
    router.replace('/login');
  };

  const renderItem = ({ item }: { item: Channel }) => (
    <TouchableOpacity
      style={[
        styles.channel,
        item.id === activeChannelId && styles.activeChannel,
      ]}
      onPress={() => setActiveChannel(item.id)}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.channelText,
          item.id === activeChannelId && styles.activeChannelText,
        ]}
        numberOfLines={1}
      >
        # {item.name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Channels</Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      {/* Channel list */}
      <FlatList
        data={channels}
        keyExtractor={(ch) => ch.id}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No channels</Text>
        }
      />

      {/* User bar */}
      {user && (
        <View style={styles.userBar}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.username[0]?.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.username} numberOfLines={1}>
            {user.username}
          </Text>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>↩</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { width: 200, backgroundColor: '#2b2d31' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1f22',
  },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 13 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  list: { flex: 1 },
  listContent: { paddingVertical: 8, paddingHorizontal: 6 },
  channel: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 4,
    marginBottom: 1,
  },
  activeChannel: { backgroundColor: '#404249' },
  channelText: { color: '#949ba4', fontSize: 14 },
  activeChannelText: { color: '#fff', fontWeight: '500' },
  emptyText: { color: '#6d6f78', fontSize: 12, paddingHorizontal: 10 },
  userBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#232428',
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#5865f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  username: { color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 },
  logoutBtn: { padding: 4 },
  logoutText: { color: '#949ba4', fontSize: 18 },
});

export default ChannelList;
