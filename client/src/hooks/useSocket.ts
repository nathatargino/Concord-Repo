import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { playLeaveSound, playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';
import { showNativeChatNotification } from '../utils/nativeNotification';
import { notifyInChat } from '../utils/systemMessage';
import { getOrCreatePersistentId, getSavedUsername } from '../lib/supabase';
import {
  handleIncomingFriendRequest,
  handleIncomingFriendResponse,
  handleIncomingFriendCancelled,
  handleIncomingDirectMessage,
} from '../lib/socialRealtime';
import type { ChatMessage, MusicItem, RoomInfo, ServerChannel, UserInfo, WatchSession } from '../types';

// We re-declare minimal event interfaces here to avoid importing server types
interface ServerToClientEvents {
  user_list: (users: UserInfo[]) => void;
  receive_message: (
    userName: string,
    message: string,
    timestamp: string,
    type?: 'text' | 'image' | 'giphy' | 'file' | 'system',
    url?: string,
    filename?: string,
    channelId?: string,
    avatarUrl?: string | null,
    isHistory?: boolean,
    sentAt?: number,
    roomId?: string,
    customRole?: any
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
  watch_session_action: (data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number; senderId: string; senderName?: string; timestamp: number }) => void;
  watch_session_heartbeat: (data: { positionSeconds: number; isPlaying: boolean; timestamp: number; platform?: 'netflix' | 'prime' | 'crunchyroll' }) => void;
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
  member_custom_role_updated: (data: any) => void;
  screen_viewer_joined: (viewer: { id: string; name: string }) => void;
  screen_viewers_updated: (data: { broadcasterId: string; viewers: Array<{ id: string; name: string }> }) => void;
  receive_direct_message: (data: {
    id: string;
    chatId: string;
    senderId: string;
    senderName: string;
    senderAvatarUrl?: string | null;
    content: string;
    msgType: 'text' | 'image' | 'file';
    fileUrl?: string;
    fileName?: string;
    createdAt: string;
  }) => void;
}

interface ClientToServerEvents {
  set_username: (name: string, avatarUrl?: string | null, tag?: string, persistentId?: string, userId?: string) => void;
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
  watch_session_start: (data: { platform: 'netflix' | 'prime' | 'crunchyroll'; titleUrl: string; positionSeconds?: number; isPlaying?: boolean }) => void;
  watch_session_action: (data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number }) => void;
  watch_session_end: () => void;
  watch_session_query: () => void;
  watch_session_heartbeat: (data: { platform: 'netflix' | 'prime' | 'crunchyroll'; positionSeconds: number; isPlaying: boolean; url: string }) => void;
  set_member_custom_role: (data: any) => void;
  send_direct_message: (data: {
    chatId: string;
    targetUserId?: string;
    targetName?: string;
    senderId: string;
    senderName: string;
    senderAvatarUrl?: string | null;
    content: string;
    msgType?: 'text' | 'image' | 'file';
    fileUrl?: string;
    fileName?: string;
    createdAt?: string;
  }) => void;
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
  onScreenShareStarted?: (userId: string, userName: string) => void;
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
import { SOCKET_URL } from '../config';

const APP_SOCKET_START_TIME = Date.now();

export function useSocket(callbacks: SocketCallbacks) {
  const socketRef = useRef<ConcordSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const joinGracePeriodUntilRef = useRef<number>(Date.now() + 4000);
  const needsVoiceRejoinRef = useRef<boolean>(false);

  const store = useAppStore();

  useEffect(() => {
    const socket: ConcordSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 45000,
    });

    socketRef.current = socket;
    (window as any).__concord_socket = socket;

    socket.io.on('reconnect_attempt', (attempt) => {
      console.log(`[Socket] Tentativa de reconexão #${attempt}...`);
    });

    socket.io.on('reconnect', (attempt) => {
      console.log(`[Socket] Reconectado com sucesso após ${attempt} tentativas`);
    });

    socket.io.on('reconnect_error', (err) => {
      console.warn('[Socket] Erro na tentativa de reconexão:', err.message);
    });

    socket.io.on('reconnect_failed', () => {
      console.error('[Socket] Falha em todas as tentativas de reconexão');
      useAppStore.getState().setConnected(false);
    });

    socket.on('connect', () => {
      console.log('[Socket] Conectado ao servidor:', SOCKET_URL, 'ID:', socket.id, 'Recovered:', socket.recovered);
      useAppStore.getState().setConnected(true);
      useAppStore.getState().setMyId(socket.id ?? '');

      const persistentId = getOrCreatePersistentId();

      // Auto-login with saved name and avatar
      const savedName = getSavedUsername();
      const savedAvatar = localStorage.getItem('concord_avatar_url');
      const savedTag = localStorage.getItem('concord_user_tag');
      const savedUserId = localStorage.getItem('concord_user_id') || undefined;
      if (savedName) {
        useAppStore.getState().setMyName(savedName);
        if (savedAvatar) {
          useAppStore.getState().setMyAvatarUrl(savedAvatar);
        }
        if (savedTag) {
          useAppStore.getState().setMyTag(savedTag);
        }
        socket.emit('set_username', savedName, savedAvatar || null, savedTag || undefined, persistentId, savedUserId);
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
      if (useAppStore.getState().inVoice) {
        needsVoiceRejoinRef.current = true;
      }
      useAppStore.getState().setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] Erro de conexão com o servidor:', err.message);
      useAppStore.getState().setConnected(false);
    });

    socket.on('room_joined', (room) => {
      joinGracePeriodUntilRef.current = Date.now() + 3500;
      useAppStore.getState().setRoom(room);
      if (room.isServer) {
        useAppStore.getState().setIsServer(true);
        if (room.name) useAppStore.getState().setServerName(room.name);
        if (room.iconUrl) useAppStore.getState().setServerIconUrl(room.iconUrl);
      }
      callbacksRef.current.onRoomJoined?.(room);

      // Re-sincronizar presença de voz e streaming APENAS após reconexão real do socket
      const appState = useAppStore.getState();
      if (appState.inVoice && needsVoiceRejoinRef.current) {
        needsVoiceRejoinRef.current = false;
        console.log('[Socket] Re-estabelecendo presença em voz após reconexão...');
        socket.emit('join_voice');
        const audioState = useAudioStore.getState();
        socket.emit('update_media_state', audioState.micMuted, audioState.callMuted);
        if (appState.isScreenSharing) {
          socket.emit('start_screen_share');
        }
        if (appState.screenShareUserId) {
          socket.emit('start_watching_screen', appState.screenShareUserId);
        }
      }
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

    // ─── NOTIFICAÇÕES E SOLICITAÇÕES DE AMIZADE EM TEMPO REAL ─────────
    socket.on('receive_friend_request' as any, (data: any) => {
      console.log('[Socket] receive_friend_request:', data);
      handleIncomingFriendRequest(data);
    });

    socket.on('friend_request_response' as any, (data: any) => {
      console.log('[Socket] friend_request_response:', data);
      handleIncomingFriendResponse(data);
    });

    socket.on('friend_request_cancelled' as any, (data: any) => {
      console.log('[Socket] friend_request_cancelled:', data);
      handleIncomingFriendCancelled(data);
    });

    socket.on('receive_direct_message' as any, (data: any) => {
      console.log('[Socket] receive_direct_message:', data);
      if (data && typeof data === 'object') {
        data.__directSocketDelivery = true;
      }
      handleIncomingDirectMessage(data);
    });


    socket.on('member_custom_role_updated' as any, (data: any) => {
      const myId = socket.id || useAppStore.getState().myId;
      const persistentId = getOrCreatePersistentId();
      const myName = (useAppStore.getState().myName || getSavedUsername() || '').trim().toLowerCase();
      const targetId = data.targetUserId;
      const targetName = (data.targetUsername || '').trim().toLowerCase();

      const isMe = Boolean(
        (targetId && (targetId === myId || targetId === persistentId)) ||
        (targetName && targetName === myName)
      );

      const currentUsers = useAppStore.getState().users;
      const updatedUsers = currentUsers.map((u) => {
        if (u.id === data.targetUserId || (u.name && u.name.toLowerCase() === targetName)) {
          return { ...u, customRole: data.customRole };
        }
        return u;
      });
      useAppStore.getState().setUsers(updatedUsers);

      const currentMembers = useAppStore.getState().serverMembers;
      const updatedMembers = currentMembers.map((m) => {
        if (m.id === data.targetUserId || (m.username && m.username.toLowerCase() === targetName)) {
          return { ...m, customRole: data.customRole };
        }
        return m;
      });
      useAppStore.getState().setServerMembers(updatedMembers);

      if (isMe) {
        if (data.customRole?.isAdmin && useAppStore.getState().myRole !== 'owner') {
          useAppStore.getState().setMyRole('sub_owner');
        } else if (!data.customRole?.isAdmin && useAppStore.getState().myRole === 'sub_owner') {
          useAppStore.getState().setMyRole('member');
        }

        if (data.customRole?.name) {
          const sysMsg = `Seu cargo foi alterado para ${data.customRole.name}`;
          const notificationsEnabled = useAppStore.getState().systemNotificationsEnabled;
          if (notificationsEnabled) {
            const currentMsgs = useAppStore.getState().messages;
            const alreadyAdded = currentMsgs.some(
              (m) => m.isSystem && m.message === sysMsg && Date.now() - (m.sentAt || 0) < 5000
            );
            if (!alreadyAdded) {
              notifyInChat(sysMsg);
            }
            toast(sysMsg, {
              icon: data.customRole.emoji || '🛡️',
              duration: 4500,
            });
          }
        }
      }
    });

    socket.on('receive_message', (userName, message, timestamp, type, url, filename, channelId, avatarUrl, isHistory, sentAt, roomId, customRole) => {
      const isSystem = userName === 'Sistema' || (type as string) === 'system' || (typeof message === 'string' && message.startsWith('O usuário ') && message.includes(' executou o comando /'));
      const appState = useAppStore.getState();
      const targetRoomId = roomId || appState.room?.id;
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        roomId: targetRoomId,
        userName: isSystem ? 'Sistema' : userName,
        message,
        timestamp,
        isSystem,
        type: type || 'text',
        url,
        filename,
        channelId: channelId || (appState.isServer ? 'ch-geral' : undefined),
        avatarUrl: isSystem ? null : (avatarUrl || null),
        customRole: customRole || null,
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
      const myName = (appState.myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '').trim().toLowerCase();
      const isMe = !isSystem && Boolean(myName && userName.trim().toLowerCase() === myName);

      if (!isMe && !isSystem) {
        const serverOrRoomName = appState.serverName || appState.room?.name || 'Concord';
        const channelObj = appState.channels.find((c) => c.id === channelId);
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

    socket.on('message_reaction' as any, (messageId: string, emoji: string, userName: string) => {
      const cleanMy = (useAppStore.getState().myName || '').trim().toLowerCase();
      const cleanSender = (userName || '').trim().toLowerCase();
      if (!cleanMy || cleanSender !== cleanMy) {
        store.toggleMessageReaction(messageId, emoji, userName);
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
      if (useAppStore.getState().isPiPActive) {
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
    //
    // IMPORTANTE: NÃO navegamos automaticamente ao receber watch_session_sync.
    // Isso evitava que a view do streaming fosse aberta sem consentimento do usuário
    // e causava race conditions quando o DRM ainda não tinha carregado.
    //
    // Fluxo correto:
    //  1. Atualizar o watchSession no store (todos recebem, mesmo quem não está em voz)
    //  2. Se o usuário está em voz E a view de streaming JÁ está aberta →
    //     navegar para o título E sincronizar posição (com delay para DRM carregar)
    //  3. Se o usuário está em voz E a view NÃO está aberta →
    //     mostrar banner no ChatPanel com botão "Assistir Junto"
    //     (o próprio usuário escolhe entrar)
    //  4. Se o usuário NÃO está em voz → apenas atualiza o store (sem ação)
    socket.on('watch_session_sync', (session) => {
      const prevSession = useAppStore.getState().watchSession;
      store.setWatchSession(session);
      const electron = (window as any).electron;

      if (!session || !useAppStore.getState().inVoice) return;

      // Verificar se a view de streaming já está aberta para este serviço
      const streamingSessions = useAppStore.getState().streamingSessions;
      const isViewOpen = Boolean(
        streamingSessions[session.platform] ||
        useAppStore.getState().activeStreaming?.service === session.platform
      );

      if (isViewOpen && electron) {
        const isNewTitle = Boolean(prevSession && prevSession.titleUrl !== session.titleUrl);

        // Se watch_session_sync trouxer um novo titleUrl diferente do anterior com a view aberta,
        // navega diretamente para o título
        if (isNewTitle && electron.navigateToTitle) {
          electron.navigateToTitle({
            service: session.platform,
            url: session.titleUrl,
            autoPlay: session.isPlaying,
          });
        } else if (electron.navigateStreamingView && (!prevSession || prevSession.titleUrl !== session.titleUrl)) {
          electron.navigateStreamingView(session.platform, session.titleUrl);
        }

        // Sincronizar posição após delay (DRM/carregamento de página)
        const syncDelay = isNewTitle ? 2000 : (prevSession ? 600 : 2500);
        const elapsedSinceUpdate = session.isPlaying
          ? Math.max(0, (Date.now() - session.lastUpdated) / 1000)
          : 0;
        const estimatedPosition = session.positionSeconds + elapsedSinceUpdate;

        setTimeout(() => {
          const currentSession = useAppStore.getState().watchSession;
          if (!currentSession || currentSession.platform !== session.platform) return;
          electron.syncStreamingPlayback?.({
            action: session.isPlaying ? 'play' : 'pause',
            positionSeconds: estimatedPosition + (session.isPlaying ? syncDelay / 1000 : 0),
            service: session.platform,
            autoDrift: false,
          });
        }, syncDelay);
      }
      // Caso a view não esteja aberta: o ChatPanel exibirá o banner "Assistir Junto"
      // e o usuário decidirá entrar — sem ação automática aqui
    });

    // Debounce para evitar loops de echo de seek entre participantes
    let watchActionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    socket.on('watch_session_action', (data) => {
      const electron = (window as any).electron;
      const currentSession = useAppStore.getState().watchSession;
      if (!currentSession) return;

      const updated: WatchSession = {
        ...currentSession,
        isPlaying: data.action === 'play' ? true : data.action === 'pause' ? false : currentSession.isPlaying,
        positionSeconds: typeof data.positionSeconds === 'number' ? data.positionSeconds : currentSession.positionSeconds,
        lastUpdated: data.timestamp || Date.now(),
        startedBy: data.senderId,
        startedByName: data.senderName || currentSession.startedByName,
      };
      store.setWatchSession(updated);

      // Só aplicar sincronização se a view de streaming estiver aberta
      const streamingSessions = useAppStore.getState().streamingSessions;
      const isViewOpen = Boolean(
        streamingSessions[currentSession.platform] ||
        useAppStore.getState().activeStreaming?.service === currentSession.platform
      );
      if (!isViewOpen || !electron?.syncStreamingPlayback) return;

      // Debounce reduzido para 80ms para que o play/pause/seek de qualquer membro reflita instantaneamente
      if (watchActionDebounceTimer) clearTimeout(watchActionDebounceTimer);
      watchActionDebounceTimer = setTimeout(() => {
        electron.syncStreamingPlayback?.({
          action: data.action,
          positionSeconds: data.positionSeconds,
          service: currentSession.platform,
          autoDrift: false,
        });
      }, 80);
    });

    socket.on('watch_session_heartbeat', (data) => {
      const electron = (window as any).electron;
      const currentSession = useAppStore.getState().watchSession;
      if (!currentSession) return;

      const updated: WatchSession = {
        ...currentSession,
        positionSeconds: data.positionSeconds,
        isPlaying: data.isPlaying,
        lastUpdated: data.timestamp || Date.now(),
      };
      store.setWatchSession(updated);

      // Se a view de streaming estiver aberta, enviar para alinhamento suave de drift (> 3.0s)
      const streamingSessions = useAppStore.getState().streamingSessions;
      const isViewOpen = Boolean(
        streamingSessions[currentSession.platform] ||
        useAppStore.getState().activeStreaming?.service === currentSession.platform
      );
      if (isViewOpen && electron?.syncStreamingPlayback) {
        electron.syncStreamingPlayback({
          action: data.isPlaying ? 'play' : 'pause',
          positionSeconds: data.positionSeconds,
          service: currentSession.platform,
          autoDrift: true,
        });
      }
    });

    socket.on('existing_voice_users', (userIds) => {
      callbacksRef.current.onExistingVoiceUsers(userIds);
    });

    socket.on('user_joined_voice', (userId) => {
      callbacksRef.current.onUserJoinedVoice(userId);
    });

    socket.on('user_left_voice', (userId) => {
      if (useAppStore.getState().inVoice) playLeaveSound();
      callbacksRef.current.onUserLeftVoice(userId);
    });

    socket.on('receive_offer', (senderId, offer) => {
      if ((offer as any)?.type === 'concord_system_event') {
        const sysEvent = (offer as any).event;
        const payload = (offer as any).payload;
        if (sysEvent === 'receive_friend_request') {
          handleIncomingFriendRequest(payload);
        } else if (sysEvent === 'friend_request_response') {
          handleIncomingFriendResponse(payload);
        } else if (sysEvent === 'friend_request_cancelled') {
          handleIncomingFriendCancelled(payload);
        } else if (sysEvent === 'receive_direct_message') {
          if (payload && typeof payload === 'object') {
            payload.__directSocketDelivery = true;
          }
          handleIncomingDirectMessage(payload);
        }
        return;
      }
      callbacksRef.current.onReceiveOffer(senderId, offer);
    });

    socket.on('receive_answer', (senderId, answer) => {
      callbacksRef.current.onReceiveAnswer(senderId, answer);
    });

    socket.on('receive_ice', (senderId, candidate) => {
      callbacksRef.current.onReceiveIce(senderId, candidate);
    });

    socket.on('user_started_screen_share', (userId, userName) => {
      callbacksRef.current.onScreenShareStarted?.(userId, userName);
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
      if (watchActionDebounceTimer) {
        clearTimeout(watchActionDebounceTimer);
        watchActionDebounceTimer = null;
      }
      if ((window as any).__concord_socket === socket) {
        (window as any).__concord_socket = null;
      }
      socket.io.removeAllListeners();
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
