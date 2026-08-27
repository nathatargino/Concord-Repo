import { create } from 'zustand';
import type { ChatMessage, MusicItem, RoomInfo, ServerChannel, ServerMember, UserInfo } from '../types';

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
  removeChannel: (channelId: string) => void;
  activeChannelId: string;
  setActiveChannelId: (id: string) => void;

  // Server Members (for Servers: Offline, Online, In Call)
  serverMembers: ServerMember[];
  setServerMembers: (members: ServerMember[]) => void;
  myRole: 'owner' | 'sub_owner' | 'member';
  setMyRole: (role: 'owner' | 'sub_owner' | 'member') => void;

  // User
  myId: string;
  myName: string;
  setMyId: (id: string) => void;
  setMyName: (name: string) => void;

  // Users currently in the room
  users: UserInfo[];
  setUsers: (users: UserInfo[]) => void;

  // Chat
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
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
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;

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
  setServerMembers: (serverMembers) => set({ serverMembers }),
  myRole: 'member',
  setMyRole: (myRole) => set({ myRole }),

  // User
  myId: '',
  myName: localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '',
  setMyId: (id) => set({ myId: id }),
  setMyName: (name) => set({ myName: name }),

  // Users
  users: [],
  setUsers: (users) => set({ users }),

  // Chat
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages.slice(-500), msg] })),
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
  setCurrentTrackTitle: (currentTrackTitle) => set({ currentTrackTitle }),
  isPlaying: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),

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
      screenShareUserId: null,
      screenShareUserName: null,
      amSharing: false,
      screenViewers: [],
    }),
}));
