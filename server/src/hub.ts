import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  InterServerEvents,
  MusicItem,
  RoomInfo,
  ServerChannel,
  ServerToClientEvents,
  SocketData,
  UserInfo,
} from './types';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// ─── ROOM MANAGER ──────────────────────────────────────────────────────────────

const ROOM_DURATION_MS = 14 * 60 * 60 * 1000; // 14 hours
const ROOM_CODE_LENGTH = 6;

export interface RoomState {
  id: string;
  code: string;
  name?: string;
  iconUrl?: string;
  isServer?: boolean;
  channels: ServerChannel[];
  createdAt: number;
  expiresAt: number;
  adminIds: string[];
  adminPersistentIds: string[];
  ownerId?: string;
  subOwnerIds?: string[];
  users: Map<string, UserInfo>;
  voiceUsers: Set<string>;
  screenSharingUsers: Set<string>;
  musicQueue: MusicItem[];
  currentMusicToken: number | null;
  currentMusicVideoId: string | null;
  currentMusicStartTime: number | null;
}

const rooms = new Map<string, RoomState>();
const codeToRoomId = new Map<string, string>(); // reverse lookup
const screenViewersMap = new Map<string, Map<string, string>>(); // broadcasterId -> (viewerSocketId -> viewerName)

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createRoom(
  persistentId?: string,
  customCode?: string,
  customId?: string,
  isServer?: boolean,
  serverName?: string
): RoomState {
  const id = customId || generateId();
  let code = customCode ? customCode.toUpperCase() : generateCode();
  // Ensure code uniqueness if auto-generated
  if (!customCode) {
    while (codeToRoomId.has(code)) {
      code = generateCode();
    }
  }
  const now = Date.now();
  const defaultChannel: ServerChannel = { id: 'ch-geral', name: 'Geral', serverId: id };
  const room: RoomState = {
    id,
    code,
    name: serverName || (isServer ? 'Servidor Concord' : 'Sala Concord'),
    isServer: !!isServer,
    channels: isServer ? [defaultChannel] : [],
    createdAt: now,
    expiresAt: isServer ? Infinity : now + ROOM_DURATION_MS,
    adminIds: [],
    adminPersistentIds: persistentId ? [persistentId] : [],
    subOwnerIds: [],
    users: new Map(),
    voiceUsers: new Set(),
    screenSharingUsers: new Set(),
    musicQueue: [],
    currentMusicToken: null,
    currentMusicVideoId: null,
    currentMusicStartTime: null,
  };
  rooms.set(id, room);
  codeToRoomId.set(code, id);
  console.log(`[Room] Created ${isServer ? 'server' : 'room'} ${id} (code: ${code})`);
  return room;
}

export function getRoom(idOrCode: string): RoomState | null {
  // Try direct ID first
  if (rooms.has(idOrCode)) {
    const room = rooms.get(idOrCode)!;
    if (!room.isServer && Date.now() > room.expiresAt) {
      destroyRoom(room.id);
      return null;
    }
    return room;
  }
  // Try by code
  const id = codeToRoomId.get(idOrCode.toUpperCase());
  if (id) {
    const room = rooms.get(id);
    if (!room) return null;
    if (!room.isServer && Date.now() > room.expiresAt) {
      destroyRoom(room.id);
      return null;
    }
    return room;
  }
  return null;
}

export function destroyRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  // Permanent servers should NEVER be destroyed automatically
  if (room.isServer) return;
  codeToRoomId.delete(room.code);
  rooms.delete(roomId);
  console.log(`[Room] Destroyed room ${roomId}`);
}

// Clean up expired rooms every 5 minutes (ignoring permanent servers)
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (!room.isServer && now > room.expiresAt) {
      destroyRoom(id);
    }
  }
}, 5 * 60 * 1000);

export function toRoomInfo(room: RoomState): RoomInfo {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    iconUrl: room.iconUrl,
    isServer: room.isServer,
    channels: room.channels,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    userCount: room.users.size,
    adminIds: room.adminIds,
    ownerId: room.ownerId,
    subOwnerIds: room.subOwnerIds,
  };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function broadcastUserList(io: IoServer, room: RoomState) {
  io.to(room.id).emit('user_list', Array.from(room.users.values()));
}

