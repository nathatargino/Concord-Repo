import { create } from 'zustand';
import type { ChatMessage, MusicItem, RoomInfo, UserInfo } from '../types';

interface AppState {
  // Connection
  connected: boolean;
  setConnected: (v: boolean) => void;

  // Room
  room: RoomInfo | null;
  setRoom: (room: RoomInfo | null) => void;

  // User
  myId: string;
  myName: string;
  setMyId: (id: string) => void;
  setMyName: (name: string) => void;

  // Users
  users: UserInfo[];
  setUsers: (users: UserInfo[]) => void;

  // Chat
  messages: ChatMessage[];
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

  // Room
  room: null,
  setRoom: (room) => set({ room }),

  // User
  myId: '',
  myName: localStorage.getItem('concord_username_v1') || '',
  setMyId: (id) => set({ myId: id }),
  setMyName: (name) => set({ myName: name }),

  // Users
  users: [],
  setUsers: (users) => set({ users }),

  // Chat
  messages: [],
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages.slice(-200), msg] })),
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
