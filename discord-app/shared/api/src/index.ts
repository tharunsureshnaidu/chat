import type {
  AuthResponse,
  ChannelSummary,
  Channel,
  ChannelMember,
  ChannelInvite,
  FriendRequest,
  Friend,
  JoinRequest,
  Message,
  UserResult,
} from '@dis/types';

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    // Fall back to localStorage when the in-memory token is absent (e.g. after
    // a Next.js HMR module reload that recreates the singleton before React
    // effects have a chance to call setToken() again).
    const token =
      this.token ??
      (typeof localStorage !== 'undefined'
        ? localStorage.getItem('token')
        : null);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body?.error === 'string') message = body.error;
        else if (typeof body?.message === 'string') message = body.message;
        else if (typeof body === 'string') message = body;
      } catch {
        // use default message
      }
      throw new Error(message);
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(username: string, email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  // ─── Channels ────────────────────────────────────────────────────────────────

  async fetchMyChannels(): Promise<ChannelSummary[]> {
    return this.request<ChannelSummary[]>('/api/channels');
  }

  async fetchMyDMs(): Promise<ChannelSummary[]> {
    return this.request<ChannelSummary[]>('/api/channels/dms');
  }

  async getChannel(channelId: string): Promise<Channel> {
    return this.request<Channel>(`/api/channels/${channelId}`);
  }

  async createChannel(
    name: string,
    description?: string,
    isPublic = true
  ): Promise<Channel> {
    return this.request<Channel>('/api/channels', {
      method: 'POST',
      body: JSON.stringify({ name, description, is_public: isPublic }),
    });
  }

  async updateChannel(
    channelId: string,
    patch: { name?: string; description?: string; is_public?: boolean }
  ): Promise<Channel> {
    return this.request<Channel>(`/api/channels/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  async deleteChannel(channelId: string): Promise<void> {
    return this.request<void>(`/api/channels/${channelId}`, { method: 'DELETE' });
  }

  async fetchMembers(channelId: string): Promise<ChannelMember[]> {
    return this.request<ChannelMember[]>(`/api/channels/${channelId}/members`);
  }

  async removeMember(channelId: string, userId: string): Promise<void> {
    return this.request<void>(`/api/channels/${channelId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  // ─── Discover + Search ────────────────────────────────────────────────────────

  async discoverChannels(query?: string): Promise<ChannelSummary[]> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.request<ChannelSummary[]>(`/api/discover/channels${qs}`);
  }

  async searchUsers(query: string): Promise<UserResult[]> {
    return this.request<UserResult[]>(
      `/api/discover/users?q=${encodeURIComponent(query)}`
    );
  }

  // ─── Join ─────────────────────────────────────────────────────────────────────

  async joinChannel(channelId: string): Promise<void> {
    return this.request<void>(`/api/channels/${channelId}/join`, { method: 'POST' });
  }

  async fetchAllAdminJoinRequests(): Promise<JoinRequest[]> {
    return this.request<JoinRequest[]>('/api/join-requests');
  }

  async fetchJoinRequests(channelId: string): Promise<JoinRequest[]> {
    return this.request<JoinRequest[]>(`/api/channels/${channelId}/join-requests`);
  }

  async respondToJoinRequest(requestId: string, approve: boolean): Promise<void> {
    return this.request<void>(`/api/join-requests/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ approve }),
    });
  }

  // ─── Channel Invites ─────────────────────────────────────────────────────────

  async inviteUser(channelId: string, username: string): Promise<void> {
    return this.request<void>(`/api/channels/${channelId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  }

  async fetchMyInvites(): Promise<ChannelInvite[]> {
    return this.request<ChannelInvite[]>('/api/invites');
  }

  async respondToInvite(inviteId: string, accept: boolean): Promise<void> {
    return this.request<void>(`/api/invites/${inviteId}`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    });
  }

  // ─── Friends ─────────────────────────────────────────────────────────────────

  async fetchFriends(): Promise<Friend[]> {
    return this.request<Friend[]>('/api/friends');
  }

  async sendFriendRequest(username: string): Promise<void> {
    return this.request<void>('/api/friends', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  }

  async fetchFriendRequests(): Promise<FriendRequest[]> {
    return this.request<FriendRequest[]>('/api/friend-requests');
  }

  async respondToFriendRequest(requestId: string, accept: boolean): Promise<void> {
    return this.request<void>(`/api/friend-requests/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    });
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  async fetchMessages(channelId: string, limit = 50, beforeId?: string): Promise<Message[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (beforeId) params.set('before_id', beforeId);
    return this.request<Message[]>(
      `/api/channels/${channelId}/messages?${params.toString()}`
    );
  }

  async sendMessage(channelId: string, content: string): Promise<Message> {
    return this.request<Message>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  // ─── Presence ────────────────────────────────────────────────────────────────

  async getPresence(userId: string): Promise<{ user_id: string; online: boolean }> {
    return this.request<{ user_id: string; online: boolean }>(
      `/api/presence/${userId}`
    );
  }
}
