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

  // Channels (for Servers)
  channels: ServerChannel[];
  setChannels: (channels: ServerChannel[]) => void;
  addChannel: (channel: ServerChannel) => void;
  activeChannelId: string;
  setActiveChannelId: (id: string) => void;

  // Server Members (for Servers: Offline, Online, In Call)
  serverMembers: ServerMember[];
  setServerMembers: (members: ServerMember[]) => void;

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
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;

  // Screen share
  screenShareUserId: string | null;
  screenShareUserName: string | null;
  setScreenShare: (userId: string | null, userName?: string | null) => void;
  amSharing: boolean;
  setAmSharing: (v: boolean) => void;
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
      channels: room?.channels && room.channels.length > 0 ? room.channels : [{ id: 'ch-geral', name: 'geral' }],
      activeChannelId: room?.channels && room.channels.length > 0 ? room.channels[0].id : 'ch-geral',
    }),
  isServer: false,
  setIsServer: (isServer) => set({ isServer }),
  serverName: '',
  setServerName: (serverName) => set({ serverName }),

  // Channels
  channels: [{ id: 'ch-geral', name: 'geral' }],
  setChannels: (channels) => set({ channels }),
  addChannel: (channel) =>
    set((s) => {
      if (s.channels.some((c) => c.id === channel.id || c.name === channel.name)) return s;
      return { channels: [...s.channels, channel] };
    }),
  activeChannelId: 'ch-geral',
  setActiveChannelId: (activeChannelId) => set({ activeChannelId }),

  // Server Members
  serverMembers: [],
  setServerMembers: (serverMembers) => set({ serverMembers }),

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
  setInVoice: (v) => set({ inVoice: v }),

  // Music
  musicQueue: [],
  setMusicQueue: (musicQueue) => set({ musicQueue }),
  currentVideoId: null,
  setCurrentVideoId: (id) => set({ currentVideoId: id }),
  isPlaying: false,
  setIsPlaying: (v) => set({ isPlaying: v }),

  // Screen share
  screenShareUserId: null,
  screenShareUserName: null,
  setScreenShare: (userId, userName = null) =>
    set({ screenShareUserId: userId, screenShareUserName: userName }),
  amSharing: false,
  setAmSharing: (v) => set({ amSharing: v }),
}));
