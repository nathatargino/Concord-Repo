import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { playJoinSound, playLeaveSound, playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';
import { showNativeChatNotification } from '../utils/nativeNotification';
import { getOrCreatePersistentId, getSavedUsername } from '../lib/supabase';
import type { ChatMessage, MusicItem, RoomInfo, ServerChannel, UserInfo, WatchSession } from '../types';

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
    channelId?: string,
    avatarUrl?: string | null,
    isHistory?: boolean,
    sentAt?: number
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
  watch_session_sync: (session: WatchSession | null) => void;
  watch_session_action: (data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number; senderId: string; timestamp: number }) => void;
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
    channelId?: string,
    avatarUrl?: string | null
  ) => void;
  create_channel: (channelName: string) => void;
  edit_channel: (channelId: string, newName: string) => void;
  delete_channel: (channelId: string) => void;
  update_server: (serverId: string, newName?: string, newIconUrl?: string) => void;
  set_user_role: (targetId: string, role: 'owner' | 'sub_owner' | 'member') => void;
  request_music: (url: string, title?: string, playNow?: boolean) => void;
  music_action: (action: 'skip' | 'pause' | 'play' | 'clear') => void;
  music_seek: (time: number) => void;
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
  destroy_empty_server: (serverId: string) => void;
  watch_session_start: (data: { platform: 'netflix' | 'prime'; titleUrl: string; positionSeconds?: number; isPlaying?: boolean }) => void;
  watch_session_action: (data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number }) => void;
  watch_session_end: () => void;
  watch_session_query: () => void;
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
  onMusicSeek: (time: number) => void;
  onRoomJoined?: (room: RoomInfo) => void;
  onRoomError?: (msg: string) => void;
  onKickedFromVoice?: () => void;
  onKickedFromRoom?: () => void;
  onScreenViewerJoined?: (viewer: { id: string; name: string }) => void;
  onScreenShareStopped?: (userId: string) => void;
}

// URL do servidor Socket.IO:
//  - Se VITE_SERVER_URL estiver definido (ex: .env.local), usa essa URL. Recomendado em dev local
//    para garantir que web (localhost:5173) e Electron usem o MESMO servidor.
//  - Em produção (vite build), usa o servidor da Render.
//  - Em desenvolvimento sem a variável, usa localhost:3001.
//
// ⚠️  Se web e desktop não se enxergam na mesma sala, provavelmente estão em servidores
//      diferentes. Certifique-se de ter um .env.local com VITE_SERVER_URL=http://localhost:3001
//      ao desenvolver localmente.
const SOCKET_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://concord-repo.onrender.com' : 'http://localhost:3001');
console.log('[Socket] Servidor alvo:', SOCKET_URL, '| PROD:', import.meta.env.PROD, '| VITE_SERVER_URL:', import.meta.env.VITE_SERVER_URL || '(não definido)');
const APP_SOCKET_START_TIME = Date.now();

