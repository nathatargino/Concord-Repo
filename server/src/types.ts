export interface UserInfo {
  id: string;
  name: string;
  inVoice: boolean;
  screenSharing: boolean;
  micMuted: boolean;
  callMuted: boolean;
}

export interface MusicItem {
  videoId: string;
  token: number;
  requestedBy?: string;
  title?: string;
}

export interface RoomInfo {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  userCount: number;
  adminId: string;
}

// Client → Server events
export interface ClientToServerEvents {
  set_username: (name: string) => void;
  create_room: () => void;
  join_room: (roomIdOrCode: string) => void;
  send_message: (message: string, type?: 'text' | 'image' | 'giphy' | 'file', url?: string, filename?: string) => void;
  request_music: (url: string) => void;
  music_ended: (token: number) => void;
  join_voice: () => void;
  leave_voice: () => void;
  send_offer: (targetId: string, offer: RTCSessionDescriptionInit) => void;
  send_answer: (targetId: string, answer: RTCSessionDescriptionInit) => void;
  send_ice: (targetId: string, candidate: RTCIceCandidateInit) => void;
  start_screen_share: () => void;
  stop_screen_share: () => void;
  music_action: (action: 'skip' | 'pause' | 'play' | 'clear') => void;
  remove_from_queue: (token: number) => void;
  reorder_queue: (oldIndex: number, newIndex: number) => void;
  update_media_state: (micMuted: boolean, callMuted: boolean) => void;
  admin_mute_user: (targetId: string) => void;
  admin_unmute_user: (targetId: string) => void;
  admin_kick_voice: (targetId: string) => void;
  admin_kick_room: (targetId: string) => void;
  admin_transfer_role: (targetId: string) => void;
}

// Server → Client events
export interface ServerToClientEvents {
  user_list: (users: UserInfo[]) => void;
  receive_message: (userName: string, message: string, timestamp: string, type?: 'text' | 'image' | 'giphy' | 'file', url?: string, filename?: string) => void;
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
  // Room events
  room_joined: (room: RoomInfo) => void;
  room_error: (message: string) => void;
  room_info: (room: RoomInfo) => void;
  // Admin events
  server_muted: () => void;
  server_unmuted: () => void;
  kicked_from_voice: () => void;
  kicked_from_room: () => void;
}

export interface InterServerEvents {}

export interface SocketData {
  user?: UserInfo;
  roomId?: string;
}
