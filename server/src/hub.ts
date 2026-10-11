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
  WatchSession,
} from './types';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// ─── ROOM MANAGER ──────────────────────────────────────────────────────────────

const ROOM_DURATION_MS = 14 * 60 * 60 * 1000; // 14 hours
const ROOM_CODE_LENGTH = 6;

export interface StoredMessage {
  userName: string;
  message: string;
  timestamp: string;
  type?: string;
  url?: string;
  filename?: string;
  channelId?: string;
  avatarUrl?: string | null;
  sentAt?: number;
}

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
  watchSession: WatchSession | null;
  messageHistory: StoredMessage[];
  knownMembers?: Map<string, any>;
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
    name: serverName || (isServer ? 'Servidor Concord' : `Sala ${code}`),
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
    watchSession: null,
    messageHistory: [],
    knownMembers: new Map(),
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

export function forceDestroyServer(roomIdOrCode: string) {
  let targetRoom = rooms.get(roomIdOrCode);
  if (!targetRoom && codeToRoomId.has(roomIdOrCode.toUpperCase())) {
    const id = codeToRoomId.get(roomIdOrCode.toUpperCase());
    if (id) targetRoom = rooms.get(id);
  }
  if (!targetRoom) return;
  codeToRoomId.delete(targetRoom.code);
  rooms.delete(targetRoom.id);
  console.log(`[Room] Force destroyed empty server ${targetRoom.id} (${targetRoom.code})`);
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
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const patterns = [
    /(?:v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:live\/)([a-zA-Z0-9_-]{11})/,
    /(?:v\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function broadcastUserList(io: IoServer, room: RoomState) {
  io.to(room.id).emit('user_list', Array.from(room.users.values()));
  if (room.isServer && room.knownMembers) {
    (io.to(room.id) as any).emit('server_members', Array.from(room.knownMembers.values()));
  }
}

function handleAdminReassignment(socketId: string, io: IoServer, room: RoomState) {
  // Servidores permanentes NUNCA reatribuem cargo de Dono/Admin quando um usuário desconecta ou fica offline!
  // O dono só pode mudar se explicitamente transferido ou sair voluntariamente.
  if (room.isServer) return;

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
    io.to(room.id).emit('stop_youtube', room.currentMusicToken ?? 0);
    room.currentMusicToken = null;
    room.currentMusicVideoId = null;
    room.currentMusicStartTime = null;
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

export function registerHub(io: IoServer, supabaseClient?: any) {
  io.on('connection', (socket: IoSocket) => {
    console.log(`[+] Connected: ${socket.id}`);

    let user: UserInfo = { id: socket.id, name: '', avatarUrl: null, inVoice: false, screenSharing: false, micMuted: false, callMuted: false };

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
      user = { id: socket.id, persistentId, name: '', avatarUrl: user.avatarUrl || null, inVoice: false, screenSharing: false, micMuted: false, callMuted: false };
      room.users.set(socket.id, user);
      socket.emit('room_joined', toRoomInfo(room));
      console.log(`[Room] ${socket.id} created and joined ${room.isServer ? 'server' : 'room'} ${room.id}`);
    });

    // ─── JOIN ROOM / SERVER ────────────────────────────────────────
    socket.on('join_room', async (roomIdOrCode: string, persistentId?: string, fallbackCode?: string, isServerHint?: boolean, serverNameHint?: string, initialAvatarUrl?: string) => {
      const cleanIdOrCode = (roomIdOrCode || '').trim();
      let room = getRoom(cleanIdOrCode);
      if (!room && fallbackCode) {
        room = getRoom(fallbackCode.trim());
      }

      // Auto-restore or create room state in memory so socket is never disconnected/orphaned
      if (!room) {
        let isServer = Boolean(
          isServerHint || 
          cleanIdOrCode.toUpperCase().startsWith('SRV-') || 
          (fallbackCode && fallbackCode.toUpperCase().startsWith('SRV-'))
        );

        // ── PERSISTÊNCIA: Tentar restaurar servidor do Supabase ──────
        // Quando o processo Node reinicia, a memória é perdida mas o Supabase
        // ainda tem os dados. Buscamos pelo UUID ou pelo código antes de rejeitar.
        if (supabaseClient) {
          try {
            const candidates = [cleanIdOrCode, fallbackCode].filter(Boolean) as string[];
            let dbRoom: any = null;

            for (const candidate of candidates) {
              const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate);
              
              // Buscar sala respeitando a coluna is_server
              const { data, error } = await supabaseClient
                .from('rooms')
                .select('id, code, name, icon_url, created_by, is_server')
                .or(isUUID ? `id.eq.${candidate},code.ilike.${candidate}` : `code.ilike.${candidate}`)
                .maybeSingle();

              if (error) {
                console.warn('[Hub] Supabase fetch room error:', error.message);
              }

              if (data) {
                const isServerRoom = Boolean(data.is_server) || (Boolean(data.code) && data.code.toUpperCase().startsWith('SRV-'));
                dbRoom = { ...data, is_server: isServerRoom };
                break;
              }
            }

            if (dbRoom) {
              const isServerRoom = Boolean(dbRoom.is_server);
              isServer = isServerRoom;
              console.log(`[Room] Restaurando ${isServerRoom ? 'servidor' : 'sala temporária'} "${dbRoom.name}" (${dbRoom.id}) do Supabase`);

              // Buscar canais se for servidor
              let restoredChannels: any[] = [];
              if (isServerRoom) {
                try {
                  const { data: chData } = await supabaseClient
                    .from('server_channels')
                    .select('id, name, server_id')
                    .eq('server_id', dbRoom.id)
                    .order('created_at', { ascending: true });
                  if (chData && chData.length > 0) {
                    restoredChannels = chData.map((ch: any) => ({ id: ch.id, name: ch.name, serverId: ch.server_id }));
                  }
                } catch (chErr) {
                  console.warn('[Room] Erro ao restaurar canais:', chErr);
                }
                if (restoredChannels.length === 0) {
                  restoredChannels = [{ id: 'ch-geral', name: 'Geral', serverId: dbRoom.id }];
                }
              }

              // Buscar admins/donos se for servidor
              let restoredAdminPersistentIds: string[] = [];
              if (isServerRoom) {
                try {
                  const { data: memData } = await supabaseClient
                    .from('server_members')
                    .select('user_id')
                    .eq('server_id', dbRoom.id)
                    .in('role', ['owner', 'sub_owner']);
                  if (memData) {
                    restoredAdminPersistentIds = memData.map((m: any) => m.user_id).filter(Boolean);
                  }
                } catch (memErr) {
                  console.warn('[Room] Erro ao restaurar admins:', memErr);
                }
              }

              // Restaurar room em memória com dados do Supabase
              const now = Date.now();
              const restored: RoomState = {
                id: dbRoom.id,
                code: dbRoom.code,
                name: dbRoom.name,
                iconUrl: dbRoom.icon_url || undefined,
                isServer: isServerRoom,
                channels: restoredChannels,
                createdAt: now,
                expiresAt: isServerRoom ? Infinity : now + ROOM_DURATION_MS,
                adminIds: [],
                adminPersistentIds: restoredAdminPersistentIds,
                ownerId: dbRoom.created_by || undefined,
                subOwnerIds: [],
                users: new Map(),
                voiceUsers: new Set(),
                screenSharingUsers: new Set(),
                musicQueue: [],
                currentMusicToken: null,
                currentMusicVideoId: null,
                currentMusicStartTime: null,
                watchSession: null,
                messageHistory: [],
                knownMembers: new Map(),
              };
              rooms.set(restored.id, restored);
              codeToRoomId.set(restored.code, restored.id);
              room = restored;
            }
          } catch (sbErr) {
            console.warn('[Room] Falha ao consultar Supabase para restaurar servidor:', sbErr);
          }
        }

        // Se ainda não encontrou nem na memória nem no banco, rejeita estritamente
        if (!room) {
          socket.emit('room_error', 'Código de convite ou sala inválida ou expirada.');
          return;
        }
      }

      // Garantir que aliases (cleanIdOrCode e fallbackCode) apontem para a mesma RoomState canônica
      if (room) {
        if (cleanIdOrCode && cleanIdOrCode !== room.id && !rooms.has(cleanIdOrCode)) {
          rooms.set(cleanIdOrCode, room);
        }
        if (fallbackCode && fallbackCode.toUpperCase() !== room.code) {
          codeToRoomId.set(fallbackCode.toUpperCase(), room.id);
        }
      }

      // Consultar dados oficiais no DB do Supabase se o servidor for permanente
      if (supabaseClient && room.isServer) {
        const isRoomUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(room.id);
        const filterStr = isRoomUuid ? `code.eq.${room.code},id.eq.${room.id}` : `code.eq.${room.code}`;
        supabaseClient
          .from('rooms')
          .select('name, icon_url, created_by')
          .or(filterStr)
          .maybeSingle()
          .then(({ data: dbRoom }: any) => {
            if (dbRoom) {
              let updated = false;
              if (dbRoom.name && dbRoom.name !== room.name) {
                room.name = dbRoom.name;
                updated = true;
              }
              if (dbRoom.icon_url !== undefined && dbRoom.icon_url !== room.iconUrl) {
                room.iconUrl = dbRoom.icon_url;
                updated = true;
              }
              if (dbRoom.created_by) {
                room.ownerId = dbRoom.created_by;
              }
              if (updated) {
                io.to(room.id).emit('room_info', toRoomInfo(room));
              }
            }
          })
          .catch((err: any) => console.warn('[Hub Supabase Sync Error]:', err));
      }

      // Leave previous room if any (preserva voz caso o usuário esteja em call)
      const prevRoomId = socket.data.roomId;
      if (prevRoomId && prevRoomId !== room.id) {
        const prevRoom = rooms.get(prevRoomId);
        if (prevRoom) {
          if (!user.inVoice) {
            handleLeaveVoice(socket, io, user, prevRoom);
            prevRoom.users.delete(socket.id);
            if (prevRoom.users.size === 0 && !prevRoom.isServer) {
              destroyRoom(prevRoom.id);
            } else {
              handleAdminReassignment(socket.id, io, prevRoom);
              broadcastUserList(io, prevRoom);
            }
            socket.leave(prevRoomId);
          } else {
            socket.data.voiceRoomId = prevRoomId;
          }
        }
      }

      socket.data.roomId = room.id;
      if (persistentId) {
        socket.data.persistentId = persistentId;
      }
      
      socket.join(room.id);

      // Limpar socket antigo/fantasma da mesma máquina/dispositivo (ex: F5 ou reconexão)
      if (persistentId) {
        for (const [existingSocketId, existingUser] of room.users.entries()) {
          if (existingSocketId !== socket.id && existingUser.persistentId === persistentId) {
            console.log(`[Room] Limpando socket fantasma anterior ${existingSocketId} para o persistentId ${persistentId}`);
            room.users.delete(existingSocketId);
            room.voiceUsers.delete(existingSocketId);
            room.screenSharingUsers.delete(existingSocketId);
            room.adminIds = room.adminIds.filter(id => id !== existingSocketId);
            if (room.subOwnerIds) {
              room.subOwnerIds = room.subOwnerIds.filter(id => id !== existingSocketId);
            }
          }
        }
      }
      
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
      
      const effectiveAvatar = initialAvatarUrl || user.avatarUrl || null;
      user = room.users.get(socket.id) ?? { 
        id: socket.id, 
        persistentId, 
        name: user.name || '', 
        avatarUrl: effectiveAvatar,
        inVoice: false, 
        screenSharing: false, 
        micMuted: false, 
        callMuted: false 
      };
      if (effectiveAvatar) {
        user.avatarUrl = effectiveAvatar;
      }
      room.users.set(socket.id, user);

      if (room.isServer) {
        if (!room.knownMembers) room.knownMembers = new Map();
        if (user.name) {
          room.knownMembers.set(user.name.toLowerCase(), {
            id: user.id,
            username: user.name,
            avatarUrl: user.avatarUrl || null,
            role: user.role || 'member',
          });
        }
      }

      if (supabaseClient && room.isServer && user.name) {
        supabaseClient
          .from('server_members')
          .select('role')
          .eq('server_id', room.id)
          .ilike('username', user.name)
          .maybeSingle()
          .then(({ data: mem }: any) => {
            if (mem?.role) {
              user.role = mem.role;
              if (mem.role === 'sub_owner') {
                if (!room.subOwnerIds) room.subOwnerIds = [];
                if (!room.subOwnerIds.includes(socket.id)) room.subOwnerIds.push(socket.id);
                if (!room.adminIds.includes(socket.id)) room.adminIds.push(socket.id);
              } else if (mem.role === 'owner') {
                if (!room.adminIds.includes(socket.id)) room.adminIds.push(socket.id);
              }
              socket.emit('user_role_updated', { userId: socket.id, role: mem.role });
              io.to(room.id).emit('room_info', toRoomInfo(room));
              broadcastUserList(io, room);
            }
          })
          .catch(() => {});
      }

      socket.emit('room_joined', toRoomInfo(room));
      broadcastUserList(io, room);

      if (user.name && !user.hasAnnouncedJoin) {
        user.hasAnnouncedJoin = true;
        socket.to(room.id).emit('toast_notification', `${user.name} entrou`, 'success');
      }

      socket.emit('music_queue_update', [...room.musicQueue]);
      if (room.currentMusicVideoId && room.currentMusicStartTime !== null && room.currentMusicToken !== null) {
        const elapsed = Math.floor((Date.now() - room.currentMusicStartTime) / 1000);
        socket.emit('play_youtube', room.currentMusicVideoId, elapsed, room.currentMusicToken);
      }
      if (room.watchSession) {
        socket.emit('watch_session_sync', room.watchSession);
      }
      console.log(`[Room] ${socket.id} (${user.name || 'anon'}) joined ${room.isServer ? 'server' : 'room'} ${room.id} (code: ${room.code})`);

      // Send message history to newly joined user (servers only)
      if (room.isServer) {
        if (room.messageHistory.length > 0) {
          // Use cached in-memory history (already loaded by a previous joiner this session)
          for (const msg of room.messageHistory) {
            socket.emit('receive_message', msg.userName, msg.message, msg.timestamp, msg.type as any, msg.url, msg.filename, msg.channelId, msg.avatarUrl, true, msg.sentAt || 0, room.id);
          }
        } else if (supabaseClient) {
          // First join this session — load history from Supabase
          try {
            const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            const roomIdForQuery = isValidUUID(room.id) ? room.id : null;
            if (roomIdForQuery) {
              const { data, error } = await supabaseClient
                .from('messages')
                .select('sender_name, content, created_at, msg_type, file_url, file_name, channel_id, avatar_url')
                .eq('room_id', roomIdForQuery)
                .order('created_at', { ascending: true })
                .limit(300);

              if (!error && data && data.length > 0) {
                room.messageHistory = data.map((m: any) => ({
                  userName: m.sender_name,
                  message: m.content,
                  timestamp: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
                  type: m.msg_type || 'text',
                  url: m.file_url || undefined,
                  filename: m.file_name || undefined,
                  channelId: m.channel_id || undefined,
                  avatarUrl: m.avatar_url || null,
                  sentAt: new Date(m.created_at).getTime(),
                }));
                for (const msg of room.messageHistory) {
                  socket.emit('receive_message', msg.userName, msg.message, msg.timestamp, msg.type as any, msg.url, msg.filename, msg.channelId, msg.avatarUrl, true, msg.sentAt || 0, room.id);
                }
              }
            }
          } catch (dbErr) {
            console.warn('[Hub] Error loading message history from Supabase:', dbErr);
          }
        }
      }
    });

    // ─── SET USERNAME & AVATAR ─────────────────────────────────────
    socket.on('set_username', (name: string, avatarUrl?: string | null) => {
      const room = getCurrentRoom();
      const trimmed = name.trim().slice(0, 32) || `User_${socket.id.slice(0, 4)}`;
      const oldName = user.name;
      user.name = trimmed;
      if (avatarUrl !== undefined) {
        user.avatarUrl = avatarUrl;
      }

      if (room) {
        if (room.isServer) {
          if (!room.knownMembers) room.knownMembers = new Map();
          if (oldName && oldName.trim().toLowerCase() !== trimmed.toLowerCase()) {
            room.knownMembers.delete(oldName.trim().toLowerCase());
          }
          room.knownMembers.set(trimmed.toLowerCase(), {
            id: user.id,
            username: trimmed,
            avatarUrl: user.avatarUrl || null,
            role: user.role || 'member',
          });
        }
        broadcastUserList(io, room);

        if (!oldName && !user.hasAnnouncedJoin) {
          user.hasAnnouncedJoin = true;
          socket.to(room.id).emit('toast_notification', `${trimmed} entrou`, 'success');
        }
      }
    });

    // ─── UPDATE AVATAR ─────────────────────────────────────────────
    socket.on('update_avatar', (avatarUrl: string | null) => {
      const room = getCurrentRoom();
      user.avatarUrl = avatarUrl;

      if (room) {
        broadcastUserList(io, room);
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
    socket.on('update_server', async (serverId: string, newName?: string, newIconUrl?: string) => {
      const room = rooms.get(serverId) || getCurrentRoom();
      if (!room || !room.isServer) return;

      const user = room.users.get(socket.id);
      let isOwner = (room.adminIds.includes(socket.id) && !room.subOwnerIds?.includes(socket.id)) || (Boolean(room.ownerId) && socket.data.persistentId === room.ownerId);
      let isSubOwner = Boolean(room.subOwnerIds?.includes(socket.id) || user?.role === 'sub_owner');

      // Se ainda não confirmado em memória, verificar diretamente na tabela server_members do Supabase
      if (!isOwner && !isSubOwner && supabaseClient && user?.name) {
        try {
          const { data: member } = await supabaseClient
            .from('server_members')
            .select('role')
            .eq('server_id', room.id)
            .ilike('username', user.name)
            .maybeSingle();

          if (member?.role === 'owner') {
            isOwner = true;
            if (!room.adminIds.includes(socket.id)) room.adminIds.push(socket.id);
          } else if (member?.role === 'sub_owner') {
            isSubOwner = true;
            if (!room.subOwnerIds) room.subOwnerIds = [];
            if (!room.subOwnerIds.includes(socket.id)) room.subOwnerIds.push(socket.id);
          }
        } catch {}
      }

      if (!isOwner && !isSubOwner) {
        socket.emit('toast_notification', 'Apenas o dono e os subdonos podem alterar as configurações do servidor.', 'error');
        return;
      }

      // Apenas o Dono pode alterar o nome do servidor
      if (newName && isOwner) {
        room.name = newName.trim().slice(0, 40);
      }

      // Tanto o Dono quanto o Sub Dono têm permissão para alterar a foto do servidor
      if (newIconUrl !== undefined) {
        room.iconUrl = newIconUrl;
      }

      io.to(room.id).emit('server_updated', {
        serverId: room.id,
        name: room.name,
        iconUrl: room.iconUrl,
      });

      console.log(`[Server] Server ${room.id} updated by ${user?.name || socket.id} (${isOwner ? 'owner' : 'sub_owner'}) -> name: ${room.name}, icon: ${room.iconUrl ? '(updated)' : '(none)'}`);
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
      const alreadyWatching = viewers.has(socket.id);
      viewers.set(socket.id, user.name || 'Espectador');

      // Notifica quem está transmitindo apenas se o espectador for novo (evita chime repetido)
      if (!alreadyWatching) {
        io.to(broadcasterId).emit('screen_viewer_joined', { id: socket.id, name: user.name || 'Espectador' });
      }

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
    socket.on('send_message', async (message: string, type?, url?, filename?, channelId?, avatarUrl?) => {
      if (!user.name) return;
      const room = getCurrentRoom();
      if (!room) return;

      const safe = message.trim().slice(0, 2000);
      const timestamp = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo'
      });

      const now = Date.now();
      // Persist message in history for server rooms (up to 500 in-memory)
      if (room.isServer) {
        if (room.messageHistory.length >= 500) {
          room.messageHistory.shift();
        }
        room.messageHistory.push({ userName: user.name, message: safe, timestamp, type, url, filename, channelId, avatarUrl, sentAt: now });

        // Save to Supabase asynchronously (fire-and-forget)
        if (supabaseClient) {
          const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
          const roomIdForDb = isValidUUID(room.id) ? room.id : null;
          if (roomIdForDb) {
            supabaseClient.from('messages').insert({
              room_id: roomIdForDb,
              sender_name: user.name,
              content: safe,
              msg_type: type || 'text',
              file_url: url || null,
              file_name: filename || null,
              channel_id: channelId || null,
              avatar_url: avatarUrl || null,
            }).then(({ error }: { error: any }) => {
              if (error) console.warn('[Hub] Failed to save message to Supabase:', error.message);
            });
          }
        }
      }

      io.to(room.id).emit('receive_message', user.name, safe, timestamp, type, url, filename, channelId, avatarUrl, false, now, room.id, user.customRole || null);
    });

    // ─── MESSAGE REACTION ───────────────────────────────────────────
    socket.on('message_reaction' as any, (messageId: string, emoji: string) => {
      if (!user.name) return;
      const room = getCurrentRoom();
      if (!room) return;
      io.to(room.id).emit('message_reaction', messageId, emoji, user.name);
    });

    // ─── REQUEST MUSIC ─────────────────────────────────────────────
    socket.on('request_music', async (url: string, suggestedTitle?: string, playNow?: boolean) => {
      const room = getCurrentRoom();
      if (!room) return;

      if (!room.voiceUsers.has(socket.id)) {
        socket.emit('toast_notification', 'Você precisa estar na call de voz para colocar vídeos.', 'error');
        return;
      }

      const videoId = extractVideoId(url);
      if (!videoId) {
        socket.emit('toast_notification', 'URL do YouTube inválida', 'error');
        return;
      }

      let title = (suggestedTitle && suggestedTitle.trim()) || videoId;
      if (!suggestedTitle || !suggestedTitle.trim()) {
        try {
          const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
          const data = await res.json();
          if (data.title) title = data.title;
        } catch {
          // Fallback to videoId
        }
      }

      const token = Date.now();
      const item: MusicItem = { videoId, token, requestedBy: user.name, title };

      if (playNow || room.currentMusicToken === null || !room.currentMusicVideoId) {
        room.currentMusicToken = token;
        room.currentMusicVideoId = videoId;
        room.currentMusicStartTime = Date.now();
        io.to(room.id).emit('play_youtube', videoId, 0, token);
        broadcastQueueUpdate(io, room);
        io.to(room.id).emit('toast_notification', `${user.name} iniciou a reprodução de "${title || videoId}"`, 'info');
      } else {
        room.musicQueue.push(item);
        broadcastQueueUpdate(io, room);
        io.to(room.id).emit('toast_notification', `${user.name} adicionou "${title || videoId}" à fila`, 'info');
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
      }
    });

    // ─── MUSIC SEEK ────────────────────────────────────────────────
    socket.on('music_seek', (time: number) => {
      const room = getCurrentRoom();
      if (!room) return;
      io.to(room.id).emit('music_seek', time);
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

    // ─── WATCH PARTY (STREAMING SYNC) ──────────────────────────────
    socket.on('watch_session_start', (data) => {
      const room = getCurrentRoom();
      if (!room) return;
      if (!room.voiceUsers.has(socket.id)) {
        socket.emit('toast_notification', 'Você precisa estar na call de voz para iniciar uma Watch Party.', 'error');
        return;
      }

      const now = Date.now();
      const session: WatchSession = {
        roomId: room.id,
        platform: data.platform,
        titleUrl: data.titleUrl,
        positionSeconds: typeof data.positionSeconds === 'number' ? data.positionSeconds : 0,
        isPlaying: data.isPlaying ?? true,
        lastUpdated: now,
        startedBy: socket.id,
        startedByName: user.name,
      };

      room.watchSession = session;
      io.to(room.id).emit('watch_session_sync', session);
      const platLabel = data.platform === 'netflix' ? 'Netflix' : 'Prime Video';
      io.to(room.id).emit('toast_notification', `🎉 ${user.name} iniciou uma Watch Party de ${platLabel}!`, 'info');
    });

    socket.on('watch_session_action', (data) => {
      const room = getCurrentRoom();
      if (!room || !room.watchSession) return;
      if (!room.voiceUsers.has(socket.id)) return;

      const now = Date.now();
      if (data.action === 'play') {
        room.watchSession.isPlaying = true;
        if (typeof data.positionSeconds === 'number') {
          room.watchSession.positionSeconds = data.positionSeconds;
        }
        room.watchSession.lastUpdated = now;
      } else if (data.action === 'pause') {
        room.watchSession.isPlaying = false;
        if (typeof data.positionSeconds === 'number') {
          room.watchSession.positionSeconds = data.positionSeconds;
        }
        room.watchSession.lastUpdated = now;
      } else if (data.action === 'seek') {
        if (typeof data.positionSeconds === 'number') {
          room.watchSession.positionSeconds = data.positionSeconds;
        }
        room.watchSession.lastUpdated = now;
      }

      // Broadcast to other participants in the room
      socket.to(room.id).emit('watch_session_action', {
        action: data.action,
        positionSeconds: data.positionSeconds,
        senderId: socket.id,
        timestamp: now,
      });
    });

    socket.on('watch_session_end', () => {
      const room = getCurrentRoom();
      if (!room || !room.watchSession) return;
      room.watchSession = null;
      io.to(room.id).emit('watch_session_sync', null);
      io.to(room.id).emit('toast_notification', `${user.name} encerrou a Watch Party.`, 'info');
    });

    socket.on('watch_session_query', () => {
      const room = getCurrentRoom();
      if (!room) return;
      socket.emit('watch_session_sync', room.watchSession);
    });

    socket.on('watch_session_heartbeat', (data) => {
      const room = getCurrentRoom();
      if (!room || !room.watchSession) return;
      if (!room.voiceUsers.has(socket.id)) return;

      const now = Date.now();
      if (typeof data.positionSeconds === 'number') {
        room.watchSession.positionSeconds = data.positionSeconds;
      }
      if (typeof data.isPlaying === 'boolean') {
        room.watchSession.isPlaying = data.isPlaying;
      }
      room.watchSession.lastUpdated = now;

      // Broadcast heartbeat to other room participants for drift correction
      socket.to(room.id).emit('watch_session_heartbeat', {
        positionSeconds: room.watchSession.positionSeconds,
        isPlaying: room.watchSession.isPlaying,
        timestamp: now,
        platform: room.watchSession.platform,
      });
    });

    // ─── JOIN VOICE ────────────────────────────────────────────────
    socket.on('join_voice', () => {
      const room = getCurrentRoom();
      if (!room) return;

      // Se já estava em call em outra sala/servidor, sai da call anterior
      if (socket.data.voiceRoomId && socket.data.voiceRoomId !== room.id) {
        const prevVoiceRoom = rooms.get(socket.data.voiceRoomId);
        if (prevVoiceRoom) {
          handleLeaveVoice(socket, io, user, prevVoiceRoom);
          prevVoiceRoom.users.delete(socket.id);
          socket.leave(socket.data.voiceRoomId);
        }
      }
      socket.data.voiceRoomId = room.id;

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
      if (room.watchSession) {
        socket.emit('watch_session_sync', room.watchSession);
      }
    });

    // ─── LEAVE VOICE ───────────────────────────────────────────────
    socket.on('leave_voice', () => {
      const vId = socket.data.voiceRoomId || socket.data.roomId;
      const room = vId ? rooms.get(vId) : getCurrentRoom();
      if (!room) return;
      handleLeaveVoice(socket, io, user, room);
      socket.data.voiceRoomId = undefined;
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

    // ─── DEFINIR CARGO PERSONALIZADO (Nome + Emoji) ─────────────────
    socket.on('set_member_custom_role', (payload: {
      roomId: string;
      targetUserId: string;
      targetUsername: string;
      customRole: any;
    }) => {
      const room = rooms.get(payload.roomId) || getCurrentRoom();
      if (!room || !room.isServer) return;

      // 1. Atualizar no usuário online (se estiver conectado)
      const targetUser = room.users.get(payload.targetUserId);
      if (targetUser) {
        targetUser.customRole = payload.customRole;
        if (payload.customRole?.isAdmin && targetUser.role !== 'owner') {
          targetUser.role = 'sub_owner';
        } else if (!payload.customRole?.isAdmin && targetUser.role === 'sub_owner') {
          targetUser.role = 'member';
        }
      }

      // 2. Atualizar nos membros conhecidos do servidor (knownMembers)
      if (!room.knownMembers) room.knownMembers = new Map();
      const lowerName = (payload.targetUsername || '').trim().toLowerCase();
      let mem = room.knownMembers.get(lowerName) || room.knownMembers.get(payload.targetUserId);
      if (mem) {
        mem.customRole = payload.customRole;
        if (payload.customRole?.isAdmin && mem.role !== 'owner') {
          mem.role = 'sub_owner';
        } else if (!payload.customRole?.isAdmin && mem.role === 'sub_owner') {
          mem.role = 'member';
        }
      } else {
        mem = {
          id: payload.targetUserId,
          username: payload.targetUsername,
          customRole: payload.customRole,
          role: payload.customRole?.isAdmin ? 'sub_owner' : 'member',
        };
        room.knownMembers.set(lowerName, mem);
      }

      // 3. Atualizar no Supabase de forma assíncrona se disponível
      if (supabaseClient && room.isServer) {
        try {
          supabaseClient
            .from('server_members')
            .update({
              custom_role_name: payload.customRole?.name || null,
              custom_role_emoji: payload.customRole?.emoji || null,
              custom_role_color: payload.customRole?.color || null,
              role: payload.customRole?.isAdmin ? 'sub_owner' : 'member',
            })
            .eq('server_id', room.id)
            .ilike('username', payload.targetUsername)
            .then(() => {})
            .catch(() => {});
        } catch {}
      }

      // 4. Notificar no chat do servidor caso tenha cargo definido
      if (payload.customRole?.name) {
        const now = Date.now();
        const timeStr = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (targetUser && targetUser.id) {
          // Mensagem personalizada para o usuário que recebeu o cargo
          io.to(targetUser.id).emit(
            'receive_message',
            'Sistema',
            `Seu cargo foi alterado para ${payload.customRole.name}`,
            timeStr,
            'system',
            undefined,
            undefined,
            'ch-geral',
            null,
            false,
            now,
            room.id,
            null
          );
          // Notificação para os demais membros
          socket.to(room.id).except(targetUser.id).emit(
            'receive_message',
            'Sistema',
            `O cargo de ${payload.targetUsername} foi alterado para ${payload.customRole.name}`,
            timeStr,
            'system',
            undefined,
            undefined,
            'ch-geral',
            null,
            false,
            now,
            room.id,
            null
          );
        } else {
          io.to(room.id).emit(
            'receive_message',
            'Sistema',
            `O cargo de ${payload.targetUsername} foi alterado para ${payload.customRole.name}`,
            timeStr,
            'system',
            undefined,
            undefined,
            'ch-geral',
            null,
            false,
            now,
            room.id,
            null
          );
        }
      }

      // 5. Propagar para todos no servidor em tempo real
      io.to(room.id).emit('member_custom_role_updated', payload);
      broadcastUserList(io, room);
    });

    // ─── DESTROY EMPTY SERVER ───────────────────────────────────────
    socket.on('destroy_empty_server', (serverId: string) => {
      forceDestroyServer(serverId);
    });

    // ─── DISCONNECT ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);
      if (socket.data.voiceRoomId) {
        const vRoom = rooms.get(socket.data.voiceRoomId);
        if (vRoom) {
          handleLeaveVoice(socket, io, user, vRoom);
          vRoom.users.delete(socket.id);
        }
      }
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
    if (room.watchSession) {
      room.watchSession = null;
      io.to(room.id).emit('watch_session_sync', null);
    }
  } else if (room.watchSession && room.watchSession.startedBy === socket.id) {
    const nextVoiceUser = Array.from(room.voiceUsers)[0];
    room.watchSession.startedBy = nextVoiceUser;
    const u = room.users.get(nextVoiceUser);
    if (u) room.watchSession.startedByName = u.name;
    io.to(room.id).emit('watch_session_sync', room.watchSession);
  }
}
