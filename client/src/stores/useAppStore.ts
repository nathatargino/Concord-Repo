import { create } from 'zustand';
import type { ChatMessage, MusicItem, RoomInfo, ServerChannel, ServerMember, UserInfo, WatchSession } from '../types';
import { 
  getRecentRooms, 
  getSavedUserTag, 
  getRecentServers, 
  getRecentCallServers,
  recordRecentCallServer as recordRecentCallServerSupabase,
  getMyServers, 
  getSavedServersSync,
  recordRecentServerAccess, 
  type Friend, 
  type DirectChat, 
  type SavedRoom, 
  type SavedServer 
} from '../lib/supabase';

export interface UserProfileData {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role?: 'owner' | 'sub_owner' | 'member';
  customRole?: { name: string; emoji: string; color?: string } | null;
  isMe?: boolean;
  createdAt?: string;
  tag?: string;
}

export interface ActiveCallState {
  roomId: string;
  roomName: string;
  code: string;
  isServer: boolean;
  channelName?: string;
}

interface AppState {
  // Navigation & Rail Context
  activeRailContext: string; // 'home' or serverId / roomId
  setActiveRailContext: (ctx: string) => void;
  recentRooms: SavedRoom[];
  setRecentRooms: (rooms: SavedRoom[]) => void;
  refreshRecentRooms: () => void;

  // Servidores do Usuário (Sincronizados & Reativos)
  servers: SavedServer[];
  setServers: (servers: SavedServer[] | ((prev: SavedServer[]) => SavedServer[])) => void;
  refreshServers: () => Promise<SavedServer[]>;

  // Servidores Recentes (Últimos 3 acessados)
  recentServers: SavedServer[];
  setRecentServers: (servers: SavedServer[]) => void;
  recordRecentServer: (server: SavedServer) => void;

  // Servidores Recentes de Chamada (Últimos 2 que esteve em call)
  recentCallServers: SavedServer[];
  setRecentCallServers: (servers: SavedServer[]) => void;
  recordRecentCallServer: (server: SavedServer) => void;
  refreshRecentCallServers: () => void;

  // Chamada de Voz/Vídeo Ativa e Persistente
  activeCall: ActiveCallState | null;
  setActiveCall: (call: ActiveCallState | null) => void;

  // Unified Action Modal (Create Server, Join Server, Create 14h Room)
  isActionModalOpen: boolean;
  actionModalTab: 'create-server' | 'join-server' | 'create-room';
  openActionModal: (tab?: 'create-server' | 'join-server' | 'create-room') => void;
  closeActionModal: () => void;

  // Quick 14h Room Prompt Modal
  createRoomPromptOpen: boolean;
  setCreateRoomPromptOpen: (v: boolean) => void;

  // Social System (Friends & DMs)
  myTag: string;
  setMyTag: (t: string) => void;
  friends: Friend[];
  setFriends: (f: Friend[]) => void;
  directChats: DirectChat[];
  setDirectChats: (d: DirectChat[]) => void;
  activeDmChat: DirectChat | null;
  setActiveDmChat: (c: DirectChat | null) => void;
  homeTab: 'hub' | 'friends' | 'dm';
  setHomeTab: (t: 'hub' | 'friends' | 'dm') => void;
  friendsFilter: 'online' | 'all' | 'pending' | 'blocked' | 'add';
  setFriendsFilter: (f: 'online' | 'all' | 'pending' | 'blocked' | 'add') => void;

  // Connection
  connected: boolean;
  setConnected: (v: boolean) => void;

  // Room / Server
  room: RoomInfo | null;
  setRoom: (room: RoomInfo | null) => void;
  isServer: boolean;
  setIsServer: (v: boolean) => void;
  serverName: string;
  setServerName: (name: string) => void;
  serverIconUrl: string | null;
  setServerIconUrl: (url: string | null) => void;

  // Channels (for Servers)
  channels: ServerChannel[];
  setChannels: (channels: ServerChannel[]) => void;
  addChannel: (channel: ServerChannel) => void;
  updateChannel: (channelId: string, newName: string) => void;
  removeChannel: (channelId: string) => void;
  activeChannelId: string;
  setActiveChannelId: (id: string) => void;