function handleAdminReassignment(socketId: string, io: IoServer, room: RoomState) {
  if (room.adminIds.includes(socketId)) {
    room.adminIds = room.adminIds.filter(id => id !== socketId);
    if (room.adminIds.length === 0 && room.users.size > 0) {
      const nextAdminId = room.users.keys().next().value;
      if (nextAdminId) {
        room.adminIds = [nextAdminId];
        const nextAdminUser = room.users.get(nextAdminId);
        if (nextAdminUser && nextAdminUser.persistentId) {
          if (!room.adminPersistentIds.includes(nextAdminUser.persistentId)) {
            room.adminPersistentIds.push(nextAdminUser.persistentId);
          }
        }
        io.to(nextAdminId).emit('toast_notification', 'Você agora é um administrador!', 'info');
      }
    }
    io.to(room.id).emit('room_info', toRoomInfo(room));
  }
}

function broadcastQueueUpdate(io: IoServer, room: RoomState) {
  io.to(room.id).emit('music_queue_update', [...room.musicQueue]);
}

function playNextInQueue(io: IoServer, room: RoomState) {
  if (room.musicQueue.length === 0) {
    if (room.currentMusicToken !== null) {
      io.to(room.id).emit('stop_youtube', room.currentMusicToken);
      room.currentMusicToken = null;
      room.currentMusicVideoId = null;
      room.currentMusicStartTime = null;
    }
    return;
  }
  const next = room.musicQueue.shift()!;
  room.currentMusicToken = next.token;
  room.currentMusicVideoId = next.videoId;
  room.currentMusicStartTime = Date.now();
  io.to(room.id).emit('play_youtube', next.videoId, 0, next.token);
  broadcastQueueUpdate(io, room);
}

// ─── REGISTER HUB ──────────────────────────────────────────────────────────────

