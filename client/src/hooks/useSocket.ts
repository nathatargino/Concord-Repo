import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import type { ChatMessage, MusicItem, UserInfo } from '../types';

// We re-declare minimal event interfaces here to avoid importing server types
interface ServerToClientEvents {
  user_list: (users: UserInfo[]) => void;
  receive_message: (userName: string, message: string, timestamp: string, type?: 'text'|'image'|'giphy', url?: string) => void;
  play_youtube: (videoId: string, startSeconds: number, token: number) => void;
  pause_youtube: (videoId: string, atSeconds: number, token: number) => void;
  stop_youtube: (token: number) => void;
  music_pause: () => void;
  music_resume: () => void;
  existing_voice_users: (userIds: string[]) => void;
  user_joined_voice: (userId: string) => void;
  user_left_voice: (userId: string) => void;
  receive_offer: (senderId: string, offer: RTCSessionDescriptionInit) => void;
  receive_answer: (senderId: string, answer: RTCSessionDescriptionInit) => void;
  receive_ice: (senderId: string, candidate: RTCIceCandidateInit) => void;
  user_started_screen_share: (userId: string, userName: string) => void;
  user_stopped_screen_share: (userId: string) => void;
  music_queue_update: (queue: MusicItem[]) => void;
  toast_notification: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface ClientToServerEvents {
  set_username: (name: string) => void;
  send_message: (message: string, type?: 'text'|'image'|'giphy', url?: string) => void;
  request_music: (url: string) => void;
  music_action: (action: 'skip' | 'pause' | 'play' | 'clear') => void;
  remove_from_queue: (token: number) => void;
  reorder_queue: (oldIndex: number, newIndex: number) => void;
  music_ended: (token: number) => void;
  join_voice: () => void;
  leave_voice: () => void;
  send_offer: (targetId: string, offer: RTCSessionDescriptionInit) => void;
  send_answer: (targetId: string, answer: RTCSessionDescriptionInit) => void;
  send_ice: (targetId: string, candidate: RTCIceCandidateInit) => void;
  start_screen_share: () => void;
  stop_screen_share: () => void;
}

export type ConcordSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Callbacks injected from WebRTC hook
export interface SocketCallbacks {
  onExistingVoiceUsers: (ids: string[]) => void;
  onUserJoinedVoice: (userId: string) => void;
  onUserLeftVoice: (userId: string) => void;
  onReceiveOffer: (senderId: string, offer: RTCSessionDescriptionInit) => void;
  onReceiveAnswer: (senderId: string, answer: RTCSessionDescriptionInit) => void;
  onReceiveIce: (senderId: string, candidate: RTCIceCandidateInit) => void;
  onPlayYouTube: (videoId: string, startSeconds: number, token: number) => void;
  onStopYouTube: (token: number) => void;
  onPauseYouTube: () => void;
  onResumeYouTube: () => void;
}

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export function useSocket(callbacks: SocketCallbacks) {
  const socketRef = useRef<ConcordSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const store = useAppStore();

  useEffect(() => {
    const socket: ConcordSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      store.setConnected(true);
      store.setMyId(socket.id ?? '');

      // Auto-login with saved name
      const savedName = localStorage.getItem('concord_username_v1');
      if (savedName) {
        store.setMyName(savedName);
        socket.emit('set_username', savedName);
      }
    });

    socket.on('disconnect', () => {
      store.setConnected(false);
      store.setInVoice(false);
    });

    socket.on('user_list', (users) => {
      store.setUsers(users);
      // Update myId in case of reconnect
      if (socket.id) store.setMyId(socket.id);
    });

    socket.on('receive_message', (userName, message, timestamp, type, url) => {
      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random()}`,
        userName,
        message,
        timestamp,
        type,
        url,
      };
      store.addMessage(msg);
    });

    socket.on('music_queue_update', (queue) => {
      store.setMusicQueue(queue);
    });

    socket.on('play_youtube', (videoId, startSeconds, token) => {
      store.setCurrentVideoId(videoId);
      store.setIsPlaying(true);
      callbacksRef.current.onPlayYouTube(videoId, startSeconds, token);
    });

    socket.on('stop_youtube', (token) => {
      store.setIsPlaying(false);
      callbacksRef.current.onStopYouTube(token);
    });

    socket.on('music_pause', () => {
      callbacksRef.current.onPauseYouTube();
    });

    socket.on('music_resume', () => {
      callbacksRef.current.onResumeYouTube();
    });

    socket.on('existing_voice_users', (ids) => {
      callbacksRef.current.onExistingVoiceUsers(ids);
    });

    socket.on('user_joined_voice', (userId) => {
      callbacksRef.current.onUserJoinedVoice(userId);
    });

    socket.on('user_left_voice', (userId) => {
      callbacksRef.current.onUserLeftVoice(userId);
    });

    socket.on('receive_offer', (senderId, offer) => {
      callbacksRef.current.onReceiveOffer(senderId, offer);
    });

    socket.on('receive_answer', (senderId, answer) => {
      callbacksRef.current.onReceiveAnswer(senderId, answer);
    });

    socket.on('receive_ice', (senderId, candidate) => {
      callbacksRef.current.onReceiveIce(senderId, candidate);
    });

    socket.on('user_started_screen_share', (userId, userName) => {
      if (userId !== socket.id) {
        store.setScreenShare(userId, userName);
        toast(`🖥️ ${userName} está compartilhando a tela`, { duration: 3000 });
      }
    });

    socket.on('user_stopped_screen_share', (userId) => {
      if (userId !== socket.id) {
        store.setScreenShare(null, null);
      }
    });

    socket.on('toast_notification', (message, type) => {
      if (type === 'success') toast.success(message);
      else if (type === 'error') toast.error(message);
      else toast(message);
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  const getSocket = useCallback(() => socketRef.current, []);

  return { emit, getSocket };
}
