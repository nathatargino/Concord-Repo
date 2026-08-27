export interface UserInfo {
  id: string;
  name: string;
  inVoice: boolean;
  screenSharing: boolean;
  micMuted: boolean;
  callMuted: boolean;
  role?: 'owner' | 'sub_owner' | 'member';
}

export interface ServerChannel {
  id: string;
  name: string;
  serverId?: string;
}

export interface ServerMember {
  id: string;
  username: string;
  isOnline: boolean;
  inVoice: boolean;
  role?: 'owner' | 'sub_owner' | 'member' | string;
}

export interface MusicItem {
  videoId: string;
  token: number;
  requestedBy?: string;
  title?: string;
}

export interface ChatMessage {
  id: string;
  userName: string;
  message: string;
  timestamp: string;
  isSystem?: boolean;
  type?: 'text' | 'image' | 'giphy' | 'file';
  url?: string;
  filename?: string;
  channelId?: string;
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
