import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  InterServerEvents,
  MusicItem,
  RoomInfo,
  ServerToClientEvents,
  SocketData,
  UserInfo,
} from './types';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// ─── ROOM MANAGER ──────────────────────────────────────────────────────────────

const ROOM_DURATION_MS = 14 * 60 * 60 * 1000; // 14 hours
const ROOM_CODE_LENGTH = 6;

interface RoomState {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  adminIds: string[];
  adminPersistentIds: string[];
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

function createRoom(persistentId?: string, customCode?: string, customId?: string): RoomState {
  const id = customId || generateId();
  let code = customCode ? customCode.toUpperCase() : generateCode();
  // Ensure code uniqueness if auto-generated
  if (!customCode) {
    while (codeToRoomId.has(code)) {
      code = generateCode();
    }
  }
  const now = Date.now();
  const room: RoomState = {
    id,
    code,
    createdAt: now,
    expiresAt: now + ROOM_DURATION_MS,
    adminIds: [],
    adminPersistentIds: persistentId ? [persistentId] : [],
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
  console.log(`[Room] Created room ${id} (code: ${code})`);
  return room;
}

function getRoom(idOrCode: string): RoomState | null {
  // Try direct ID first
  if (rooms.has(idOrCode)) {
    const room = rooms.get(idOrCode)!;
    if (Date.now() > room.expiresAt) {
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
    if (Date.now() > room.expiresAt) {
      destroyRoom(room.id);
      return null;
    }
    return room;
  }
  return null;
}

function destroyRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  codeToRoomId.delete(room.code);
  rooms.delete(roomId);
  console.log(`[Room] Destroyed room ${roomId}`);
}

// Clean up expired rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now > room.expiresAt) {
      destroyRoom(id);
    }
  }
}, 5 * 60 * 1000);

