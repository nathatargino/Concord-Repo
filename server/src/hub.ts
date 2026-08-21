import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  InterServerEvents,
  MusicItem,
  ServerToClientEvents,
  SocketData,
  UserInfo,
} from './types';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const users = new Map<string, UserInfo>();
const voiceUsers = new Set<string>();
const screenSharingUsers = new Set<string>();
const musicQueue: MusicItem[] = [];
let currentMusicToken: number | null = null;
let currentMusicVideoId: string | null = null;
let currentMusicStartTime: number | null = null;

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

function broadcastUserList(io: IoServer) {
  io.emit('user_list', Array.from(users.values()));
}

function broadcastQueueUpdate(io: IoServer) {
  io.emit('music_queue_update', [...musicQueue]);
}

function playNextInQueue(io: IoServer) {
  if (musicQueue.length === 0) {
    if (currentMusicToken !== null) {
      io.emit('stop_youtube', currentMusicToken);
      currentMusicToken = null;
      currentMusicVideoId = null;
      currentMusicStartTime = null;
    }
    return;
  }
  const next = musicQueue.shift()!;
  currentMusicToken = next.token;
  currentMusicVideoId = next.videoId;
  currentMusicStartTime = Date.now();
  io.emit('play_youtube', next.videoId, 0, next.token);
  broadcastQueueUpdate(io);
}

export function registerHub(io: IoServer) {
  io.on('connection', (socket: IoSocket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // Register user with placeholder name
    const user: UserInfo = {
      id: socket.id,
      name: '',
      inVoice: false,
      screenSharing: false,
    };
    users.set(socket.id, user);

    // ─── SET USERNAME ──────────────────────────────────────────────
    socket.on('set_username', (name: string) => {
      const trimmed = name.trim().slice(0, 32) || `User_${socket.id.slice(0, 4)}`;
      user.name = trimmed;
      broadcastUserList(io);

      // Notify others
      socket.broadcast.emit('toast_notification', `${trimmed} entrou no servidor`, 'success');
    });

    // ─── CHAT MESSAGE ──────────────────────────────────────────────
    socket.on('send_message', (message: string, type?: 'text' | 'image' | 'giphy', url?: string) => {
      if (!user.name) return;
      const safe = message.trim().slice(0, 2000);
      const timestamp = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      io.emit('receive_message', user.name, safe, timestamp, type, url);
    });

    // ─── REQUEST MUSIC ─────────────────────────────────────────────
    socket.on('request_music', (url: string) => {
      const videoId = extractVideoId(url);
      if (!videoId) {
        socket.emit('toast_notification', 'URL do YouTube inválida', 'error');
        return;
      }
      const token = Date.now();
      const item: MusicItem = { videoId, token, requestedBy: user.name };
      musicQueue.push(item);
      broadcastQueueUpdate(io);

      // If nothing is playing, start now
      if (currentMusicToken === null) {
        playNextInQueue(io);
      }
    });

    // ─── MUSIC ENDED ───────────────────────────────────────────────
    socket.on('music_ended', (token: number) => {
      if (token !== currentMusicToken) return; // stale
      currentMusicToken = null;
      playNextInQueue(io);
    });

    // ─── MUSIC ACTION ──────────────────────────────────────────────
    socket.on('music_action', (action: 'skip' | 'pause' | 'play' | 'clear') => {
      if (action === 'skip') {
        currentMusicToken = null;
        currentMusicVideoId = null;
        currentMusicStartTime = null;
        playNextInQueue(io);
        io.emit('toast_notification', `${user.name} pulou a música`, 'info');
      } else if (action === 'pause') {
        io.emit('music_pause');
        io.emit('toast_notification', `${user.name} pausou a música`, 'info');
      } else if (action === 'play') {
        // We could adjust start time here if we tracked pauses, but we keep it simple
        io.emit('music_resume');
        io.emit('toast_notification', `${user.name} retomou a música`, 'info');
      } else if (action === 'clear') {
        musicQueue.length = 0;
        if (currentMusicToken !== null) {
          io.emit('stop_youtube', currentMusicToken);
          currentMusicToken = null;
          currentMusicVideoId = null;
          currentMusicStartTime = null;
        }
        broadcastQueueUpdate(io);
        io.emit('toast_notification', `${user.name} limpou a playlist`, 'info');
      }
    });

    socket.on('remove_from_queue', (token: number) => {
      const idx = musicQueue.findIndex((q) => q.token === token);
      if (idx !== -1) {
        musicQueue.splice(idx, 1);
        broadcastQueueUpdate(io);
        io.emit('toast_notification', `${user.name} removeu uma música da fila`, 'info');
      }
    });

    socket.on('reorder_queue', (oldIndex: number, newIndex: number) => {
      if (oldIndex >= 0 && oldIndex < musicQueue.length && newIndex >= 0 && newIndex < musicQueue.length && oldIndex !== newIndex) {
        const [item] = musicQueue.splice(oldIndex, 1);
        musicQueue.splice(newIndex, 0, item);
        broadcastQueueUpdate(io);
      }
    });

    // ─── JOIN VOICE ────────────────────────────────────────────────
    socket.on('join_voice', () => {
      if (voiceUsers.has(socket.id)) return;

      // Tell new user about existing voice participants
      const existing = Array.from(voiceUsers);
      socket.emit('existing_voice_users', existing);

      // Tell everyone else about the new participant
      socket.broadcast.emit('user_joined_voice', socket.id);

      voiceUsers.add(socket.id);
      user.inVoice = true;
      broadcastUserList(io);

      // Sync current music if playing
      if (currentMusicToken && currentMusicVideoId && currentMusicStartTime) {
        const elapsedSeconds = (Date.now() - currentMusicStartTime) / 1000;
        socket.emit('play_youtube', currentMusicVideoId, elapsedSeconds, currentMusicToken);
      }
    });

    // ─── LEAVE VOICE ───────────────────────────────────────────────
    socket.on('leave_voice', () => {
      handleLeaveVoice(socket, io, user);
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
      screenSharingUsers.add(socket.id);
      user.screenSharing = true;
      io.emit('user_started_screen_share', socket.id, user.name);
      broadcastUserList(io);
    });

    socket.on('stop_screen_share', () => {
      screenSharingUsers.delete(socket.id);
      user.screenSharing = false;
      io.emit('user_stopped_screen_share', socket.id);
      broadcastUserList(io);
    });

    // ─── DISCONNECT ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);

      // Leave voice if was in call
      if (voiceUsers.has(socket.id)) {
        handleLeaveVoice(socket, io, user);
      }

      // Stop screen share if was sharing
      if (screenSharingUsers.has(socket.id)) {
        screenSharingUsers.delete(socket.id);
        io.emit('user_stopped_screen_share', socket.id);
      }

      const name = user.name || 'Usuário';
      users.delete(socket.id);
      broadcastUserList(io);

      if (name) {
        io.emit('toast_notification', `${name} saiu do servidor`, 'info');
      }
    });
  });
}

function handleLeaveVoice(socket: IoSocket, io: IoServer, user: UserInfo) {
  voiceUsers.delete(socket.id);
  user.inVoice = false;
  io.emit('user_left_voice', socket.id);
  broadcastUserList(io);
}