export function registerHub(io: IoServer) {
  io.on('connection', (socket: IoSocket) => {
    console.log(`[+] Connected: ${socket.id}`);

    let user: UserInfo = { id: socket.id, name: '', inVoice: false, screenSharing: false, micMuted: false, callMuted: false };

    // Helper: get current room (returns null if socket not in a room)
    function getCurrentRoom(): RoomState | null {
      const roomId = socket.data.roomId;
      if (!roomId) return null;
      return rooms.get(roomId) ?? null;
    }

    // ─── CREATE ROOM / SERVER ──────────────────────────────────────
    socket.on('create_room', (persistentId?: string, isServer?: boolean, serverName?: string) => {
      const room = createRoom(persistentId, undefined, undefined, isServer, serverName);
      room.adminIds = [socket.id];
      socket.data.roomId = room.id;
      socket.join(room.id);
      user = { id: socket.id, persistentId, name: '', inVoice: false, screenSharing: false, micMuted: false, callMuted: false };
      room.users.set(socket.id, user);
      socket.emit('room_joined', toRoomInfo(room));
      console.log(`[Room] ${socket.id} created and joined ${room.isServer ? 'server' : 'room'} ${room.id}`);
    });

    // ─── JOIN ROOM / SERVER ────────────────────────────────────────
    socket.on('join_room', (roomIdOrCode: string, persistentId?: string, fallbackCode?: string, isServerHint?: boolean, serverNameHint?: string) => {
      const cleanIdOrCode = (roomIdOrCode || '').trim();
      let room = getRoom(cleanIdOrCode);
      if (!room && fallbackCode) {
        room = getRoom(fallbackCode.trim());
      }

      // Auto-restore or create room state in memory so socket is never disconnected/orphaned
      if (!room) {
        const isServer = Boolean(
          isServerHint || 
          cleanIdOrCode.toUpperCase().startsWith('SRV-') || 
          (fallbackCode && fallbackCode.toUpperCase().startsWith('SRV-'))
        );
        const code = fallbackCode ? fallbackCode.toUpperCase() : (cleanIdOrCode.length <= 10 ? cleanIdOrCode.toUpperCase() : generateCode());
        room = createRoom(persistentId, code, cleanIdOrCode, isServer, serverNameHint);
      }

      // Leave previous room if any
      const prevRoomId = socket.data.roomId;
      if (prevRoomId && prevRoomId !== room.id) {
        const prevRoom = rooms.get(prevRoomId);
        if (prevRoom) {
          handleLeaveVoice(socket, io, user, prevRoom);
          prevRoom.users.delete(socket.id);
          if (prevRoom.users.size === 0 && !prevRoom.isServer) {
            destroyRoom(prevRoom.id);
          } else {
            handleAdminReassignment(socket.id, io, prevRoom);
            broadcastUserList(io, prevRoom);
          }
        }
        socket.leave(prevRoomId);
      }

      socket.data.roomId = room.id;
      if (persistentId) {
        socket.data.persistentId = persistentId;
      }
      
      socket.join(room.id);
      
      if (persistentId && room.adminPersistentIds.includes(persistentId)) {
        if (!room.adminIds.includes(socket.id)) {
          room.adminIds.push(socket.id);
        }
      } else if (!room.isServer && room.adminIds.length === 0) {
        // Apenas salas temporárias atribuem admin ao primeiro participante
        room.adminIds.push(socket.id);
        if (persistentId && !room.adminPersistentIds.includes(persistentId)) {
          room.adminPersistentIds.push(persistentId);
        }
      }
      
      user = room.users.get(socket.id) ?? { 
        id: socket.id, 
        persistentId, 
        name: user.name || '', 
        inVoice: false, 
        screenSharing: false, 
        micMuted: false, 
        callMuted: false 
      };
      room.users.set(socket.id, user);

      socket.emit('room_joined', toRoomInfo(room));
      broadcastUserList(io, room);
      console.log(`[Room] ${socket.id} (${user.name || 'anon'}) joined ${room.isServer ? 'server' : 'room'} ${room.id} (code: ${room.code})`);
    });

    // ─── SET USERNAME ──────────────────────────────────────────────
    socket.on('set_username', (name: string) => {
      const room = getCurrentRoom();
      const trimmed = name.trim().slice(0, 32) || `User_${socket.id.slice(0, 4)}`;
      user.name = trimmed;

      if (room) {
        broadcastUserList(io, room);
        socket.to(room.id).emit('toast_notification', `${trimmed} entrou`, 'success');
      }
    });

    // ─── CREATE CHANNEL ────────────────────────────────────────────
    socket.on('create_channel', (channelName: string) => {
      const room = getCurrentRoom();
      if (!room) return;

      // Only admins can create channels
      if (!room.adminIds.includes(socket.id)) {
        socket.emit('toast_notification', 'Apenas administradores podem criar canais.', 'error');
        return;
      }

      const clean = channelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '').slice(0, 32);
      if (!clean) return;

      const newChannel: ServerChannel = {
        id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: clean,
        serverId: room.id,
      };

      if (!room.channels) room.channels = [];
      room.channels.push(newChannel);

      io.to(room.id).emit('channel_created', newChannel);
      io.to(room.id).emit('toast_notification', `Canal #${clean} criado!`, 'info');
    });

    // ─── EDIT CHANNEL (Dono e Sub Dono) ────────────────────────────
    socket.on('edit_channel', (channelId: string, newName: string) => {
      const room = getCurrentRoom();
      if (!room || !room.isServer) return;

      const isOwner = room.adminIds.includes(socket.id);
      const isSubOwner = room.subOwnerIds?.includes(socket.id);

      if (!isOwner && !isSubOwner) {
        socket.emit('toast_notification', 'Apenas o dono e sub donos podem editar canais.', 'error');
        return;
      }

      if (channelId === 'ch-geral') {
        socket.emit('toast_notification', 'O canal #Geral não pode ser renomeado.', 'error');
        return;
      }

      const clean = newName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '').slice(0, 32);
      if (!clean) return;

      const channel = room.channels.find(c => c.id === channelId);
      if (channel) {
        channel.name = clean;
        io.to(room.id).emit('channel_updated', channel);
        io.to(room.id).emit('toast_notification', `Canal renomeado para #${clean}!`, 'info');
        io.to(room.id).emit('room_info', toRoomInfo(room));
      }
    });

    // ─── UPDATE SERVER (Nome e Logo) ───────────────────────────────
    socket.on('update_server', (serverId: string, newName?: string, newIconUrl?: string) => {
      const room = rooms.get(serverId) || getCurrentRoom();
      if (!room || !room.isServer) return;

      if (!room.adminIds.includes(socket.id)) {
        socket.emit('toast_notification', 'Apenas administradores podem alterar as configurações do servidor.', 'error');
        return;
      }

      if (newName) {
        room.name = newName.trim().slice(0, 40);
      }
      if (newIconUrl !== undefined) {
        room.iconUrl = newIconUrl;
      }

      io.to(room.id).emit('server_updated', {
        serverId: room.id,
        name: room.name,
        iconUrl: room.iconUrl,
      });

      console.log(`[Server] Server ${room.id} updated -> name: ${room.name}, icon: ${room.iconUrl}`);
    });

    // ─── DELETE CHANNEL (Apenas Dono) ──────────────────────────────
    socket.on('delete_channel', (channelId: string) => {
      const room = getCurrentRoom();
      if (!room || !room.isServer) return;

      if (!room.adminIds.includes(socket.id)) {
        socket.emit('toast_notification', 'Apenas o dono pode excluir canais.', 'error');
        return;
      }

      if (channelId === 'ch-geral') {
        socket.emit('toast_notification', 'O canal #Geral não pode ser excluído.', 'error');
        return;
      }

      if (room.channels) {
        room.channels = room.channels.filter(c => c.id !== channelId && c.name !== 'Geral');
      }

      io.to(room.id).emit('channel_deleted', channelId);
      io.to(room.id).emit('toast_notification', 'Canal excluído com sucesso.', 'info');
      io.to(room.id).emit('room_info', toRoomInfo(room));
    });

    // ─── SET USER ROLE (Promover / Rebaixar) ────────────────────────
    socket.on('set_user_role', (targetId: string, role: 'owner' | 'sub_owner' | 'member') => {
      const room = getCurrentRoom();
      if (!room || !room.isServer) return;

      if (!room.adminIds.includes(socket.id)) {
        socket.emit('toast_notification', 'Apenas o dono pode gerenciar cargos.', 'error');
        return;
      }

      const targetUser = room.users.get(targetId);
      if (targetUser) {
        targetUser.role = role;
        if (role === 'sub_owner') {
          if (!room.subOwnerIds) room.subOwnerIds = [];
          if (!room.subOwnerIds.includes(targetId)) room.subOwnerIds.push(targetId);
          if (!room.adminIds.includes(targetId)) room.adminIds.push(targetId);
        } else if (role === 'owner') {
          if (!room.adminIds.includes(targetId)) room.adminIds.push(targetId);
        } else {
          room.subOwnerIds = (room.subOwnerIds || []).filter(id => id !== targetId);
          room.adminIds = room.adminIds.filter(id => id !== targetId);
        }

        io.to(room.id).emit('user_role_updated', { userId: targetId, role });
        io.to(targetId).emit('toast_notification', `Seu cargo foi alterado para ${role === 'sub_owner' ? 'Sub Dono' : role === 'owner' ? 'Dono' : 'Membro'}`, 'info');
        broadcastUserList(io, room);
        io.to(room.id).emit('room_info', toRoomInfo(room));
      }
    });

    // ─── ESPECTADORES DA TRANSMISSÃO ────────────────────────────────
    socket.on('start_watching_screen', (broadcasterId: string) => {
      let viewers = screenViewersMap.get(broadcasterId);
      if (!viewers) {
        viewers = new Map<string, string>();
        screenViewersMap.set(broadcasterId, viewers);
      }
      viewers.set(socket.id, user.name || 'Espectador');

      // Notifica quem está transmitindo com o novo espectador (para tocar o chime)
      io.to(broadcasterId).emit('screen_viewer_joined', { id: socket.id, name: user.name || 'Espectador' });

      // Atualiza a contagem e lista de espectadores
      const viewerList = Array.from(viewers.entries()).map(([id, name]) => ({ id, name }));
      io.to(broadcasterId).emit('screen_viewers_updated', { broadcasterId, viewers: viewerList });
    });

    socket.on('stop_watching_screen', (broadcasterId: string) => {
      const viewers = screenViewersMap.get(broadcasterId);
      if (viewers) {
        viewers.delete(socket.id);
        const viewerList = Array.from(viewers.entries()).map(([id, name]) => ({ id, name }));
        io.to(broadcasterId).emit('screen_viewers_updated', { broadcasterId, viewers: viewerList });
      }
    });

    // ─── CHAT MESSAGE ──────────────────────────────────────────────
    socket.on('send_message', (message: string, type?, url?, filename?, channelId?) => {
      if (!user.name) return;
      const room = getCurrentRoom();
      if (!room) return;

      const safe = message.trim().slice(0, 2000);
      const timestamp = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo'
      });
      io.to(room.id).emit('receive_message', user.name, safe, timestamp, type, url, filename, channelId);
    });

    // ─── REQUEST MUSIC ─────────────────────────────────────────────
    socket.on('request_music', async (url: string) => {
      const room = getCurrentRoom();
      if (!room) return;

      const videoId = extractVideoId(url);
      if (!videoId) {
        socket.emit('toast_notification', 'URL do YouTube inválida', 'error');
        return;
      }

      let title = videoId;
      try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await res.json();
        if (data.title) title = data.title;
      } catch {
        // Fallback to videoId
      }

      const token = Date.now();
      const item: MusicItem = { videoId, token, requestedBy: user.name, title };
      room.musicQueue.push(item);
      broadcastQueueUpdate(io, room);

      if (room.currentMusicToken === null) {
        playNextInQueue(io, room);
      }
    });

    // ─── MUSIC ENDED ───────────────────────────────────────────────
    socket.on('music_ended', (token: number) => {
      const room = getCurrentRoom();
      if (!room || token !== room.currentMusicToken) return;
      room.currentMusicToken = null;
      playNextInQueue(io, room);
    });

    // ─── MUSIC ACTION ──────────────────────────────────────────────
    socket.on('music_action', (action) => {
      const room = getCurrentRoom();
      if (!room) return;

      if (action === 'skip') {
        room.currentMusicToken = null;
        room.currentMusicVideoId = null;
        room.currentMusicStartTime = null;
        playNextInQueue(io, room);
        io.to(room.id).emit('toast_notification', `${user.name} pulou a música`, 'info');
      } else if (action === 'pause') {
        io.to(room.id).emit('music_pause');
      } else if (action === 'play') {
        io.to(room.id).emit('music_resume');
      } else if (action === 'clear') {
        room.musicQueue = [];
        room.currentMusicToken = null;
        room.currentMusicVideoId = null;
        room.currentMusicStartTime = null;
        io.to(room.id).emit('stop_youtube', 0);
        broadcastQueueUpdate(io, room);
        io.to(room.id).emit('toast_notification', `${user.name} limpou a fila de música`, 'info');
      }
    });

    // ─── REMOVE FROM QUEUE ─────────────────────────────────────────
    socket.on('remove_from_queue', (token: number) => {
      const room = getCurrentRoom();
      if (!room) return;
      room.musicQueue = room.musicQueue.filter(item => item.token !== token);
      broadcastQueueUpdate(io, room);
    });

    // ─── REORDER QUEUE ─────────────────────────────────────────────
    socket.on('reorder_queue', (oldIndex: number, newIndex: number) => {
      const room = getCurrentRoom();
      if (!room) return;
      if (oldIndex < 0 || oldIndex >= room.musicQueue.length || newIndex < 0 || newIndex >= room.musicQueue.length) return;
      const [item] = room.musicQueue.splice(oldIndex, 1);
      room.musicQueue.splice(newIndex, 0, item);
      broadcastQueueUpdate(io, room);
    });

    // ─── JOIN VOICE ────────────────────────────────────────────────
    socket.on('join_voice', () => {
      const room = getCurrentRoom();
      if (!room) return;

      user.inVoice = true;
      room.voiceUsers.add(socket.id);

      const existingInVoice = Array.from(room.voiceUsers).filter(id => id !== socket.id);
      socket.emit('existing_voice_users', existingInVoice);
      socket.to(room.id).emit('user_joined_voice', socket.id);
      broadcastUserList(io, room);

      if (room.currentMusicVideoId && room.currentMusicStartTime !== null && room.currentMusicToken !== null) {
        const elapsed = Math.floor((Date.now() - room.currentMusicStartTime) / 1000);
        socket.emit('play_youtube', room.currentMusicVideoId, elapsed, room.currentMusicToken);
      }
    });

    // ─── LEAVE VOICE ───────────────────────────────────────────────
    socket.on('leave_voice', () => {
      const room = getCurrentRoom();
      if (!room) return;
      handleLeaveVoice(socket, io, user, room);
    });

    // ─── WEBRTC SIGNALING ──────────────────────────────────────────
    socket.on('send_offer', (targetId: string, offer: RTCSessionDescriptionInit) => {
      io.to(targetId).emit('receive_offer', socket.id, offer);
    });

    socket.on('send_answer', (targetId: string, answer: RTCSessionDescriptionInit) => {
      io.to(targetId).emit('receive_answer', socket.id, answer);
    });

    socket.on('send_ice', (targetId: string, candidate: RTCIceCandidateInit) => {
      io.to(targetId).emit('receive_ice', socket.id, candidate);
    });

    // ─── SCREEN SHARE ──────────────────────────────────────────────
    socket.on('start_screen_share', () => {
      const room = getCurrentRoom();
      if (!room) return;
      user.screenSharing = true;
      room.screenSharingUsers.add(socket.id);
      socket.to(room.id).emit('user_started_screen_share', socket.id, user.name);
      broadcastUserList(io, room);
    });

    socket.on('stop_screen_share', () => {
      const room = getCurrentRoom();
      if (!room) return;
      user.screenSharing = false;
      room.screenSharingUsers.delete(socket.id);
      socket.to(room.id).emit('user_stopped_screen_share', socket.id);
      broadcastUserList(io, room);
    });

    // ─── MEDIA STATE ───────────────────────────────────────────────
    socket.on('update_media_state', (micMuted: boolean, callMuted: boolean) => {
      const room = getCurrentRoom();
      if (!room) return;
      user.micMuted = micMuted;
      user.callMuted = callMuted;
      broadcastUserList(io, room);
    });

    // ─── ADMIN ACTIONS ─────────────────────────────────────────────
    socket.on('admin_mute_user', (targetId: string) => {
      const room = getCurrentRoom();
      if (!room || !room.adminIds.includes(socket.id)) return;
      io.to(targetId).emit('server_muted');
    });

    socket.on('admin_unmute_user', (targetId: string) => {
      const room = getCurrentRoom();
      if (!room || !room.adminIds.includes(socket.id)) return;
      io.to(targetId).emit('server_unmuted');
    });

    socket.on('admin_kick_voice', (targetId: string) => {
      const room = getCurrentRoom();
      if (!room || !room.adminIds.includes(socket.id)) return;
      io.to(targetId).emit('kicked_from_voice');
    });

    socket.on('admin_kick_room', (targetId: string) => {
      const room = getCurrentRoom();
      if (!room || !room.adminIds.includes(socket.id)) return;
      io.to(targetId).emit('kicked_from_room');
    });

    socket.on('admin_transfer_role', (targetId: string) => {
      const room = getCurrentRoom();
      if (!room || !room.adminIds.includes(socket.id)) return;
      if (!room.adminIds.includes(targetId)) {
        room.adminIds.push(targetId);
        const targetUser = room.users.get(targetId);
        if (targetUser?.persistentId && !room.adminPersistentIds.includes(targetUser.persistentId)) {
          room.adminPersistentIds.push(targetUser.persistentId);
        }
        io.to(targetId).emit('toast_notification', 'Você recebeu permissões de Administrador!', 'info');
        io.to(room.id).emit('room_info', toRoomInfo(room));
      }
    });

    // ─── DISCONNECT ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);
      const room = getCurrentRoom();
      if (!room) return;

      handleLeaveVoice(socket, io, user, room);
      room.users.delete(socket.id);

      // Limpar visualizações de tela deste socket
      screenViewersMap.delete(socket.id);
      for (const [broadcasterId, viewers] of screenViewersMap) {
        if (viewers.delete(socket.id)) {
          const viewerList = Array.from(viewers.entries()).map(([id, name]) => ({ id, name }));
          io.to(broadcasterId).emit('screen_viewers_updated', { broadcasterId, viewers: viewerList });
        }
      }

      if (room.users.size === 0 && !room.isServer) {
        destroyRoom(room.id);
      } else {
        handleAdminReassignment(socket.id, io, room);
        broadcastUserList(io, room);
      }
    });
  });
}

function handleLeaveVoice(
  socket: IoSocket,
  io: IoServer,
  user: UserInfo,
  room: RoomState
) {
  if (!user.inVoice) return;
  user.inVoice = false;
  room.voiceUsers.delete(socket.id);

  if (user.screenSharing) {
    user.screenSharing = false;
    room.screenSharingUsers.delete(socket.id);
    socket.to(room.id).emit('user_stopped_screen_share', socket.id);
  }

  socket.to(room.id).emit('user_left_voice', socket.id);
  broadcastUserList(io, room);

  if (room.voiceUsers.size === 0) {
    if (room.currentMusicToken !== null) {
      io.to(room.id).emit('stop_youtube', room.currentMusicToken);
      room.currentMusicToken = null;
      room.currentMusicVideoId = null;
      room.currentMusicStartTime = null;
    }
  }
}
