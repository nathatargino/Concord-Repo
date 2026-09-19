import { create } from 'zustand';
import type { ChatMessage, MusicItem, RoomInfo, ServerChannel, ServerMember, UserInfo, WatchSession } from '../types';

export interface UserProfileData {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role?: 'owner' | 'sub_owner' | 'member';
  isMe?: boolean;
  createdAt?: string;
}

interface AppState {
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

  // Users currently in the room
  users: UserInfo[];
  setUsers: (users: UserInfo[]) => void;

  // Chat
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  addSystemMessage: (message: string, channelId?: string) => void;
  clearMessages: () => void;

  // Voice
  inVoice: boolean;
  setInVoice: (v: boolean) => void;

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
  activeMediaTab: 'youtube' | 'netflix' | 'prime';
  setActiveMediaTab: (tab: 'youtube' | 'netflix' | 'prime') => void;
  streamingSessions: { netflix: boolean; prime: boolean };
  setStreamingSession: (service: 'netflix' | 'prime', active: boolean) => void;
  activeStreaming: { service: 'netflix' | 'prime'; url?: string } | null;
  setActiveStreaming: (s: { service: 'netflix' | 'prime'; url?: string } | null) => void;
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
  setAmSharing: (v: boolean) => void;
  screenViewers: Array<{ id: string; name: string }>;
  setScreenViewers: (viewers: Array<{ id: string; name: string }>) => void;

  // Full Room Cleanup
  resetRoomState: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Connection
  connected: false,
  setConnected: (v) => set({ connected: v }),

  // Room / Server
  room: null,
  setRoom: (room) =>
    set({
      room,
      isServer: Boolean(room?.isServer),
      serverName: room?.name || '',
      serverIconUrl: room?.iconUrl || null,
      channels: room?.channels && room.channels.length > 0 ? room.channels : [{ id: 'ch-geral', name: 'Geral' }],
      activeChannelId: room?.channels && room.channels.length > 0 ? room.channels[0].id : 'ch-geral',
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

  // Users
  users: [],
  setUsers: (users) => set({ users }),

  // Chat
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (msg) =>
    set((s) => {
      const last = s.messages[s.messages.length - 1];
      if (
        last &&
        last.userName === msg.userName &&
        last.message === msg.message &&
        last.channelId === msg.channelId &&
        last.type === msg.type
      ) {
        return s;
      }
      return { messages: [...s.messages.slice(-500), msg] };
    }),
  addSystemMessage: (message, channelId) =>
    set((s) => {
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

  // Voice
  inVoice: false,
  setInVoice: (inVoice) => set({ inVoice }),

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
  streamingSessions: { netflix: false, prime: false },
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
  setAmSharing: (amSharing) => set({ amSharing }),
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
      streamingSessions: { netflix: false, prime: false },
      activeStreaming: null,
      showVideoPlayer: false,
      watchSession: null,
      screenShareUserId: null,
      screenShareUserName: null,
      amSharing: false,
      screenViewers: [],
    }),
}));