export function useSocket(callbacks: SocketCallbacks) {
  const socketRef = useRef<ConcordSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const joinGracePeriodUntilRef = useRef<number>(Date.now() + 4000);

  const store = useAppStore();

  useEffect(() => {
    const socket: ConcordSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current = socket;
    (window as any).__concord_socket = socket;

    socket.on('connect', () => {
      console.log('[Socket] Conectado ao servidor:', SOCKET_URL, 'ID:', socket.id);
      store.setConnected(true);
      store.setMyId(socket.id ?? '');

      let persistentId = getOrCreatePersistentId();

      // Auto-login with saved name and avatar
      const savedName = getSavedUsername();
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

    socket.on('disconnect', (reason) => {
      console.warn('[Socket] Desconectado do servidor:', reason);
      store.setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] Erro de conexão com o servidor:', err.message);
      store.setConnected(false);
    });

    socket.on('room_joined', (room) => {
      joinGracePeriodUntilRef.current = Date.now() + 3500;
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

    socket.on('receive_message', (userName, message, timestamp, type, url, filename, channelId, avatarUrl, isHistory, sentAt) => {
      const isSystem = userName === 'Sistema' || (type as string) === 'system' || (typeof message === 'string' && message.startsWith('O usuário ') && message.includes(' executou o comando /'));
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userName: isSystem ? 'Sistema' : userName,
        message,
        timestamp,
        isSystem,
        type: type || 'text',
        url,
        filename,
        channelId: channelId || 'ch-geral',
        avatarUrl: isSystem ? null : (avatarUrl || null),
      };
      store.addMessage(newMsg);

      // NUNCA notificar mensagens históricas recebidas ao carregar ou entrar na sala
      if (isHistory) {
        return;
      }

      // NUNCA notificar mensagens enviadas antes de abrir o aplicativo Concord
      if (typeof sentAt === 'number' && sentAt > 0 && sentAt < APP_SOCKET_START_TIME) {
        return;
      }

      // Durante a conexão e sincronização inicial da sala, suprimir notificações de mensagens antigas
      if (Date.now() < joinGracePeriodUntilRef.current && (!sentAt || sentAt < APP_SOCKET_START_TIME)) {
        return;
      }

      // Notificação nativa do Windows para mensagens enviadas por outros usuários
      const myName = (store.myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '').trim().toLowerCase();
      const isMe = !isSystem && Boolean(myName && userName.trim().toLowerCase() === myName);

      if (!isMe && !isSystem) {
        const serverOrRoomName = store.serverName || store.room?.name || 'Concord';
        const channelObj = store.channels.find((c) => c.id === channelId);
        const channelName = channelObj ? `#${channelObj.name}` : '';
        const roomDisplay = channelName ? `${serverOrRoomName} (${channelName})` : serverOrRoomName;

        let displayMessage = message;
        if (type === 'image') {
          displayMessage = message ? `📷 ${message}` : '📷 Enviou uma imagem';
        } else if (type === 'giphy') {
          displayMessage = '🎬 Enviou um GIF';
        } else if (type === 'file') {
          displayMessage = filename ? `📎 Arquivo: ${filename}` : '📎 Enviou um arquivo';
        }

        showNativeChatNotification({
          userName,
          roomName: roomDisplay,
          message: displayMessage,
          avatarUrl: avatarUrl || null,
          sentAt: typeof sentAt === 'number' && sentAt > 0 ? sentAt : Date.now(),
        });
      }
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
      store.setActiveMediaTab('youtube');
      const electron = (window as any).electron;
      if (electron?.setActiveMediaTab) {
        electron.setActiveMediaTab('youtube');
      }
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
      if (store.isPiPActive) {
        (window as any).electron?.closePipWindow?.();
        store.setPiPActive(false);
      }
    });

    socket.on('music_pause', () => {
      store.setIsPlaying(false);
      callbacksRef.current.onPauseYouTube();
    });

    socket.on('music_resume', () => {
      store.setIsPlaying(true);
      callbacksRef.current.onResumeYouTube();
    });

    socket.on('music_seek' as any, (time: number) => {
      callbacksRef.current.onMusicSeek?.(time);
    });

    // ─── WATCH PARTY (STREAMING SYNC) ───
    socket.on('watch_session_sync', (session) => {
      store.setWatchSession(session);
      const electron = (window as any).electron;

      if (session && store.inVoice) {
        store.setActiveMediaTab(session.platform);
        store.setShowVideoPlayer(true);
        if (electron?.setActiveMediaTab) {
          electron.setActiveMediaTab(session.platform);
        }

        const elapsedSinceUpdate = session.isPlaying
          ? Math.max(0, (Date.now() - session.lastUpdated) / 1000)
          : 0;
        const estimatedPosition = session.positionSeconds + elapsedSinceUpdate;

        if (electron?.navigateStreamingView) {
          electron.navigateStreamingView(session.platform, session.titleUrl);
        }

        if (electron?.syncStreamingPlayback) {
          setTimeout(() => {
            electron.syncStreamingPlayback?.({
              action: session.isPlaying ? 'play' : 'pause',
              positionSeconds: estimatedPosition,
              service: session.platform,
            });
          }, 1200);
        }
      }
    });

    socket.on('watch_session_action', (data) => {
      const electron = (window as any).electron;
      const currentSession = useAppStore.getState().watchSession;
      if (!currentSession) return;

      const updated: WatchSession = {
        ...currentSession,
        isPlaying: data.action === 'play' ? true : data.action === 'pause' ? false : currentSession.isPlaying,
        positionSeconds: typeof data.positionSeconds === 'number' ? data.positionSeconds : currentSession.positionSeconds,
        lastUpdated: data.timestamp || Date.now(),
      };
      store.setWatchSession(updated);

      if (electron?.syncStreamingPlayback) {
        electron.syncStreamingPlayback({
          action: data.action,
          positionSeconds: data.positionSeconds,
          service: currentSession.platform,
        });
      }
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
      store.addSystemMessage(`🖥️ ${userName} começou a compartilhar tela`);
    });

    socket.on('user_stopped_screen_share', (userId: string) => {
      callbacksRef.current.onScreenShareStopped?.(userId);
      if (useAppStore.getState().screenShareUserId === userId) {
        playScreenShareStopSound();
        store.setScreenShare(null, null);
      }
    });

    socket.on('toast_notification', (msg) => {
      store.addSystemMessage(msg);
    });

    socket.on('server_muted', () => {
      useAudioStore.getState().setServerMuted(true);
      store.addSystemMessage('Você foi silenciado por um administrador.');
    });

    socket.on('server_unmuted', () => {
      useAudioStore.getState().setServerMuted(false);
      store.addSystemMessage('Você foi desmutado por um administrador.');
    });

    socket.on('kicked_from_voice', () => {
      store.addSystemMessage('Você foi desconectado da chamada por um administrador.');
      callbacksRef.current.onKickedFromVoice?.();
    });

    socket.on('kicked_from_room', () => {
      store.addSystemMessage('Você foi expulso da sala por um administrador.');
      callbacksRef.current.onKickedFromRoom?.();
    });

    socket.on('server_members' as any, (members: any[]) => {
      if (members && Array.isArray(members)) {
        store.setServerMembers(members.map(m => ({
          id: m.id || m.username,
          username: m.username,
          avatarUrl: m.avatarUrl || null,
          isOnline: false,
          inVoice: false,
          role: m.role || 'member',
        })));
      }
    });

    return () => {
      if ((window as any).__concord_socket === socket) {
        (window as any).__concord_socket = null;
      }
      socket.removeAllListeners();
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(
    (event: keyof ClientToServerEvents, ...args: any[]) => {
      if (socketRef.current) {
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
