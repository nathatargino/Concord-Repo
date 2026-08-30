import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { playJoinSound, playLeaveSound, playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';
import type { ChatMessage, MusicItem, RoomInfo, ServerChannel, UserInfo } from '../types';

// We re-declare minimal event interfaces here to avoid importing server types
interface ServerToClientEvents {
  user_list: (users: UserInfo[]) => void;
  receive_message: (
    userName: string,
    message: string,
    timestamp: string,
    type?: 'text' | 'image' | 'giphy' | 'file',
    url?: string,
    filename?: string,
    channelId?: string
  ) => void;
  server_updated: (data: { serverId: string; name?: string; iconUrl?: string }) => void;
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
  room_joined: (room: RoomInfo) => void;
  room_error: (message: string) => void;
  room_info: (room: RoomInfo) => void;
  server_muted: () => void;
  server_unmuted: () => void;
  kicked_from_voice: () => void;
  kicked_from_room: () => void;
  channel_created: (channel: ServerChannel) => void;
  channel_updated: (channel: ServerChannel) => void;
  channel_deleted: (channelId: string) => void;
  user_role_updated: (data: { userId: string; role: 'owner' | 'sub_owner' | 'member' }) => void;
  screen_viewer_joined: (viewer: { id: string; name: string }) => void;
  screen_viewers_updated: (data: { broadcasterId: string; viewers: Array<{ id: string; name: string }> }) => void;
}

interface ClientToServerEvents {
  set_username: (name: string, avatarUrl?: string | null) => void;
  update_avatar: (avatarUrl: string | null) => void;
  create_room: (persistentId: string, isServer?: boolean, serverName?: string) => void;
  join_room: (
    roomIdOrCode: string,
    persistentId: string,
    fallbackCode?: string,
    isServer?: boolean,
    serverName?: string,
    initialAvatarUrl?: string | null
  ) => void;
  send_message: (
    message: string,
    type?: 'text' | 'image' | 'giphy' | 'file',
    url?: string,
    filename?: string,
    channelId?: string
  ) => void;
  create_channel: (channelName: string) => void;
  edit_channel: (channelId: string, newName: string) => void;
  delete_channel: (channelId: string) => void;
  update_server: (serverId: string, newName?: string, newIconUrl?: string) => void;
  set_user_role: (targetId: string, role: 'owner' | 'sub_owner' | 'member') => void;
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
  start_watching_screen: (broadcasterId: string) => void;
  stop_watching_screen: (broadcasterId: string) => void;
  update_media_state: (micMuted: boolean, callMuted: boolean) => void;
  admin_mute_user: (targetId: string) => void;
  admin_unmute_user: (targetId: string) => void;
  admin_kick_voice: (targetId: string) => void;
  admin_kick_room: (targetId: string) => void;
  admin_transfer_role: (targetId: string) => void;
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
  onPauseYouTubeFromHub?: (videoId: string, atSeconds: number, token: number) => void;
  onStopYouTube: (token: number) => void;
  onPauseYouTube: () => void;
  onResumeYouTube: () => void;
  onRoomJoined?: (room: RoomInfo) => void;
  onRoomError?: (msg: string) => void;
  onKickedFromVoice?: () => void;
  onKickedFromRoom?: () => void;
  onScreenViewerJoined?: (viewer: { id: string; name: string }) => void;
  onScreenShareStopped?: (userId: string) => void;
}

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://concord-repo.onrender.com' : 'http://localhost:3001');

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

      let persistentId = localStorage.getItem('concord_pid');
      if (!persistentId) {
        persistentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        localStorage.setItem('concord_pid', persistentId);
      }

      // Auto-login with saved name and avatar
      const savedName = localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1');
      const savedAvatar = localStorage.getItem('concord_avatar_url');
      if (savedName) {
        store.setMyName(savedName);
        if (savedAvatar) {
          store.setMyAvatarUrl(savedAvatar);
        }
        socket.emit('set_username', savedName, savedAvatar || null);
      }

      // If there's already a room in the store, re-join it after reconnect with full params
      const currentRoom = useAppStore.getState().room;
      if (currentRoom) {
        const isServer = Boolean(useAppStore.getState().isServer || currentRoom.isServer);
        socket.emit('join_room', currentRoom.id, persistentId, currentRoom.code, isServer, currentRoom.name, savedAvatar || null);
      }
    });

    socket.on('disconnect', () => {
      store.setConnected(false);
    });

    socket.on('room_joined', (room) => {
      store.setRoom(room);
      if (room.isServer) {
        store.setIsServer(true);
        if (room.name) store.setServerName(room.name);
        if (room.iconUrl) store.setServerIconUrl(room.iconUrl);
      }
      callbacksRef.current.onRoomJoined?.(room);
    });

    socket.on('room_info', (room) => {
      store.setRoom(room);
      if (room.isServer) {
        store.setIsServer(true);
        if (room.name) store.setServerName(room.name);
        if (room.iconUrl) store.setServerIconUrl(room.iconUrl);
      }
    });

    socket.on('server_updated', (data) => {
      const currentRoom = useAppStore.getState().room;
      if (currentRoom && currentRoom.id === data.serverId) {
        useAppStore.getState().setRoom({
          ...currentRoom,
          name: data.name || currentRoom.name,
          iconUrl: data.iconUrl !== undefined ? data.iconUrl : currentRoom.iconUrl,
        });
      }
      if (data.name) useAppStore.getState().setServerName(data.name);
      if (data.iconUrl !== undefined) useAppStore.getState().setServerIconUrl(data.iconUrl || null);
    });

    socket.on('room_error', (msg) => {
      callbacksRef.current.onRoomError?.(msg);
    });

    socket.on('user_list', (users) => {
      store.setUsers(users);
    });

    socket.on('receive_message', (userName, message, timestamp, type, url, filename, channelId) => {
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userName,
        message,
        timestamp,
        type: type || 'text',
        url,
        filename,
        channelId: channelId || 'ch-geral',
      };
      store.addMessage(newMsg);
    });

    socket.on('channel_created', (channel) => {
      store.addChannel(channel);
    });

    socket.on('channel_updated', (channel) => {
      store.updateChannel(channel.id, channel.name);
    });

    socket.on('channel_deleted', (channelId) => {
      store.removeChannel(channelId);
    });

    socket.on('user_role_updated', (data) => {
      if (data.userId === socket.id) {
        store.setMyRole(data.role);
      }
    });

    socket.on('screen_viewer_joined', (viewer) => {
      callbacksRef.current.onScreenViewerJoined?.(viewer);
    });

    socket.on('screen_viewers_updated', (data) => {
      store.setScreenViewers(data.viewers);
    });

    socket.on('music_queue_update', (queue) => {
      store.setMusicQueue(queue);
    });

    socket.on('play_youtube', (videoId, startSeconds, token) => {
      store.setCurrentVideoId(videoId);
      store.setIsPlaying(true);
      callbacksRef.current.onPlayYouTube(videoId, startSeconds, token);
    });

    socket.on('pause_youtube', (videoId, atSeconds, token) => {
      store.setCurrentVideoId(videoId);
      store.setIsPlaying(false);
      callbacksRef.current.onPauseYouTubeFromHub?.(videoId, atSeconds, token);
    });

    socket.on('stop_youtube', (token) => {
      store.setCurrentVideoId(null);
      store.setIsPlaying(false);
      callbacksRef.current.onStopYouTube(token);
    });

    socket.on('music_pause', () => {
      store.setIsPlaying(false);
      callbacksRef.current.onPauseYouTube();
    });

    socket.on('music_resume', () => {
      store.setIsPlaying(true);
      callbacksRef.current.onResumeYouTube();
    });

    socket.on('existing_voice_users', (userIds) => {
      callbacksRef.current.onExistingVoiceUsers(userIds);
    });

    socket.on('user_joined_voice', (userId) => {
      if (useAppStore.getState().inVoice) playJoinSound();
      callbacksRef.current.onUserJoinedVoice(userId);
    });

    socket.on('user_left_voice', (userId) => {
      if (useAppStore.getState().inVoice) playLeaveSound();
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

    socket.on('user_started_screen_share', (_userId, userName) => {
      playScreenShareStartSound();
      toast.success(`${userName} começou a compartilhar tela`);
    });

    socket.on('user_stopped_screen_share', (userId: string) => {
      playScreenShareStopSound();
      callbacksRef.current.onScreenShareStopped?.(userId);
      if (useAppStore.getState().screenShareUserId) {
        store.setScreenShare(null, null);
      }
    });

    socket.on('toast_notification', (msg, type) => {
      if (type === 'success') toast.success(msg);
      else if (type === 'error') toast.error(msg);
      else toast(msg, { icon: 'ℹ️' });
    });

    socket.on('server_muted', () => {
      useAudioStore.getState().setServerMuted(true);
      toast.error('Você foi silenciado por um administrador.');
    });

    socket.on('server_unmuted', () => {
      useAudioStore.getState().setServerMuted(false);
      toast.success('Você foi desmutado por um administrador.');
    });

    socket.on('kicked_from_voice', () => {
      toast.error('Você foi desconectado da chamada por um administrador.');
      callbacksRef.current.onKickedFromVoice?.();
    });

    socket.on('kicked_from_room', () => {
      toast.error('Você foi expulso da sala por um administrador.');
      callbacksRef.current.onKickedFromRoom?.();
    });

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(
    (event: keyof ClientToServerEvents, ...args: any[]) => {
      if (socketRef.current?.connected) {
        (socketRef.current.emit as any)(event, ...args);
      }
    },
    []
  );

  return {
    socket: socketRef.current,
    emit,
  };
}
