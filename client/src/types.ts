export interface UserInfo {
  id: string;
  name: string;
  inVoice: boolean;
  screenSharing: boolean;
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
}

export interface RoomInfo {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  userCount: number;
}