  // Server Members (for Servers: Offline, Online, In Call)
  serverMembers: ServerMember[];
  setServerMembers: (members: ServerMember[] | ((prev: ServerMember[]) => ServerMember[])) => void;
  myRole: 'owner' | 'sub_owner' | 'member';
  setMyRole: (role: 'owner' | 'sub_owner' | 'member') => void;

  // User
  myId: string;
  myName: string;
  myAvatarUrl: string | null;
  setMyId: (id: string) => void;
  setMyName: (name: string) => void;
  setMyAvatarUrl: (url: string | null) => void;

  // User Profile Modal Viewer
  viewingProfileUser: UserProfileData | null;
  openUserProfile: (user: UserProfileData) => void;
  closeUserProfile: () => void;

  // Custom Confirmation Dialog Modal
  confirmModal: {
    isOpen: boolean;
    title: string;
    message: string;
    subMessage?: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null;
  showConfirmModal: (options: {
    title: string;
    message: string;
    subMessage?: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  }) => void;
  closeConfirmModal: () => void;

  // Users currently in the room
  users: UserInfo[];
  setUsers: (users: UserInfo[]) => void;

  // Chat
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  addSystemMessage: (message: string, channelId?: string) => void;
  clearMessages: () => void;
  toggleMessageReaction: (messageId: string, emoji: string, userName: string) => void;
  systemNotificationsEnabled: boolean;
  setSystemNotificationsEnabled: (enabled: boolean) => void;

  // Voice
  inVoice: boolean;
  setInVoice: (v: boolean) => void;
  activeCallInfo: {
    roomId: string;
    roomName: string;
    code: string;
    isServer: boolean;
  } | null;
  setActiveCallInfo: (info: { roomId: string; roomName: string; code: string; isServer: boolean; } | null) => void;

  // Music
  musicQueue: MusicItem[];
  setMusicQueue: (q: MusicItem[]) => void;
  currentVideoId: string | null;
  setCurrentVideoId: (id: string | null) => void;
  currentTrackTitle: string | null;
  setCurrentTrackTitle: (title: string | null) => void;
  musicStartTime: number | null;
  setMusicStartTime: (time: number | null) => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  visualizerActive: boolean;
  setVisualizerActive: (v: boolean) => void;
  isBuffering: boolean;
  setIsBuffering: (v: boolean) => void;
  pipWindow: Window | null;
  setPipWindow: (w: Window | null) => void;
  isPiPActive: boolean;
  setPiPActive: (v: boolean) => void;
  ytAvailableQualities: string[];
  setYtAvailableQualities: (qualities: string[]) => void;

  // Streaming & Multi-Platform Media
  activeMediaTab: 'youtube' | 'netflix' | 'prime' | 'crunchyroll';
  setActiveMediaTab: (tab: 'youtube' | 'netflix' | 'prime' | 'crunchyroll') => void;
  streamingSessions: { netflix: boolean; prime: boolean; crunchyroll: boolean };
  setStreamingSession: (service: 'netflix' | 'prime' | 'crunchyroll', active: boolean) => void;
  activeStreaming: { service: 'netflix' | 'prime' | 'crunchyroll'; url?: string } | null;
  setActiveStreaming: (s: { service: 'netflix' | 'prime' | 'crunchyroll'; url?: string } | null) => void;
  showVideoPlayer: boolean;
  setShowVideoPlayer: (v: boolean | ((prev: boolean) => boolean)) => void;
  isYouTubeSearchOpen: boolean;
  setIsYouTubeSearchOpen: (open: boolean) => void;
  watchSession: WatchSession | null;
  setWatchSession: (watchSession: WatchSession | null) => void;

  // Screen share
  screenShareUserId: string | null;
  screenShareUserName: string | null;
  setScreenShare: (userId: string | null, userName?: string | null) => void;
  amSharing: boolean;
  isScreenSharing: boolean;
  setAmSharing: (v: boolean) => void;
  screenViewers: Array<{ id: string; name: string }>;
  setScreenViewers: (viewers: Array<{ id: string; name: string }>) => void;

  // Modern Update Screen
  isApplyingUpdate: boolean;
  setIsApplyingUpdate: (v: boolean) => void;

  // Full Room Cleanup
  resetRoomState: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Navigation & Rail Context
  activeRailContext: 'home',
  setActiveRailContext: (activeRailContext) => set({ activeRailContext }),
  recentRooms: getRecentRooms(),
  setRecentRooms: (recentRooms) => set({ recentRooms }),
  refreshRecentRooms: () => set({ recentRooms: getRecentRooms() }),

  // Servidores do Usuário
  servers: getSavedServersSync(),
  setServers: (servers) => set((s) => ({ servers: typeof servers === 'function' ? servers(s.servers) : servers })),
  refreshServers: async () => {
    try {
      const list = await getMyServers();
      if (list && list.length > 0) {
        set({ servers: list });
      } else {
        const fallback = getSavedServersSync();
        if (fallback.length > 0) {
          set({ servers: fallback });
        }
      }
      return list;
    } catch {
      const fallback = getSavedServersSync();
      set({ servers: fallback });
      return fallback;
    }
  },

  // Servidores Recentes (Últimos 3 acessados)
  recentServers: getRecentServers(),
  setRecentServers: (recentServers) => set({ recentServers }),
  recordRecentServer: (server) => {
    const updated = recordRecentServerAccess(server);
    set({ recentServers: updated });
  },

  // Servidores Recentes de Chamada (Últimos 2 que esteve em call)
  recentCallServers: getRecentCallServers(),
  setRecentCallServers: (recentCallServers) => set({ recentCallServers }),
  recordRecentCallServer: (server) => {
    const updated = recordRecentCallServerSupabase(server);
    set({ recentCallServers: updated });
  },
  refreshRecentCallServers: () => {
    set({ recentCallServers: getRecentCallServers() });
  },

  // Chamada de Voz/Vídeo Ativa
  activeCall: null,
  setActiveCall: (activeCall) => set({ activeCall }),

  // Unified Action Modal
  isActionModalOpen: false,
  actionModalTab: 'create-server',
  openActionModal: (tab = 'create-server') => set({ isActionModalOpen: true, actionModalTab: tab }),
  closeActionModal: () => set({ isActionModalOpen: false }),

  // Quick 14h Room Prompt Modal
  createRoomPromptOpen: false,
  setCreateRoomPromptOpen: (createRoomPromptOpen) => set({ createRoomPromptOpen }),

  // Social System (Friends & DMs)
  myTag: getSavedUserTag(),
  setMyTag: (myTag) => set({ myTag }),
  friends: [],
  setFriends: (friends) => set({ friends }),
  directChats: [],
  setDirectChats: (directChats) => set({ directChats }),
  activeDmChat: null,
  setActiveDmChat: (activeDmChat) => set({ activeDmChat }),
  homeTab: 'hub',
  setHomeTab: (homeTab) => set({ homeTab }),
  friendsFilter: 'online',
  setFriendsFilter: (friendsFilter) => set({ friendsFilter }),

  // Connection
  connected: false,
  setConnected: (v) => set({ connected: v }),

  // Room / Server
  room: null,
  setRoom: (room) =>
    set((state) => {
      const roomChanged = !state.room || !room || state.room.id !== room.id;
      return {
        room,
        isServer: Boolean(room?.isServer),
        serverName: room?.name || '',
        serverIconUrl: room?.iconUrl || null,
        channels: room?.channels && room.channels.length > 0 ? room.channels : [{ id: 'ch-geral', name: 'Geral' }],
        activeChannelId: room?.channels && room.channels.length > 0 ? room.channels[0].id : 'ch-geral',
        messages: roomChanged ? [] : state.messages,
        users: roomChanged ? [] : state.users,
        serverMembers: roomChanged ? [] : state.serverMembers,
        watchSession: roomChanged ? null : state.watchSession,
      };
    }),
  isServer: false,
  setIsServer: (isServer) => set({ isServer }),
  serverName: '',
  setServerName: (serverName) => set({ serverName }),
  serverIconUrl: null,
  setServerIconUrl: (serverIconUrl) => set({ serverIconUrl }),

  // Channels
  channels: [{ id: 'ch-geral', name: 'Geral' }],
  setChannels: (channels) => set({ channels }),
  addChannel: (channel) =>
    set((s) => {
      if (s.channels.some((c) => c.id === channel.id || c.name === channel.name)) return s;
      return { channels: [...s.channels, channel] };
    }),
  updateChannel: (channelId, newName) =>
    set((s) => ({
      channels: s.channels.map((c) => (c.id === channelId ? { ...c, name: newName } : c)),
    })),
  removeChannel: (channelId) =>
    set((s) => {
      const nextChannels = s.channels.filter((c) => c.id !== channelId);
      const nextActiveId = s.activeChannelId === channelId ? (nextChannels[0]?.id || 'ch-geral') : s.activeChannelId;
      return { channels: nextChannels, activeChannelId: nextActiveId };
    }),
  activeChannelId: 'ch-geral',
  setActiveChannelId: (activeChannelId) => set({ activeChannelId }),

  // Server Members
  serverMembers: [],
  setServerMembers: (members) =>
    set((state) => ({
      serverMembers: typeof members === 'function' ? members(state.serverMembers) : members,
    })),
  myRole: 'member',
  setMyRole: (myRole) => set({ myRole }),

  // User
  myId: '',
  myName: localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '',
  myAvatarUrl: localStorage.getItem('concord_avatar_url') || null,
  setMyId: (id) => set({ myId: id }),
  setMyName: (name) => set({ myName: name }),
  setMyAvatarUrl: (url) => set({ myAvatarUrl: url }),

  // User Profile Modal Viewer
  viewingProfileUser: null,
  openUserProfile: (user) => set({ viewingProfileUser: user }),
  closeUserProfile: () => set({ viewingProfileUser: null }),

  // Custom Confirmation Dialog Modal
  confirmModal: null,
  showConfirmModal: (options) => set({ confirmModal: { ...options, isOpen: true } }),
  closeConfirmModal: () => set({ confirmModal: null }),

  // Users
  users: [],
  setUsers: (users) => set({ users }),

  // Chat
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (msg) =>
    set((s) => {
      // 1. Reconciliação otimista: se a mensagem vinda do socket coincidir com uma mensagem otimista pendente
      const optIndex = s.messages.findIndex(
        (m) =>
          m.id &&
          m.id.startsWith('opt-') &&
          m.userName === msg.userName &&
          m.message === msg.message &&
          m.channelId === msg.channelId &&
          (m.url || '') === (msg.url || '')
      );
      if (optIndex !== -1) {
        const updated = [...s.messages];
        updated[optIndex] = { ...msg, id: msg.id || updated[optIndex].id };
        return { messages: updated };
      }

      const last = s.messages[s.messages.length - 1];
      // Só bloqueia duplicatas verdadeiras que chegam dentro da janela de retransmissão
      if (last) {
        const lastTs = last.id ? parseInt(last.id.split('-')[1] || '0', 10) : 0;
        const msgTs = msg.id ? parseInt(msg.id.split('-')[1] || '0', 10) : 0;
        const withinWindow = lastTs > 0 && msgTs > 0 && Math.abs(msgTs - lastTs) < 2500;
        if (
          withinWindow &&
          last.userName === msg.userName &&
          last.message === msg.message &&
          last.channelId === msg.channelId &&
          last.type === msg.type &&
          last.url === msg.url
        ) {
          return s;
        }
      }
      return { messages: [...s.messages.slice(-500), msg] };
    }),
  systemNotificationsEnabled: typeof window !== 'undefined' ? localStorage.getItem('concord_system_notifications') !== 'false' : true,
  setSystemNotificationsEnabled: (enabled) => {
    try {
      localStorage.setItem('concord_system_notifications', String(enabled));
    } catch {}
    set({ systemNotificationsEnabled: enabled });
  },
  addSystemMessage: (message, channelId) =>
    set((s) => {
      if (!s.systemNotificationsEnabled) {
        return s;
      }
      const currentChannel = channelId || s.activeChannelId || 'ch-geral';
      const last = s.messages[s.messages.length - 1];
      if (last && last.isSystem && last.message === message && last.channelId === currentChannel) {
        return s;
      }
      const timestamp = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
      const newMsg: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userName: 'Sistema',
        message,
        timestamp,
        isSystem: true,
        type: 'text',
        channelId: currentChannel,
        avatarUrl: null,
      };
      return { messages: [...s.messages.slice(-500), newMsg] };
    }),
  clearMessages: () => set({ messages: [] }),
  toggleMessageReaction: (messageId, emoji, userName) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = { ...(m.reactions || {}) };
        const currentUsers = reactions[emoji] || [];
        const alreadyReacted = currentUsers.includes(userName);
        if (alreadyReacted) {
          const nextUsers = currentUsers.filter((u) => u !== userName);
          if (nextUsers.length === 0) {
            delete reactions[emoji];
          } else {
            reactions[emoji] = nextUsers;
          }
        } else {
          reactions[emoji] = [...currentUsers, userName];
        }
        return { ...m, reactions };
      }),
    })),

  // Voice
  inVoice: false,
  setInVoice: (inVoice) => set({ inVoice }),
  activeCallInfo: null,
  setActiveCallInfo: (activeCallInfo) => set({ activeCallInfo }),

  // Music
  musicQueue: [],
  setMusicQueue: (musicQueue) => set({ musicQueue }),
  currentVideoId: null,
  setCurrentVideoId: (currentVideoId) => set({ currentVideoId }),
  currentTrackTitle: null,
  setCurrentTrackTitle: (title) => set({ currentTrackTitle: title }),
  musicStartTime: null,
  setMusicStartTime: (time) => set({ musicStartTime: time }),
  isPlaying: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  visualizerActive: false,
  setVisualizerActive: (v) => set({ visualizerActive: v }),
  isBuffering: false,
  setIsBuffering: (v) => set({ isBuffering: v }),
  pipWindow: null,
  setPipWindow: (pipWindow) => set({ pipWindow }),
  isPiPActive: false,
  setPiPActive: (isPiPActive) => set({ isPiPActive }),
  ytAvailableQualities: ['auto'],
  setYtAvailableQualities: (ytAvailableQualities) => set({ ytAvailableQualities }),

  // Streaming & Multi-Platform Media
  activeMediaTab: 'youtube',
  setActiveMediaTab: (activeMediaTab) => set({ activeMediaTab }),
  streamingSessions: { netflix: false, prime: false, crunchyroll: false },
  setStreamingSession: (service, active) =>
    set((state) => ({
      streamingSessions: { ...state.streamingSessions, [service]: active },
    })),
  activeStreaming: null,
  setActiveStreaming: (activeStreaming) => {
    if (activeStreaming) {
      set((state) => ({
        activeStreaming,
        activeMediaTab: activeStreaming.service,
        streamingSessions: { ...state.streamingSessions, [activeStreaming.service]: true },
      }));
    } else {
      set({ activeStreaming });
    }
  },
  showVideoPlayer: false,
  setShowVideoPlayer: (v) =>
    set((state) => ({
      showVideoPlayer: typeof v === 'function' ? v(state.showVideoPlayer) : v,
    })),
  isYouTubeSearchOpen: false,
  setIsYouTubeSearchOpen: (isYouTubeSearchOpen) => set({ isYouTubeSearchOpen }),
  watchSession: null,
  setWatchSession: (watchSession) => set({ watchSession }),

  // Screen share
  screenShareUserId: null,
  screenShareUserName: null,
  setScreenShare: (screenShareUserId, screenShareUserName = null) =>
    set({ screenShareUserId, screenShareUserName }),
  amSharing: false,
  isScreenSharing: false,
  setAmSharing: (amSharing) => set({ amSharing, isScreenSharing: amSharing }),
  screenViewers: [],
  setScreenViewers: (screenViewers) => set({ screenViewers }),

  // Full Room Cleanup
  resetRoomState: () =>
    set({
      room: null,
      isServer: false,
      serverName: '',
      serverIconUrl: null,
      channels: [{ id: 'ch-geral', name: 'Geral' }],
      activeChannelId: 'ch-geral',
      serverMembers: [],
      myRole: 'member',
      users: [],
      messages: [],
      inVoice: false,
      musicQueue: [],
      currentVideoId: null,
      currentTrackTitle: null,
      isPlaying: false,
      visualizerActive: false,
      activeMediaTab: 'youtube',
      streamingSessions: { netflix: false, prime: false, crunchyroll: false },
      activeStreaming: null,
      showVideoPlayer: false,
      watchSession: null,
      screenShareUserId: null,
      screenShareUserName: null,
      amSharing: false,
      isScreenSharing: false,
      screenViewers: [],
    }),

  isApplyingUpdate: false,
  setIsApplyingUpdate: (isApplyingUpdate) => set({ isApplyingUpdate }),
}));
