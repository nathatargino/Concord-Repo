export interface CustomRole {
  name: string;
  emoji: string;
  color?: string;
  isAdmin?: boolean;
}

export interface UserInfo {
  id: string;
  persistentId?: string;
  name: string;
  avatarUrl?: string | null;
  inVoice: boolean;
  screenSharing: boolean;
  micMuted: boolean;
  callMuted: boolean;
  role?: 'owner' | 'sub_owner' | 'member';
  customRole?: CustomRole | null;
}

export interface ServerChannel {
  id: string;
  name: string;
  serverId?: string;
}

export interface ServerMember {
  id: string;
  userId?: string;
  user_id?: string;
  username: string;
  avatarUrl?: string | null;
  isOnline: boolean;
  inVoice: boolean;
  role?: 'owner' | 'sub_owner' | 'member' | string;
  customRole?: CustomRole | null;
}

export interface MusicItem {
  videoId: string;
  token: number;
  requestedBy?: string;
  title?: string;
}

export interface WatchSession {
  roomId: string;
  platform: 'netflix' | 'prime';
  titleUrl: string;
  positionSeconds: number;
  isPlaying: boolean;
  lastUpdated: number;
  startedBy: string;
  startedByName?: string;
}

export interface ChatMessage {
  id: string;
  roomId?: string;
  userName: string;
  message: string;
  timestamp: string;
  isSystem?: boolean;
  type?: 'text' | 'image' | 'giphy' | 'file' | 'system';
  url?: string;
  filename?: string;
  channelId?: string;
  avatarUrl?: string | null;
  userId?: string;
  customRole?: CustomRole | null;
  sentAt?: number;
  replyTo?: {
    id?: string;
    userName: string;
    message: string;
    type?: string;
  };
  reactions?: Record<string, string[]>;
}

export interface RoomInfo {
  id: string;
  code: string;
  name?: string;
  iconUrl?: string;
  isServer?: boolean;
  channels?: ServerChannel[];
  createdAt: number;
  expiresAt: number;
  userCount: number;
  adminIds: string[];
  ownerId?: string;
  subOwnerIds?: string[];
}