function toRoomInfo(room: RoomState): RoomInfo {
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    userCount: room.users.size,
    adminIds: room.adminIds,
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

    // ─── CREATE ROOM ───────────────────────────────────────────────
    socket.on('create_room', () => {
      const room = createRoom();
      room.adminIds = [socket.id];
      socket.data.roomId = room.id;
      socket.join(room.id);
      user = { id: socket.id, name: '', inVoice: false, screenSharing: false, micMuted: false, callMuted: false };
      room.users.set(socket.id, user);
      socket.emit('room_joined', toRoomInfo(room));
      console.log(`[Room] ${socket.id} created and joined ${room.id}`);
    });

    // ─── JOIN ROOM ─────────────────────────────────────────────────
    socket.on('join_room', (roomIdOrCode: string, persistentId?: string) => {
      const room = getRoom(roomIdOrCode.trim());
      if (!room) {
        socket.emit('room_error', 'Sala não encontrada ou expirada. Verifique o código e tente novamente.');
        return;
      }

      // Leave previous room if any
      const prevRoomId = socket.data.roomId;
      if (prevRoomId && prevRoomId !== room.id) {
        const prevRoom = rooms.get(prevRoomId);
        if (prevRoom) {
          handleLeaveVoice(socket, io, user, prevRoom);
          prevRoom.users.delete(socket.id);
          if (prevRoom.users.size === 0) {
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
      } else if (room.adminIds.length === 0) {
        room.adminIds.push(socket.id);
        if (persistentId && !room.adminPersistentIds.includes(persistentId)) {
          room.adminPersistentIds.push(persistentId);
        }
      }
      
      user = room.users.get(socket.id) ?? { id: socket.id, persistentId, name: '', inVoice: false, screenSharing: false, micMuted: false, callMuted: false };
      room.users.set(socket.id, user);

      socket.emit('room_joined', toRoomInfo(room));
      console.log(`[Room] ${socket.id} joined ${room.id}`);
    });

    // ─── SET USERNAME ──────────────────────────────────────────────
    socket.on('set_username', (name: string) => {
      const room = getCurrentRoom();
      const trimmed = name.trim().slice(0, 32) || `User_${socket.id.slice(0, 4)}`;
      user.name = trimmed;

      if (room) {
        broadcastUserList(io, room);
        socket.to(room.id).emit('toast_notification', `${trimmed} entrou na sala`, 'success');
      }
    });

    // ─── CHAT MESSAGE ──────────────────────────────────────────────
    socket.on('send_message', (message: string, type?, url?, filename?) => {
      if (!user.name) return;
      const room = getCurrentRoom();
      if (!room) return;

      const safe = message.trim().slice(0, 2000);
      const timestamp = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo'
      });
      io.to(room.id).emit('receive_message', user.name, safe, timestamp, type, url, filename);
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
        io.to(room.id).emit('toast_notification', `${user.name} pausou a música`, 'info');
      } else if (action === 'play') {
        io.to(room.id).emit('music_resume');
        io.to(room.id).emit('toast_notification', `${user.name} retomou a música`, 'info');
      } else if (action === 'clear') {
        room.musicQueue.length = 0;
        if (room.currentMusicToken !== null) {
          io.to(room.id).emit('stop_youtube', room.currentMusicToken);
          room.currentMusicToken = null;
          room.currentMusicVideoId = null;
          room.currentMusicStartTime = null;
        }
        broadcastQueueUpdate(io, room);
        io.to(room.id).emit('toast_notification', `${user.name} limpou a playlist`, 'info');
      }
    });

    socket.on('remove_from_queue', (token: number) => {
      const room = getCurrentRoom();
      if (!room) return;
      const idx = room.musicQueue.findIndex((q) => q.token === token);
      if (idx !== -1) {
        room.musicQueue.splice(idx, 1);
        broadcastQueueUpdate(io, room);
        io.to(room.id).emit('toast_notification', `${user.name} removeu uma música da fila`, 'info');
      }
    });

    socket.on('reorder_queue', (oldIndex: number, newIndex: number) => {
      const room = getCurrentRoom();
      if (!room) return;
      const q = room.musicQueue;
      if (oldIndex >= 0 && oldIndex < q.length && newIndex >= 0 && newIndex < q.length && oldIndex !== newIndex) {
        const [item] = q.splice(oldIndex, 1);
        q.splice(newIndex, 0, item);
        broadcastQueueUpdate(io, room);
      }
    });

    // ─── JOIN VOICE ────────────────────────────────────────────────
    socket.on('join_voice', () => {
      const room = getCurrentRoom();
      if (!room) return;
      if (room.voiceUsers.has(socket.id)) return;

      const existing = Array.from(room.voiceUsers);
      socket.emit('existing_voice_users', existing);
      socket.to(room.id).emit('user_joined_voice', socket.id);

      room.voiceUsers.add(socket.id);
      user.inVoice = true;
      broadcastUserList(io, room);

      if (room.currentMusicToken && room.currentMusicVideoId && room.currentMusicStartTime) {
        const elapsedSeconds = (Date.now() - room.currentMusicStartTime) / 1000;
        socket.emit('play_youtube', room.currentMusicVideoId, elapsedSeconds, room.currentMusicToken);
      }
    });

    // ─── LEAVE VOICE ───────────────────────────────────────────────
    socket.on('leave_voice', () => {
      const room = getCurrentRoom();
      if (!room) return;
      handleLeaveVoice(socket, io, user, room);
    });

    // ─── WEBRTC SIGNALING ──────────────────────────────────────────
    socket.on('send_offer', (targetId, offer) => {
      io.to(targetId).emit('receive_offer', socket.id, offer);
    });

    socket.on('send_answer', (targetId, answer) => {
      io.to(targetId).emit('receive_answer', socket.id, answer);
    });

    socket.on('send_ice', (targetId, candidate) => {
      io.to(targetId).emit('receive_ice', socket.id, candidate);
    });

    // ─── SCREEN SHARE ──────────────────────────────────────────────
    socket.on('start_screen_share', () => {
      const room = getCurrentRoom();
      if (!room) return;
      room.screenSharingUsers.add(socket.id);
      user.screenSharing = true;
      io.to(room.id).emit('user_started_screen_share', socket.id, user.name);
      broadcastUserList(io, room);
    });

    socket.on('stop_screen_share', () => {
      const room = getCurrentRoom();
      if (!room) return;
      room.screenSharingUsers.delete(socket.id);
      user.screenSharing = false;
      io.to(room.id).emit('user_stopped_screen_share', socket.id);
      broadcastUserList(io, room);
    });

    // ─── ADMIN & MEDIA EVENTS ──────────────────────────────────────
    socket.on('update_media_state', (micMuted, callMuted) => {
      const room = getCurrentRoom();
      if (!room) return;
      user.micMuted = micMuted;
      user.callMuted = callMuted;
      broadcastUserList(io, room);
    });

    socket.on('admin_mute_user', (targetId) => {
      const room = getCurrentRoom();
      if (room && room.adminIds.includes(socket.id)) {
        io.to(targetId).emit('server_muted');
        io.to(room.id).emit('toast_notification', `O admin mutou um usuário`, 'info');
      }
    });

    socket.on('admin_unmute_user', (targetId) => {
      const room = getCurrentRoom();
      if (room && room.adminIds.includes(socket.id)) {
        io.to(targetId).emit('server_unmuted');
        io.to(room.id).emit('toast_notification', `O admin desmutou um usuário`, 'info');
      }
    });

    socket.on('admin_kick_voice', (targetId) => {
      const room = getCurrentRoom();
      if (room && room.adminIds.includes(socket.id)) {
        io.to(targetId).emit('kicked_from_voice');
        io.to(room.id).emit('toast_notification', `O admin desconectou um usuário da voz`, 'info');
      }
    });

    socket.on('admin_kick_room', (targetId) => {
      const room = getCurrentRoom();
      if (room && room.adminIds.includes(socket.id)) {
        // Se foi expulso, perde o direito de admin persistente
        const targetUser = room.users.get(targetId);
        if (targetUser && targetUser.persistentId) {
          room.adminPersistentIds = room.adminPersistentIds.filter(id => id !== targetUser.persistentId);
        }
        io.to(targetId).emit('kicked_from_room');
        io.to(room.id).emit('toast_notification', `Um usuário foi expulso da sala`, 'info');
      }
    });

    socket.on('admin_transfer_role', (targetId) => {
      const room = getCurrentRoom();
      if (room && room.adminIds.includes(socket.id)) {
        if (room.users.has(targetId) && !room.adminIds.includes(targetId)) {
          room.adminIds.push(targetId);
          const targetUser = room.users.get(targetId);
          if (targetUser && targetUser.persistentId && !room.adminPersistentIds.includes(targetUser.persistentId)) {
            room.adminPersistentIds.push(targetUser.persistentId);
          }
          io.to(room.id).emit('room_info', toRoomInfo(room));
          io.to(targetId).emit('toast_notification', 'Você recebeu o cargo de Administrador', 'success');
        }
      }
    });

    // ─── DISCONNECT ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);

      const room = getCurrentRoom();
      if (room) {
        if (room.voiceUsers.has(socket.id)) {
          handleLeaveVoice(socket, io, user, room);
        }
        if (room.screenSharingUsers.has(socket.id)) {
          room.screenSharingUsers.delete(socket.id);
          io.to(room.id).emit('user_stopped_screen_share', socket.id);
        }
        const name = user.name || 'Usuário';
        room.users.delete(socket.id);
        
        if (room.users.size === 0) {
          destroyRoom(room.id);
        } else {
          handleAdminReassignment(socket.id, io, room);
          broadcastUserList(io, room);
          if (name) {
            io.to(room.id).emit('toast_notification', `${name} saiu da sala`, 'info');
          }
        }
      }
    });
  });
}

function handleLeaveVoice(socket: IoSocket, io: IoServer, user: UserInfo, room: RoomState) {
  room.voiceUsers.delete(socket.id);
  user.inVoice = false;
  io.to(room.id).emit('user_left_voice', socket.id);
  broadcastUserList(io, room);
}

// ─── EXPORT for REST ───────────────────────────────────────────────────────────
export { rooms, codeToRoomId, getRoom, createRoom, toRoomInfo };
