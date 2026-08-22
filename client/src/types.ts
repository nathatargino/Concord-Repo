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
  type?: 'text' | 'image' | 'giphy';
  url?: string;
}
