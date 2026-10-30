import React, { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';

import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import type { ChatMessage } from '../types';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import styles from './ChatPanel.module.css';
import { 
  fetchChannelMessages, 
  saveMessageToSupabase, 
  fetchDirectMessagesFromSupabase, 
  sendDirectMessageToSupabase, 
  cleanDisplayName, 
  type DirectMessage, 
  supabase,
  isDmMuted,
  toggleMuteDm,
  deleteDmConversation,
  deleteDmMessage,
  isUuid,
} from '../lib/supabase';
import { playChimeSound } from '../hooks/useAudio';
import { CrunchyrollIcon, NetflixIcon, PrimeIcon, YouTubeIcon } from './MusicPanel';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

const IconNoVideo = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

import { SERVER_URL } from '../config';
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || 'gD2L1Yb68ZOGLLvErUw4BMuyLIdgyVzx';
const gf = new GiphyFetch(GIPHY_API_KEY);

// Cache em memória de mensagens por sala/canal para troca instantânea sem flash vazio
const channelMessageCache = new Map<string, ChatMessage[]>();

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseLinks(text: string): string {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #60A5FA; text-decoration: underline;">${url}</a>`;
  });
}

function formatMessageHtml(rawText: string, myName?: string): string {
  if (!rawText) return '';
  let escaped = escapeHtml(rawText);
  // Highlight mentions: @username or @everyone
  const mentionRegex = /@([a-zA-Z0-9_\u00C0-\u017F-]+)/g;
  escaped = escaped.replace(mentionRegex, (match, username) => {
    const isMeOrEveryone = (myName && username.toLowerCase() === myName.toLowerCase()) || username.toLowerCase() === 'everyone';
    const bg = isMeOrEveryone ? 'rgba(245, 158, 11, 0.28)' : 'rgba(99, 102, 241, 0.22)';
    const color = isMeOrEveryone ? '#f59e0b' : '#818cf8';
    return `<span class="concord-mention-tag" data-mention="${escapeHtml(username)}" style="background: ${bg}; color: ${color}; padding: 1px 6px; border-radius: 4px; font-weight: 700; cursor: pointer; display: inline-block; transition: all 0.15s ease;" title="Ver perfil de @${escapeHtml(username)}">${match}</span>`;
  });
  return parseLinks(escaped);
}

function formatTime(secs: number): string {
  if (!secs || isNaN(secs) || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}

export interface StagedAttachment {
  id: string;
  file: File;
  previewUrl: string;
  isImage: boolean;
}

const MAX_CHAT_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(filename: string, mime: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'fa-file-pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'fa-file-zipper';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext) || mime.startsWith('audio/')) return 'fa-file-audio';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext) || mime.startsWith('video/')) return 'fa-file-video';
  if (['doc', 'docx'].includes(ext)) return 'fa-file-word';
  if (['xls', 'xlsx'].includes(ext)) return 'fa-file-excel';
  if (['txt', 'md', 'json', 'js', 'ts', 'html', 'css'].includes(ext)) return 'fa-file-code';
  return 'fa-file';
}

interface UploadProgressInfo {
  percent: number;
  loaded: number;
  total: number;
}

function uploadChatAttachment(
  file: File,
  onProgress?: (info: UploadProgressInfo) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
          onProgress?.({
            percent,
            loaded: event.loaded,
            total: event.total,
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data?.url) {
              onProgress?.({ percent: 100, loaded: file.size, total: file.size });
              resolve(`${SERVER_URL}${data.url}`);
              return;
            }
          } catch {
            // Segue para fallback
          }
        }

        let errorMsg = `Erro no upload (HTTP ${xhr.status})`;
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData?.error) errorMsg = errData.error;
        } catch {}

        if (file.size <= 8 * 1024 * 1024) {
          fileToBase64(file)
            .then((b64) => {
              onProgress?.({ percent: 100, loaded: file.size, total: file.size });
              resolve(b64);
            })
            .catch(() => reject(new Error(errorMsg)));
        } else {
          reject(new Error(errorMsg));
        }
      };

      xhr.onerror = () => {
        if (file.size <= 8 * 1024 * 1024) {
          fileToBase64(file)
            .then((b64) => {
              onProgress?.({ percent: 100, loaded: file.size, total: file.size });
              resolve(b64);
            })
            .catch(() => reject(new Error(`Falha de conexão ao enviar "${file.name}".`)));
        } else {
          reject(new Error(`Falha de conexão ao enviar "${file.name}".`));
        }
      };

      xhr.open('POST', `${SERVER_URL}/api/upload`);
      xhr.send(formData);
    } catch (err: any) {
      if (file.size <= 8 * 1024 * 1024) {
        fileToBase64(file)
          .then((b64) => {
            onProgress?.({ percent: 100, loaded: file.size, total: file.size });
            resolve(b64);
          })
          .catch(() => reject(new Error(err?.message || 'Erro ao enviar arquivo.')));
      } else {
        reject(new Error(err?.message || 'Erro ao enviar arquivo.'));
      }
    }
  });
}

// ── Helpers para Emojis, Resposta e Cópia de Imagem ──
function isOnlyEmojis(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u200D|\uFE0F|\s)+$/u;
  return emojiRegex.test(trimmed);
}

interface ParsedReply {
  quotedUser: string;
  quotedText: string;
  actualText: string;
}

function parseReplyMessage(message: string): ParsedReply | null {
  if (!message || !message.startsWith('> ')) return null;
  const boldMatch = message.match(/^>\s*\*\*@([^*]+)\*\*:\s*([^\n]+)\n([\s\S]*)$/);
  if (boldMatch) {
    return {
      quotedUser: boldMatch[1].trim(),
      quotedText: boldMatch[2].trim(),
      actualText: boldMatch[3].trim(),
    };
  }
  const plainMatch = message.match(/^>\s*@([^:]+):\s*([^\n]+)\n([\s\S]*)$/);
  if (plainMatch) {
    return {
      quotedUser: plainMatch[1].trim(),
      quotedText: plainMatch[2].trim(),
      actualText: plainMatch[3].trim(),
    };
  }
  return null;
}

async function copyImageToClipboard(imageUrl: string): Promise<boolean> {
  const electron = (window as any).electron;
  if (electron?.copyImageToClipboard) {
    try {
      const res = await electron.copyImageToClipboard(imageUrl);
      if (res && res.success) return true;
    } catch (err) {
      console.warn('Electron copyImage failed, falling back to Web API', err);
    }
  }

  try {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    let pngBlob = blob;
    if (blob.type !== 'image/png') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      pngBlob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || blob), 'image/png'));
    }
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlob })
    ]);
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}

interface ChatPanelProps {
  onSendMessage?: (msg: string, type?: 'text' | 'image' | 'giphy' | 'file', url?: string, filename?: string, channelId?: string, avatarUrl?: string | null) => void;
  onReaction?: (messageId: string, emoji: string) => void;
  onMusicAction?: (action: 'skip' | 'pause' | 'play' | 'clear') => void;
  onMusicSeek?: (time: number) => void;
  getYtCurrentTime?: () => number;
  getYtDuration?: () => number;
  onSetCC?: (enabled: boolean) => void;
  onSetQuality?: (quality: string) => void;
  getYtAvailableQualities?: () => string[];
  getYtQuality?: () => string;
  onWatchSessionStart?: (data: { platform: 'netflix' | 'prime' | 'crunchyroll'; titleUrl: string; positionSeconds?: number; isPlaying?: boolean }) => void;
  onWatchSessionAction?: (data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number }) => void;
  onWatchSessionHeartbeat?: (data: { platform: 'netflix' | 'prime' | 'crunchyroll'; positionSeconds: number; isPlaying: boolean; url: string }) => void;
  onWatchSessionEnd?: () => void;
}

export function ChatPanel({
  onSendMessage,
  onReaction,
  onMusicAction,
  onMusicSeek,
  getYtCurrentTime,
  getYtDuration,
  onSetCC,
  onSetQuality,
  getYtAvailableQualities,
  getYtQuality,
  onWatchSessionStart,
  onWatchSessionAction,
  onWatchSessionHeartbeat,
  onWatchSessionEnd: _onWatchSessionEnd,
}: ChatPanelProps) {
  const {
    messages,
    setMessages,
    addMessage,
    myId,
    myName,
    myAvatarUrl,
    room,
    isServer,
    channels,
    activeChannelId,
    currentVideoId,
    currentTrackTitle,
    currentRequestedBy,
    isPiPActive,
    isPlaying,
    musicStartTime,
    setVisualizerActive,
    activeStreaming,
    setActiveStreaming,
    activeMediaTab,
    setActiveMediaTab,
    streamingSessions,
    setStreamingSession,
    ytAvailableQualities,
    showVideoPlayer,
    setShowVideoPlayer,
    setIsYouTubeSearchOpen,
    inVoice,
    watchSession,
    users,
    serverMembers,
    openUserProfile,
    activeDmChat,
    homeTab,
    activeRailContext,
    friends,
    systemNotificationsEnabled,
    showConfirmModal,
  } = useAppStore();

  const { ytVol, setYtVol, callMuted } = useAudioStore();
  const prevYtVolRef = useRef<number>(ytVol > 0 ? ytVol : 50);

  const handleToggleYtMute = useCallback(() => {
    if (ytVol > 0) {
      prevYtVolRef.current = ytVol;
      setYtVol(0);
    } else {
      const restored = prevYtVolRef.current > 0 ? prevYtVolRef.current : 50;
      setYtVol(restored);
    }
  }, [ytVol, setYtVol]);

  const [input, setInput] = useState('');
  const [showGiphy, setShowGiphy] = useState(false);
  const [giphySearch, setGiphySearch] = useState('');
  const [giphyError, setGiphyError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadState, setUploadState] = useState<{
    fileName: string;
    fileIndex: number;
    totalFiles: number;
    percent: number;
    loaded: number;
    total: number;
  } | null>(null);
  const isSendingRef = useRef(false);
  const lastPasteTimeRef = useRef<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef<number>(0);
  const [stagedFiles, setStagedFiles] = useState<StagedAttachment[]>([]);
  const stagedFilesRef = useRef(stagedFiles);
  stagedFilesRef.current = stagedFiles;

  useEffect(() => {
    return () => {
      stagedFilesRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState<number>(1);
  const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;

  // ── Resposta com Citação (Reply to message) ──
  const [replyingTo, setReplyingTo] = useState<{
    id: string;
    userName: string;
    message: string;
    type?: string;
  } | null>(null);

  // ── Menu de Contexto (Right click) ──
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    msg: ChatMessage;
    isImage?: boolean;
    imageUrl?: string;
  } | null>(null);

  // Fechar menu de contexto ao clicar fora ou pressionar Esc
  useEffect(() => {
    const handleDocClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('click', handleDocClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleDocClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Fechar Lightbox ao pressionar Esc
  useEffect(() => {
    if (!viewingImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewingImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewingImage]);

  // ── DM (Direct Message) Mode ──
  // O modo DM é exclusivo da visualização inicial (Home) e nunca deve sobrepor um servidor ou sala
  const isDmMode = activeRailContext === 'home' && !room?.id && homeTab === 'dm' && Boolean(activeDmChat);
  const [dmMessages, setDmMessages] = useState<DirectMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const isPartnerBlocked = useMemo(() => {
    if (!isDmMode || !activeDmChat) return false;
    const pId = activeDmChat.partnerId;
    const pName = (activeDmChat.partnerName || (activeDmChat as any).other_user_name || '').trim().toLowerCase();
    return friends.some(f => 
      f.status === 'blocked' && (
        (pId && (f.friendId === pId || f.userId === pId)) ||
        (pName && (f.friendName?.trim().toLowerCase() === pName || (f as any).userName?.trim().toLowerCase() === pName))
      )
    );
  }, [isDmMode, activeDmChat, friends]);

  const isPartnerFriend = useMemo(() => {
    if (!isDmMode || !activeDmChat) return true;
    const pId = activeDmChat.partnerId;
    const pName = cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || '').toLowerCase();
    const matchedAccepted = friends.some(f => 
      f.status === 'accepted' && (
        (pId && (f.friendId === pId || f.userId === pId || f.id === pId)) ||
        (pName && pName !== 'usuário' && cleanDisplayName(f.friendName || (f as any).userName || '').toLowerCase() === pName)
      )
    );
    if (matchedAccepted) return true;
    // Se já há histórico de conversa real com este parceiro e ele não está bloqueado, permitir envio contínuo
    if (!isPartnerBlocked && dmMessages.some(m => m.senderId !== 'system' && m.msgType !== 'system_error')) {
      return true;
    }
    return false;
  }, [isDmMode, activeDmChat, friends, isPartnerBlocked, dmMessages]);

  const handleToggleReaction = useCallback((messageId: string, emoji: string) => {
    const authorName = myName || 'Eu';
    useAppStore.getState().toggleMessageReaction(messageId, emoji, authorName);
    if (isDmMode) {
      setDmMessages((prev) =>
        prev.map((dm) => {
          if (dm.id !== messageId) return dm;
          const reactions = { ...((dm as any).reactions || {}) };
          const currentUsers: string[] = reactions[emoji] || [];
          const alreadyReacted = currentUsers.includes(authorName);
          if (alreadyReacted) {
            const nextUsers = currentUsers.filter((u) => u !== authorName);
            if (nextUsers.length === 0) delete reactions[emoji];
            else reactions[emoji] = nextUsers;
          } else {
            reactions[emoji] = [...currentUsers, authorName];
          }
          return { ...dm, reactions } as any;
        })
      );
    }
    onReaction?.(messageId, emoji);
  }, [myName, isDmMode, onReaction]);

  const handleStartReply = useCallback((msg: ChatMessage) => {
    setReplyingTo({
      id: msg.id,
      userName: msg.userName,
      message: msg.type === 'image' ? '📷 Imagem' : (msg.type === 'file' ? `📎 ${msg.filename || 'Arquivo'}` : msg.message),
      type: msg.type,
    });
    setContextMenu(null);
    setTimeout(() => {
      const el = document.getElementById('chatInput');
      if (el) el.focus();
    }, 50);
  }, []);

  // ── Aviso no chat para comandos de áudio (/play, /pause, /skip, /clear) ──
  const broadcastAudioCommandNotice = useCallback((action: 'play' | 'pause' | 'skip' | 'clear') => {
    const currentChannel = isServer ? (activeChannelId || 'ch-geral') : undefined;
    const noticeText = `O usuário ${myName || 'Anônimo'} executou o comando /${action}`;

    if (room?.id) {
      saveMessageToSupabase(room.id, 'Sistema', noticeText, currentChannel, 'text');
    }

    onSendMessage?.(noticeText, 'text', undefined, undefined, currentChannel, null);
  }, [activeChannelId, isServer, myName, onSendMessage, room?.id]);

  // ── Ouvir eventos de streaming do processo principal (Electron) ──
  useEffect(() => {
    const electron = (window as any).electron;
    if (electron && electron.onStreamingEvent) {
      const unsub = electron.onStreamingEvent((event: any) => {
        if (event.type === 'closed') {
          if (event.service) {
            setStreamingSession(event.service, false);
          }
          if (event.activeService) {
            setActiveStreaming({ service: event.activeService });
            setActiveMediaTab(event.activeService);
          } else {
            setActiveStreaming(null);
            setActiveMediaTab('youtube');
          }
        } else if (event.type === 'opened') {
          if (event.service) {
            setStreamingSession(event.service, true);
          }
        } else if (event.type === 'playback-event') {
          const effectiveInVoice = inVoice || Boolean(useAppStore.getState().inVoice);
          if (effectiveInVoice) {
            const currentSession = useAppStore.getState().watchSession;
            const currentMyId = useAppStore.getState().myId;
            const shouldAutoStart =
              event.playbackType === 'title-started' ||
              (!currentSession && Boolean(event.url)) ||
              (currentSession && currentSession.platform !== event.service && Boolean(event.url)) ||
              (currentSession && currentSession.startedBy === currentMyId && Boolean(event.url) && event.url !== currentSession.titleUrl);

            if (shouldAutoStart && event.url) {
              onWatchSessionStart?.({
                platform: event.service,
                titleUrl: event.url,
                positionSeconds: event.positionSeconds || 0,
                isPlaying: event.isPlaying ?? true,
              });
            } else if (event.playbackType === 'heartbeat') {
              onWatchSessionHeartbeat?.({
                platform: event.service,
                positionSeconds: event.positionSeconds,
                isPlaying: event.isPlaying ?? true,
                url: event.url,
              });
            } else if (event.playbackType === 'play' || event.playbackType === 'pause' || event.playbackType === 'seek') {
              onWatchSessionAction?.({
                action: event.playbackType,
                positionSeconds: event.positionSeconds,
              });
            }
          }
        }
      });
      return unsub;
    }
  }, [setActiveStreaming, setActiveMediaTab, setStreamingSession, inVoice, onWatchSessionStart, onWatchSessionAction, onWatchSessionHeartbeat]);

  // ── Iniciar ou Assumir Watch Party Manualmente ──
  const handleStartWatchParty = async (serviceOverride?: 'netflix' | 'prime' | 'crunchyroll') => {
    const effectiveInVoice = inVoice || Boolean(useAppStore.getState().inVoice);
    if (!effectiveInVoice) {
      toast.error('Você precisa estar em uma call de voz para iniciar uma Watch Party.');
      return;
    }
    const electron = (window as any).electron;
    const targetService: 'netflix' | 'prime' | 'crunchyroll' =
      serviceOverride ||
      (activeMediaTab === 'netflix' || activeMediaTab === 'prime' || (activeMediaTab as any) === 'crunchyroll'
        ? (activeMediaTab as any)
        : (useAppStore.getState().activeStreaming?.service as any) || 'netflix');

    const defaultUrl =
      targetService === 'netflix'
        ? 'https://www.netflix.com/browse'
        : targetService === 'prime'
        ? 'https://www.primevideo.com'
        : 'https://www.crunchyroll.com/';

    if (electron?.getStreamingState) {
      try {
        const state = await electron.getStreamingState(targetService);
        if (state && state.ok && state.url) {
          onWatchSessionStart?.({
            platform: targetService,
            titleUrl: state.url,
            positionSeconds: state.positionSeconds || 0,
            isPlaying: state.isPlaying ?? true,
          });
          toast.success('Watch Party iniciada! Seus amigos já podem clicar em Sincronizar.');
          return;
        }
      } catch {
        // fallback abaixo
      }
    }

    const fallbackUrl = useAppStore.getState().activeStreaming?.url || defaultUrl;
    onWatchSessionStart?.({
      platform: targetService,
      titleUrl: fallbackUrl,
      positionSeconds: 0,
      isPlaying: true,
    });
    toast.success('Watch Party iniciada! Seus amigos já podem clicar em Sincronizar.');
  };


  // ── Video Player Flip ──
  // renderMedia becomes true only AFTER the flip transition ends (lazy mount)
  const [renderMedia, setRenderMedia] = useState(false);
  const streamingHostRef = useRef<HTMLDivElement>(null);

  // Fallback timer: if onTransitionEnd fails to fire within 650ms, ensure media mounts
  useEffect(() => {
    if (showVideoPlayer) {
      const timer = setTimeout(() => {
        setRenderMedia(true);
      }, 650);
      return () => clearTimeout(timer);
    } else {
      setRenderMedia(false);
    }
  }, [showVideoPlayer]);

  // Synchronize Electron WebContentsView / BrowserView with active tab.
  // Mounts/opens ONLY once renderMedia is true (i.e. after the flip animation finishes).
  useEffect(() => {
    const electron = (window as any).electron;
    if (!electron) return;

    const isStreamingTab = activeMediaTab === 'netflix' || activeMediaTab === 'prime' || (activeMediaTab as any) === 'crunchyroll';

    if (!showVideoPlayer || !isStreamingTab || !renderMedia) {
      if (electron.setActiveMediaTab) {
        electron.setActiveMediaTab('youtube');
      }
      return;
    }

    let isCancelled = false;

    if (electron.setActiveMediaTab) {
      electron.setActiveMediaTab(activeMediaTab);
    }

    const mountAndSyncView = async () => {
      if (!streamingHostRef.current || !electron) return;
      const rect = streamingHostRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const bounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      if (electron.openStreamingView) {
        const targetUrl = (watchSession?.platform === activeMediaTab && watchSession.titleUrl)
          ? watchSession.titleUrl
          : (activeStreaming?.service === activeMediaTab ? activeStreaming.url : undefined);

        await electron.openStreamingView({
          service: activeMediaTab,
          url: targetUrl,
          bounds,
          borderRadius: 16,
        });
        if (!isCancelled) {
          setStreamingSession(activeMediaTab as 'netflix' | 'prime' | 'crunchyroll', true);
        }
      }
    };

    mountAndSyncView();

    const updateBounds = () => {
      if (isCancelled || !streamingHostRef.current || !electron?.resizeStreamingView) return;
      const rect = streamingHostRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        electron.resizeStreamingView({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    requestAnimationFrame(updateBounds);
    window.addEventListener('resize', updateBounds);
    const ro = new ResizeObserver(updateBounds);
    if (streamingHostRef.current) ro.observe(streamingHostRef.current);

    return () => {
      isCancelled = true;
      window.removeEventListener('resize', updateBounds);
      ro.disconnect();
    };
  }, [activeMediaTab, renderMedia, showVideoPlayer]);

  // ── Video Settings Menu ──
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsSubMenu, setSettingsSubMenu] = useState<'main' | 'quality'>('main');
  const [isCCActive, setIsCCActive] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
        setSettingsSubMenu('main');
      }
    };
    if (showSettingsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettingsMenu]);

  const formatQualityLabel = (q: string) => {
    switch (q) {
      case 'highres': return 'Alta Definição (Original)';
      case 'hd2880': return '2880p (5K)';
      case 'hd2160': return '2160p (4K)';
      case 'hd1440': return '1440p (2K)';
      case 'hd1080': return '1080p (HD)';
      case 'hd720': return '720p (HD)';
      case 'large': return '480p';
      case 'medium': return '360p';
      case 'small': return '240p';
      case 'tiny': return '144p';
      case 'auto':
      case 'default':
      default:
        return 'Automática';
    }
  };

  // Auto-fechar o PiP quando o vídeo parar de tocar e não houver streaming ativo
  useEffect(() => {
    if (!currentVideoId && !activeStreaming) {
      const store = useAppStore.getState();
      if (store.isPiPActive) {
        const electron = (window as any).electron;
        if (electron?.closePipWindow) electron.closePipWindow();
        store.setPiPActive(false);
      }
    }
  }, [currentVideoId, activeStreaming]);

  // Sempre que for colocado um novo vídeo de reprodução, pré-selecionar a opção de qualidade automática
  useEffect(() => {
    if (currentVideoId) {
      setSelectedQuality('auto');
      onSetQuality?.('auto');
    }
  }, [currentVideoId, onSetQuality]);

  // ── Slash command autocomplete ──
  const SLASH_COMMANDS = [
    { cmd: '/skip', label: 'skip', icon: 'fa-solid fa-forward-step', color: '#a78bfa', description: 'Pula para a próxima música da fila' },
    { cmd: '/play', label: 'play', icon: 'fa-solid fa-play', color: '#4ade80', description: 'Retoma a música pausada' },
    { cmd: '/pause', label: 'pause', icon: 'fa-solid fa-pause', color: '#facc15', description: 'Pausa a música atual' },
    { cmd: '/clear', label: 'clear', icon: 'fa-solid fa-trash-can', color: '#f87171', description: 'Limpa toda a fila de músicas' },
  ];

  const [showCmdMenu, setShowCmdMenu] = useState(false);
  const [cmdFilter, setCmdFilter] = useState<typeof SLASH_COMMANDS>([]);
  const [cmdHighlight, setCmdHighlight] = useState(0);
  const cmdMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDmMode || !activeDmChat?.id) return;
    let isMounted = true;
    setIsLoadingMessages(true);
    setDmMessages([]);

    let initialLoadDone = false;
    const loadDms = async () => {
      try {
        const list = await fetchDirectMessagesFromSupabase(activeDmChat.id);
        if (isMounted) {
          setDmMessages((prev) => {
            const map = new Map<string, DirectMessage>();
            for (let i = 0; i < list.length; i++) {
              const item = list[i];
              if (!item) continue;
              const safeId = item.id || `dm-loaded-${new Date(item.createdAt || Date.now()).getTime()}-${i}`;
              map.set(safeId, { ...item, id: safeId });
            }
            for (let i = 0; i < prev.length; i++) {
              const item = prev[i];
              if (!item) continue;
              const safeId = item.id || `dm-prev-${new Date(item.createdAt || Date.now()).getTime()}-${i}`;
              const alreadyHas = list.some(
                (l) =>
                  (l.id && item.id && l.id === item.id) ||
                  (item.id?.startsWith?.('opt-') &&
                    l.content === item.content &&
                    cleanDisplayName(l.senderName).toLowerCase() === cleanDisplayName(item.senderName).toLowerCase() &&
                    Math.abs(new Date(l.createdAt).getTime() - new Date(item.createdAt).getTime()) < 4000)
              );
              if (!alreadyHas) {
                map.set(safeId, { ...item, id: safeId });
              }
            }
            const res = Array.from(map.values());
            res.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            return res;
          });
        }
      } catch {} finally {
        if (!initialLoadDone && isMounted) {
          initialLoadDone = true;
          setTimeout(() => {
            if (isMounted) {
              setIsLoadingMessages(false);
              setTimeout(() => scrollToBottom(false), 20);
            }
          }, 260);
        }
      }
    };
    loadDms();
    const timer = setInterval(loadDms, 3000);

    const handleNewDmMessage = (e: any) => {
      const rawMsg = e.detail;
      if (!rawMsg || !isMounted) return;
      const newMsg: DirectMessage = {
        ...rawMsg,
        id: rawMsg.id || `dm-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      const msgSenderClean = cleanDisplayName(newMsg.senderName || '').toLowerCase();
      const chatPartnerClean = cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || '').toLowerCase();
      const myClean = cleanDisplayName(myName || '').toLowerCase();
      const targetClean = cleanDisplayName((newMsg as any).targetName || '').toLowerCase();

      const pairKeyExpected = [myClean, chatPartnerClean].filter(Boolean).sort().join('__');
      const pairKeyActual = [msgSenderClean, targetClean].filter(Boolean).sort().join('__');

      const isSenderPartner = Boolean(
        msgSenderClean &&
        chatPartnerClean &&
        (msgSenderClean === chatPartnerClean || chatPartnerClean.includes(msgSenderClean) || msgSenderClean.includes(chatPartnerClean))
      );
      const isTargetMe = targetClean ? (targetClean === myClean || myClean.includes(targetClean) || targetClean.includes(myClean)) : true;

      const matchesChat = Boolean(
        newMsg.chatId === activeDmChat.id ||
        (pairKeyExpected && pairKeyActual && pairKeyExpected === pairKeyActual) ||
        (newMsg.senderId && activeDmChat.partnerId && newMsg.senderId === activeDmChat.partnerId) ||
        (isSenderPartner && isTargetMe) ||
        (msgSenderClean === myClean && targetClean === chatPartnerClean) ||
        isSenderPartner
      );

      if (matchesChat) {
        setDmMessages((prev) => {
          if (prev.some(m => m.id && newMsg.id && m.id === newMsg.id)) {
            return prev;
          }
          const optIdx = prev.findIndex(
            m =>
              m.id?.startsWith?.('opt-') &&
              m.content === newMsg.content &&
              cleanDisplayName(m.senderName).toLowerCase() === cleanDisplayName(newMsg.senderName).toLowerCase() &&
              Math.abs(new Date(m.createdAt).getTime() - new Date(newMsg.createdAt).getTime()) < 4000
          );
          if (optIdx !== -1) {
            const updated = [...prev];
            updated[optIdx] = newMsg;
            return updated;
          }
          const next = [...prev, newMsg];
          next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return next;
        });
      }
    };
    window.addEventListener('concord:new-dm-message', handleNewDmMessage);

    const handleDmMessageDeleted = (e: any) => {
      const msgId = e.detail?.messageId;
      if (msgId && isMounted) {
        setDmMessages((prev) => prev.filter((m) => m.id !== msgId));
      }
    };
    const handleDmDeleted = () => {
      if (isMounted) {
        setDmMessages([]);
      }
    };
    window.addEventListener('concord:dm-message-deleted', handleDmMessageDeleted);
    window.addEventListener('concord:dm-deleted', handleDmDeleted);

    // Supabase Realtime subscription para mensagens diretas instantâneas (apenas se for UUID válido)
    let dmChannel: any = null;
    if (isUuid(activeDmChat.id)) {
      try {
        const channelName = `dm-chat-${activeDmChat.id}`;
        const existingCh = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`);
        if (existingCh) {
          supabase.removeChannel(existingCh);
        }
        dmChannel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'direct_messages',
              filter: `chat_id=eq.${activeDmChat.id}`,
            },
            (payload) => {
              if (!isMounted) return;
              const newMsg = payload.new as any;
              if (!newMsg) return;
              setDmMessages((prev) => {
                if (prev.some((m) => m.id && newMsg.id && m.id === newMsg.id)) return prev;
                const formatted: DirectMessage = {
                  id: newMsg.id || `dm-rt-${Date.now()}`,
                  chatId: newMsg.chat_id,
                  senderId: newMsg.sender_id,
                  content: newMsg.content,
                  msgType: newMsg.msg_type || newMsg.type || 'text',
                  fileUrl: newMsg.file_url,
                  fileName: newMsg.file_name,
                  createdAt: newMsg.created_at || new Date().toISOString(),
                  senderName: newMsg.sender_name || (newMsg.sender_id === myId ? myName : activeDmChat.partnerName),
                  avatarUrl: newMsg.sender_avatar_url || newMsg.avatar_url || (newMsg.sender_id === myId ? myAvatarUrl : activeDmChat.partnerAvatarUrl),
                };
                const optIdx = prev.findIndex(
                  (m) =>
                    m.id?.startsWith?.('opt-') &&
                    m.content === formatted.content &&
                    cleanDisplayName(m.senderName).toLowerCase() === cleanDisplayName(formatted.senderName).toLowerCase() &&
                    Math.abs(new Date(m.createdAt).getTime() - new Date(formatted.createdAt).getTime()) < 4000
                );
                if (optIdx !== -1) {
                  const updated = [...prev];
                  updated[optIdx] = formatted;
                  return updated;
                }
                return [...prev, formatted];
              });
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('[Realtime] Erro ao subscrever canal de DM:', err);
      }
    }

    return () => {
      isMounted = false;
      clearInterval(timer);
      window.removeEventListener('concord:new-dm-message', handleNewDmMessage);
      window.removeEventListener('concord:dm-message-deleted', handleDmMessageDeleted);
      window.removeEventListener('concord:dm-deleted', handleDmDeleted);
      if (dmChannel) {
        supabase.removeChannel(dmChannel);
      }
    };
  }, [isDmMode, activeDmChat?.id, myId, myName, myAvatarUrl, activeDmChat?.partnerName, activeDmChat?.partnerAvatarUrl]);

  // ── Mention Autocomplete (@) ──
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  const mentionCandidates = useMemo(() => {
    const list: Array<{ id: string; name: string; avatarUrl?: string | null; role?: string }> = [
      { id: 'everyone', name: 'everyone', role: 'Notificar todos' }
    ];
    const seen = new Set<string>(['everyone']);

    users.forEach((u) => {
      const clean = (u.name || '').trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        list.push({ id: u.id, name: clean, avatarUrl: u.avatarUrl, role: 'Online' });
      }
    });

    serverMembers.forEach((m) => {
      const clean = (m.username || '').trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        list.push({
          id: m.id || m.username,
          name: clean,
          avatarUrl: m.avatarUrl,
          role: m.role === 'owner' ? 'Dono' : m.role === 'sub_owner' ? 'Sub Dono' : 'Membro'
        });
      }
    });

    return list;
  }, [users, serverMembers]);

  const [mentionFilter, setMentionFilter] = useState<typeof mentionCandidates>([]);

  // Notificação com som ao ser mencionado (@MeuNome ou @everyone)
  const lastProcessedMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.id !== lastProcessedMsgIdRef.current) {
      lastProcessedMsgIdRef.current = lastMsg.id;
      const cleanMy = (myName || '').trim().toLowerCase();
      const isFromOther = cleanMy ? lastMsg.userName.trim().toLowerCase() !== cleanMy : true;
      const text = (lastMsg.message || '').toLowerCase();
      const mentionsMe = (cleanMy && text.includes(`@${cleanMy}`)) || text.includes('@everyone');
      if (isFromOther && mentionsMe) {
        playChimeSound();
      }
    }
  }, [messages, myName]);

  // Custom Video Player Single-Player Teleport & Controls
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const seekLockRef = useRef<number>(0);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isDraggingSeek, setIsDraggingSeek] = useState<boolean>(false);
  const [seekValue, setSeekValue] = useState<number>(0);

  // Notify store when ChatPanel mounts/unmounts
  useEffect(() => {
    setVisualizerActive(true);
    return () => setVisualizerActive(false);
  }, [setVisualizerActive]);



  // Track video current time & duration for custom control bar
  useEffect(() => {
    if (!showVideoPlayer || !currentVideoId) return;

    const timer = setInterval(() => {
      if (Date.now() < seekLockRef.current) return;

      if (getYtDuration) {
        const d = getYtDuration();
        if (d > 0) setDuration(d);
      }

      if (!isDraggingSeek) {
        if (getYtCurrentTime) {
          const c = getYtCurrentTime();
          if (c > 0) {
            setCurrentTime(c);
            return;
          }
        }
        if (musicStartTime && isPlaying) {
          const elapsed = Math.max(0, (Date.now() - musicStartTime) / 1000);
          setCurrentTime(elapsed);
        }
      }
    }, 250);

    return () => clearInterval(timer);
  }, [showVideoPlayer, currentVideoId, isPlaying, musicStartTime, isDraggingSeek, getYtCurrentTime, getYtDuration]);

  const activeTrackTitle = currentTrackTitle || 'Vídeo do YouTube';

  const toggleFullscreen = () => {
    const container = videoContainerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  const togglePiP = async () => {
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    if (isElectron) {
      const electron = (window as any).electron;
      const store = useAppStore.getState();
      if (store.isPiPActive) {
        if (electron?.closePipWindow) electron.closePipWindow();
      } else {
        store.setPiPActive(true);
        if (electron?.openPipWindow) {
          const { ytVol: curYtVol, callMuted: curCallMuted } = useAudioStore.getState();
          electron.openPipWindow({
            videoId: currentVideoId,
            isPlaying,
            currentTime: isDraggingSeek ? seekValue : currentTime,
            duration,
            title: activeTrackTitle,
            volume: curCallMuted ? 0 : curYtVol
          });
        }
      }
    }
  };

  useEffect(() => {
    const electron = (window as any).electron;
    if (electron && electron.onPipAction) {
      const unsubAction = electron.onPipAction((action: string, payload: any) => {
        if (action === 'play') onMusicAction?.('play');
        else if (action === 'pause') onMusicAction?.('pause');
        else if (action === 'skip') onMusicAction?.('skip');
        else if (action === 'clear') {
          onMusicAction?.('clear');
          const store = useAppStore.getState();
          if (store.isPiPActive) {
            const electron = (window as any).electron;
            if (electron?.closePipWindow) electron.closePipWindow();
            store.setPiPActive(false);
          }
        }
        else if (action === 'seek') onMusicSeek?.(payload);
        else if (action === 'volume') setYtVol(payload);
      });
      const unsubClosed = electron.onPipClosed(() => {
        useAppStore.getState().setPiPActive(false);
      });
      return () => {
        unsubAction();
        unsubClosed();
      };
    }
  }, [onMusicAction, onMusicSeek, setYtVol]);

  useEffect(() => {
    const electron = (window as any).electron;
    if (electron && electron.sendPipSync && useAppStore.getState().isPiPActive) {
      electron.sendPipSync({
        videoId: currentVideoId,
        isPlaying,
        currentTime: isDraggingSeek ? seekValue : currentTime,
        duration,
        title: activeTrackTitle,
        volume: callMuted ? 0 : ytVol
      });
    }
  }, [currentVideoId, isPlaying, currentTime, isDraggingSeek, seekValue, duration, activeTrackTitle, ytVol, callMuted]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);

    // Slash command autocomplete
    if (val.startsWith('/') && val.length >= 1) {
      const q = val.toLowerCase();
      const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q));
      setCmdFilter(filtered);
      setShowCmdMenu(filtered.length > 0);
      setCmdHighlight(0);
      setShowMentionMenu(false);
      return;
    } else {
      setShowCmdMenu(false);
    }

    // Mention autocomplete (@)
    const atIndex = val.lastIndexOf('@');
    if (atIndex !== -1 && (atIndex === 0 || val[atIndex - 1] === ' ')) {
      const query = val.slice(atIndex + 1).toLowerCase();
      if (!query.includes(' ')) {
        const matches = mentionCandidates.filter(c => c.name.toLowerCase().startsWith(query));
        if (matches.length > 0) {
          setMentionFilter(matches);
          setShowMentionMenu(true);
          setMentionHighlight(0);
          return;
        }
      }
    }
    setShowMentionMenu(false);
  };

  const applyMention = (candidateName: string) => {
    const atIndex = input.lastIndexOf('@');
    if (atIndex !== -1) {
      const beforeAt = input.slice(0, atIndex);
      const newInput = `${beforeAt}@${candidateName} `;
      setInput(newInput);
    }
    setShowMentionMenu(false);
    setTimeout(() => {
      document.getElementById('chatInput')?.focus();
    }, 50);
  };

  const executeMusicCommand = useCallback((action: 'skip' | 'pause' | 'play' | 'clear') => {
    broadcastAudioCommandNotice(action);
    if (onMusicAction) onMusicAction(action);
    if (action === 'clear') {
      const store = useAppStore.getState();
      if (store.isPiPActive) {
        const electron = (window as any).electron;
        if (electron?.closePipWindow) electron.closePipWindow();
        store.setPiPActive(false);
      }
    }
    setInput('');
    setShowCmdMenu(false);
  }, [broadcastAudioCommandNotice, onMusicAction]);

  const applyCommand = (cmd: string) => {
    const action = cmd.replace('/', '').trim().toLowerCase() as 'skip' | 'pause' | 'play' | 'clear';
    executeMusicCommand(action);
  };

  // Navegação por teclado no menu de comandos e de menções (@)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentionMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionHighlight(h => Math.min(h + 1, mentionFilter.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionHighlight(h => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (mentionFilter[mentionHighlight]) applyMention(mentionFilter[mentionHighlight].name);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentionMenu(false);
        return;
      }
    }

    if (showCmdMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCmdHighlight(h => Math.min(h + 1, cmdFilter.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCmdHighlight(h => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (cmdFilter[cmdHighlight]) applyCommand(cmdFilter[cmdHighlight].cmd);
        return;
      }
      if (e.key === 'Escape') {
        setShowCmdMenu(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const onEmojiClick = (emojiData: any) => {
    setInput(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  // Barra de Pesquisa de Mensagens
  const [searchQuery, setSearchQuery] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const giphyPickerRef = useRef<HTMLDivElement>(null);
  const giphyBtnRef = useRef<HTMLButtonElement>(null);

  // Fechar popups ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(target) &&
        emojiBtnRef.current &&
        !emojiBtnRef.current.contains(target)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showGiphy &&
        giphyPickerRef.current &&
        !giphyPickerRef.current.contains(target) &&
        giphyBtnRef.current &&
        !giphyBtnRef.current.contains(target)
      ) {
        setShowGiphy(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker, showGiphy]);

  // Canal ativo
  const activeChannel = useMemo(() => {
    return channels.find((c) => c.id === activeChannelId) || { id: 'ch-geral', name: 'Geral' };
  }, [channels, activeChannelId]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (messageListRef.current) {
      messageListRef.current.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Carregar mensagens persistentes do canal via Supabase/Local cache
  useEffect(() => {
    if (!room?.id) {
      setMessages([]);
      setIsLoadingMessages(false);
      return;
    }
    const chId = isServer ? (activeChannelId || 'ch-geral') : null;
    const cacheKey = `${room.id}:${chId || 'room'}`;

    setIsLoadingMessages(true);
    const cached = channelMessageCache.get(cacheKey);
    if (cached && cached.length > 0) {
      setMessages(cached);
    } else {
      setMessages([]);
    }

    let isCancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    fetchChannelMessages(room.id, chId, room.code).then((history) => {
      if (isCancelled) return;
      if (history && history.length > 0) {
        const loaded: ChatMessage[] = history.map((m) => {
          const isSystem = m.sender_name === 'Sistema' || (m.msg_type as string) === 'system' || (typeof m.content === 'string' && m.content.startsWith('O usuário ') && m.content.includes(' executou o comando /'));
          return {
            id: m.id,
            roomId: room.id,
            userName: isSystem ? 'Sistema' : m.sender_name,
            message: m.content,
            timestamp: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            type: m.msg_type,
            url: m.file_url || undefined,
            filename: m.file_name || undefined,
            channelId: m.channel_id || (isServer ? 'ch-geral' : undefined),
            isSystem,
          };
        });
        const currentMsgs = useAppStore.getState().messages;
        const loadedSigs = new Set(loaded.map(l => `${l.roomId || ''}_${l.userName}_${l.message}_${l.timestamp}`));
        const extraFromSocket = currentMsgs.filter(m => !loadedSigs.has(`${m.roomId || ''}_${m.userName}_${m.message}_${m.timestamp}`));
        const merged = [...loaded, ...extraFromSocket];
        channelMessageCache.set(cacheKey, merged);
        setMessages(merged);
      }
    }).finally(() => {
      if (isCancelled) return;
      settleTimer = setTimeout(() => {
        if (!isCancelled) {
          setIsLoadingMessages(false);
          setTimeout(() => scrollToBottom(false), 20);
        }
      }, 360);
    });

    return () => {
      isCancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [room?.id, room?.code, activeChannelId, isServer, setMessages, scrollToBottom]);

  useEffect(() => {
    if (room?.id && messages.length > 0) {
      const chId = isServer ? (activeChannelId || 'ch-geral') : null;
      const cacheKey = `${room.id}:${chId || 'room'}`;
      channelMessageCache.set(cacheKey, messages);
    }
  }, [messages, room?.id, activeChannelId, isServer]);

  // Filtrar mensagens para o canal atual (em servidores) ou DM atual
  const channelMessages = useMemo(() => {
    if (isDmMode && activeDmChat) {
      return dmMessages.map((dm): ChatMessage => ({
        id: dm.id,
        userName: dm.senderName || (dm as any).sender_name || 'Usuário',
        message: dm.content,
        timestamp: new Date(dm.createdAt || (dm as any).created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        type: (dm.msgType || (dm as any).msg_type || 'text') as any,
        url: dm.fileUrl || (dm as any).file_url || undefined,
        filename: dm.fileName || (dm as any).file_name || undefined,
        channelId: activeDmChat.id,
        avatarUrl: dm.avatarUrl || (dm as any).avatar_url || (dm as any).sender_avatar || undefined,
        reactions: (dm as any).reactions || {},
        isSystem: dm.msgType === 'system_error' || dm.senderId === 'system',
      }));
    }

    const currentRoomId = room?.id;
    const currentRoomCode = room?.code;

    // Se estiver em sala temporária (não servidor)
    if (!isServer) {
      return messages.filter((m) => {
        if (m.isSystem && !systemNotificationsEnabled) {
          return false;
        }
        if (m.roomId && currentRoomId && m.roomId !== currentRoomId && m.roomId !== currentRoomCode) {
          return false;
        }
        if (m.channelId && m.channelId !== 'ch-geral' && m.channelId !== currentRoomId && m.channelId !== currentRoomCode) {
          return false;
        }
        return true;
      });
    }

    // Se estiver em Servidor Concord
    const currentChannel = activeChannelId || 'ch-geral';
    return messages.filter((m) => {
      if (m.isSystem && !systemNotificationsEnabled) {
        return false;
      }
      if (m.roomId && currentRoomId && m.roomId !== currentRoomId && m.roomId !== currentRoomCode) {
        return false;
      }
      return (!m.channelId && m.isSystem) || (m.channelId || 'ch-geral') === currentChannel;
    });
  }, [isDmMode, activeDmChat, dmMessages, messages, isServer, activeChannelId, room?.id, room?.code, systemNotificationsEnabled]);

  // Filtrar por busca (se houver texto na pesquisa)
  const displayedMessages = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return channelMessages;
    return channelMessages.filter(
      (m) =>
        m.message.toLowerCase().includes(trimmed) ||
        m.userName.toLowerCase().includes(trimmed)
    );
  }, [channelMessages, searchQuery]);

  // ResizeObserver para manter rolagem no fim quando imagens carregam
  useEffect(() => {
    const listEl = messageListRef.current;
    if (!listEl) return;

    const observer = new ResizeObserver(() => {
      if (!searchQuery) {
        scrollToBottom(false);
      }
    });

    observer.observe(listEl);
    return () => observer.disconnect();
  }, [searchQuery, scrollToBottom]);

  // Listener explícito de roda do mouse para garantir rolagem 100% confiável no Electron Desktop
  useEffect(() => {
    const listEl = messageListRef.current;
    if (!listEl) return;

    const onWheel = (e: WheelEvent) => {
      if (listEl.scrollHeight > listEl.clientHeight) {
        listEl.scrollTop += e.deltaY;
      }
    };

    listEl.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      listEl.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Alinhamento imediato ao mudar de canal ou receber nova mensagem
  useEffect(() => {
    if (!searchQuery) {
      scrollToBottom(false);
      const t1 = setTimeout(() => scrollToBottom(false), 40);
      return () => clearTimeout(t1);
    }
  }, [displayedMessages.length, activeChannelId, activeDmChat?.id, searchQuery, scrollToBottom]);

  const stageFiles = useCallback((filesToAdd: FileList | File[]) => {
    const newStaged: StagedAttachment[] = [];
    const filesArray = Array.from(filesToAdd);
    let hasTooLarge = false;

    for (const rawFile of filesArray) {
      if (rawFile.size > MAX_CHAT_FILE_SIZE) {
        hasTooLarge = true;
        continue;
      }

      // Normalização do tipo MIME caso venha vazio ou genérico
      let processedFile = rawFile;
      if (!rawFile.type || rawFile.type === '') {
        const ext = rawFile.name ? rawFile.name.split('.').pop()?.toLowerCase() : '';
        let mime = 'application/octet-stream';
        if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
        else if (ext === 'png') mime = 'image/png';
        else if (ext === 'gif') mime = 'image/gif';
        else if (ext === 'webp') mime = 'image/webp';
        else if (ext === 'svg') mime = 'image/svg+xml';
        else if (ext === 'pdf') mime = 'application/pdf';
        processedFile = new File([rawFile], rawFile.name || `arquivo_${Date.now()}`, { type: mime });
      }

      const isImage = processedFile.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(processedFile.name);
      const previewUrl = URL.createObjectURL(processedFile);
      const id = `staged-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      newStaged.push({
        id,
        file: processedFile,
        previewUrl,
        isImage,
      });
    }

    if (hasTooLarge) {
      toast.error('O arquivo deve ter no máximo 1GB.');
    }

    if (newStaged.length > 0) {
      setStagedFiles((prev) => {
        const deduplicatedNew = newStaged.filter(n => !prev.some(p => p.file.size === n.file.size && (p.file.name === n.file.name || (p.isImage && n.isImage))));
        if (deduplicatedNew.length === 0) return prev;
        return [...prev, ...deduplicatedNew];
      });
      if (newStaged.length === 1) {
        toast.success(`Arquivo "${newStaged[0].file.name}" anexado!`);
      } else {
        toast.success(`${newStaged.length} arquivos anexados!`);
      }
      setTimeout(() => {
        document.getElementById('chatInput')?.focus();
      }, 50);
    }
  }, []);

  const removeStagedFile = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clearStagedFiles = useCallback(() => {
    setStagedFiles((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (isSendingRef.current || isUploading) return;
    const trimmed = input.trim();
    if (!trimmed && stagedFiles.length === 0) return;
    isSendingRef.current = true;

    // Envio de Mensagem Direta (DM 1:1)
    if (isDmMode && activeDmChat) {
      if (isPartnerBlocked) {
        toast.error('Você não pode enviar mensagens diretas para um usuário bloqueado.');
        isSendingRef.current = false;
        return;
      }
      if (!isPartnerFriend) {
        toast.error('Esta pessoa não recebeu sua mensagem pois ainda não é seu amigo.', {
          id: 'dm-not-friend-warning',
          duration: 5000,
          icon: '⛔',
          style: {
            background: '#dc2626',
            color: '#ffffff',
            fontWeight: 600,
            fontSize: '14px',
            borderRadius: '10px',
            boxShadow: '0 8px 30px rgba(220, 38, 38, 0.5)',
            border: '1px solid #ef4444',
            padding: '12px 18px',
          },
        });

        const errorMsg: DirectMessage = {
          id: `sys-err-${Date.now()}`,
          chatId: activeDmChat.id,
          senderId: 'system',
          senderName: 'Sistema',
          avatarUrl: null,
          content: 'Esta pessoa não recebeu sua mensagem pois ainda não é seu amigo.',
          msgType: 'system_error' as any,
          createdAt: new Date().toISOString(),
        };
        setDmMessages(prev => [...prev, errorMsg]);
        isSendingRef.current = false;
        return;
      }

      // Otimismo imediato se for texto puro sem anexos
      if (stagedFiles.length === 0 && trimmed) {
        try {
          let finalQuotePrefix = '';
          if (replyingTo) {
            const quoteSnippet = replyingTo.message.length > 70 ? replyingTo.message.slice(0, 67) + '...' : replyingTo.message;
            finalQuotePrefix = `> **@${replyingTo.userName}**: ${quoteSnippet}\n`;
          }
          const dmContent = finalQuotePrefix ? `${finalQuotePrefix}${trimmed}` : trimmed;
          setInput('');
          setReplyingTo(null);

          const msgId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const authorName = cleanDisplayName(myName || localStorage.getItem('concord_username') || 'Você');
          const optimisticDm: DirectMessage = {
            id: msgId,
            chatId: activeDmChat.id,
            senderId: myId || myName || 'me',
            senderName: authorName,
            avatarUrl: myAvatarUrl,
            content: dmContent,
            msgType: 'text',
            createdAt: new Date().toISOString(),
          };
          setDmMessages((prev) => (prev.some((m) => m.id === msgId) ? prev : [...prev, optimisticDm]));
          sendDirectMessageToSupabase(
            activeDmChat.id,
            dmContent,
            'text',
            undefined,
            undefined,
            activeDmChat.partnerId,
            activeDmChat.partnerName,
            msgId
          );
        } finally {
          isSendingRef.current = false;
        }
        return;
      }

      if (stagedFiles.length > 0) {
        const filesToSend = [...stagedFiles];
        setInput('');
        clearStagedFiles();
        setReplyingTo(null);
        setIsUploading(true);

        try {
          for (let i = 0; i < filesToSend.length; i++) {
            const item = filesToSend[i];
            setUploadState({
              fileName: item.file.name,
              fileIndex: i + 1,
              totalFiles: filesToSend.length,
              percent: 0,
              loaded: 0,
              total: item.file.size,
            });

            const fileUrl = await uploadChatAttachment(item.file, (info) => {
              setUploadState({
                fileName: item.file.name,
                fileIndex: i + 1,
                totalFiles: filesToSend.length,
                percent: info.percent,
                loaded: info.loaded,
                total: info.total,
              });
            });

            const msgType: 'image' | 'file' = item.isImage ? 'image' : 'file';
            const messageContent = (i === 0 && trimmed) ? trimmed : (item.isImage ? '📷 Imagem' : `📎 ${item.file.name}`);

            const authorName = cleanDisplayName(myName || (typeof window !== 'undefined' ? (localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1')) : '') || 'Você');
            const msgId =
              typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `dm-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;

            const optimisticDm: DirectMessage = {
              id: msgId,
              chatId: activeDmChat.id,
              senderId: myId || myName || 'me',
              senderName: authorName,
              avatarUrl: myAvatarUrl,
              content: messageContent,
              msgType: msgType,
              fileUrl: fileUrl,
              fileName: item.file.name,
              createdAt: new Date().toISOString(),
            };
            setDmMessages((prev) => (prev.some((m) => m.id === msgId) ? prev : [...prev, optimisticDm]));

            sendDirectMessageToSupabase(
              activeDmChat.id,
              messageContent,
              msgType as any,
              fileUrl,
              item.file.name,
              activeDmChat.partnerId,
              activeDmChat.partnerName,
              msgId
            );
          }
        } catch (err: any) {
          console.error('Erro ao enviar anexos:', err);
          toast.error(err?.message || 'Falha ao processar envio dos arquivos.');
        } finally {
          setIsUploading(false);
          setUploadState(null);
          isSendingRef.current = false;
        }
        return;
      }
      isSendingRef.current = false;
      return;
    }

    // Interceptação direta dos comandos de música
    if (stagedFiles.length === 0 && trimmed.startsWith('/')) {
      const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
      if (firstWord === '/pause' || firstWord === '/play' || firstWord === '/skip' || firstWord === '/clear') {
        const action = firstWord.replace('/', '') as 'skip' | 'pause' | 'play' | 'clear';
        executeMusicCommand(action);
        setInput('');
        isSendingRef.current = false;
        return;
      }
    }

    const currentChannel = isServer ? (activeChannelId || 'ch-geral') : undefined;

    // Envio de mensagem em canal/sala
    if (stagedFiles.length > 0) {
      const filesToSend = [...stagedFiles];
      const replyData = replyingTo;
      setInput('');
      clearStagedFiles();
      setReplyingTo(null);
      setIsUploading(true);

      try {
        let finalQuotePrefix = '';
        if (replyData) {
          const quoteSnippet = replyData.message.length > 70 ? replyData.message.slice(0, 67) + '...' : replyData.message;
          finalQuotePrefix = `> **@${replyData.userName}**: ${quoteSnippet}\n`;
        }

        for (let i = 0; i < filesToSend.length; i++) {
          const item = filesToSend[i];
          setUploadState({
            fileName: item.file.name,
            fileIndex: i + 1,
            totalFiles: filesToSend.length,
            percent: 0,
            loaded: 0,
            total: item.file.size,
          });

          const fileUrl = await uploadChatAttachment(item.file, (info) => {
            setUploadState({
              fileName: item.file.name,
              fileIndex: i + 1,
              totalFiles: filesToSend.length,
              percent: info.percent,
              loaded: info.loaded,
              total: info.total,
            });
          });

          const isImage = item.isImage;
          const msgType: 'image' | 'file' = isImage ? 'image' : 'file';
          const fileName = item.file.name || (isImage ? 'imagem.png' : 'arquivo');

          // O texto digitado e eventual citação acompanham o primeiro arquivo (como no Discord)
          const rawText = (i === 0 && trimmed) ? trimmed : (isImage ? '📷 Imagem' : `📄 ${fileName}`);
          const msgText = (i === 0 && finalQuotePrefix) ? `${finalQuotePrefix}${rawText}` : rawText;

          const timestamp = new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          });
          const authorName = (myName || (typeof window !== 'undefined' ? (localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1')) : '') || '').trim() || 'Você';
          const optMsg: ChatMessage = {
            id: `opt-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            roomId: room?.id,
            userName: authorName,
            message: msgText,
            timestamp,
            type: msgType,
            url: fileUrl,
            filename: fileName,
            channelId: currentChannel,
            avatarUrl: myAvatarUrl,
          };
          addMessage(optMsg);

          // Salvar no Supabase e Socket
          if (room?.id) {
            saveMessageToSupabase(room.id, authorName, msgText, currentChannel, msgType, fileUrl, fileName);
          }
          onSendMessage?.(msgText, msgType, fileUrl, fileName, currentChannel, myAvatarUrl);
        }
      } catch (err: any) {
        console.error('Erro no upload/conversao de arquivo:', err);
        toast.error(err?.message || 'Falha ao processar envio dos arquivos.');
      } finally {
        setIsUploading(false);
        setUploadState(null);
        isSendingRef.current = false;
      }
    } else {
      let finalQuotePrefix = '';
      if (replyingTo) {
        const quoteSnippet = replyingTo.message.length > 70 ? replyingTo.message.slice(0, 67) + '...' : replyingTo.message;
        finalQuotePrefix = `> **@${replyingTo.userName}**: ${quoteSnippet}\n`;
        setReplyingTo(null);
      }
      const msgText = finalQuotePrefix ? `${finalQuotePrefix}${trimmed}` : trimmed;

      // ── Envio Otimista Imediato (0ms de latência percebida) ──
      setInput('');
      const timestamp = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
      const authorName = (myName || (typeof window !== 'undefined' ? (localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1')) : '') || '').trim() || 'Você';
      const optMsg: ChatMessage = {
        id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        roomId: room?.id,
        userName: authorName,
        message: msgText,
        timestamp,
        type: 'text',
        channelId: currentChannel,
        avatarUrl: myAvatarUrl,
      };
      addMessage(optMsg);

      // Salvar no Supabase e disparar Socket em paralelo
      if (room?.id) {
        saveMessageToSupabase(room.id, authorName, msgText, currentChannel, 'text');
      }
      onSendMessage?.(msgText, 'text', undefined, undefined, currentChannel, myAvatarUrl);
      isSendingRef.current = false;
    }
  }, [input, stagedFiles, replyingTo, onSendMessage, activeChannelId, isServer, executeMusicCommand, room?.id, myId, myName, myAvatarUrl, isDmMode, activeDmChat, isPartnerBlocked, isPartnerFriend, addMessage, clearStagedFiles, isUploading]);

  const handlePaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 300) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof (e as any).stopPropagation === 'function') (e as any).stopPropagation();
      return;
    }
    lastPasteTimeRef.current = now;

    const clipboardData = (e as any).clipboardData;
    if (!clipboardData) return;

    // 1. Itens de clipboard (ex: print screen, Lightshot, Snipping Tool, cópia de imagem)
    const items = clipboardData.items ? Array.from(clipboardData.items as DataTransferItemList) : [];
    const imageItems = items.filter((it: any) => it.kind === 'file' && (it.type?.startsWith('image/') || it.type?.indexOf('image') !== -1));

    // Quando o usuário copia com Lightshot (prnt.sc) ou ferramentas de print, o Windows disponibiliza
    // a mesma captura em múltiplos formatos simultâneos (PNG, BMP, JPEG).
    // Filtramos para extrair exclusivamente a melhor imagem (PNG), garantindo que apenas 1 imagem seja colada!
    if (imageItems.length > 0) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof (e as any).stopPropagation === 'function') (e as any).stopPropagation();

      const pngItem = imageItems.find((it: any) => it.type === 'image/png');
      const targetItem = pngItem || imageItems[0];
      const file = targetItem.getAsFile();
      if (file) {
        stageFiles([file]);
        return;
      }
    }

    // 2. Arquivos copiados do Explorer do Windows (ex: múltiplos arquivos reais)
    const files = clipboardData.files;
    if (files && files.length > 0) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof (e as any).stopPropagation === 'function') (e as any).stopPropagation();

      const filesArray = Array.from(files as FileList);
      // Se for duplicata de screenshot em múltiplos formatos genéricos (image.png, image.bmp, etc)
      const isAllGenericScreenshots = filesArray.every(f => f.type.startsWith('image/') && (f.name === 'image.png' || f.name === 'image.jpeg' || f.name === 'image.bmp'));
      if (isAllGenericScreenshots && filesArray.length > 1) {
        const bestFile = filesArray.find(f => f.type === 'image/png') || filesArray[0];
        stageFiles([bestFile]);
        return;
      }

      stageFiles(files);
      return;
    }

    // 3. Outros itens não-imagem do clipboard
    if (items.length > 0) {
      const otherFiles: File[] = [];
      for (const it of items) {
        if ((it as any).kind === 'file') {
          const f = (it as any).getAsFile();
          if (f) otherFiles.push(f);
        }
      }
      if (otherFiles.length > 0) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof (e as any).stopPropagation === 'function') (e as any).stopPropagation();
        stageFiles(otherFiles);
        return;
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    stageFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      stageFiles(files);
      return;
    }

    if (e.dataTransfer.items) {
      const droppedFiles: File[] = [];
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            droppedFiles.push(file);
          }
        }
      }
      if (droppedFiles.length > 0) {
        stageFiles(droppedFiles);
      }
    }
  };

  const handlePasteRef = useRef(handlePaste);
  handlePasteRef.current = handlePaste;

  // Listener global de paste para capturar Ctrl+V mesmo com o foco fora do input
  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        // Se o foco já está em um campo (como o chatInput), o evento onPaste do próprio elemento cuida disso
        return;
      }
      const clipboardData = e.clipboardData;
      if (clipboardData) {
        const hasImageItem = Array.from(clipboardData.items || []).some(
          it => it.type.startsWith('image/') || it.kind === 'file'
        );
        const hasFiles = clipboardData.files && clipboardData.files.length > 0;
        if (hasImageItem || hasFiles) {
          handlePasteRef.current(e);
        }
      }
    };

    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, []);

  const handleSelectGif = (gif: any) => {
    const gifUrl = gif.images.fixed_height.url;
    const currentChannel = isServer ? (activeChannelId || 'ch-geral') : undefined;

    if (room?.id) {
      saveMessageToSupabase(room.id, myName, 'GIF', currentChannel, 'giphy', gifUrl);
    }

    onSendMessage?.('GIF', 'giphy', gifUrl, undefined, currentChannel, myAvatarUrl);
    setShowGiphy(false);
  };

  const fetchGifs = (offset: number) => {
    setGiphyError(null);
    const fetcher = giphySearch.trim()
      ? gf.search(giphySearch, { offset, limit: 10 })
      : gf.trending({ offset, limit: 10 });

    return fetcher.catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[Giphy] Erro ao buscar GIFs:', errMsg, err);
      setGiphyError(errMsg);
      // Re-lança para o componente Grid exibir o estado de erro
      throw err;
    });
  };

  const handleMessageListClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.concord-mention-tag') as HTMLElement | null;
    if (!target) return;
    const rawMention = target.getAttribute('data-mention') || '';
    const cleanMention = rawMention.trim();
    if (!cleanMention || cleanMention.toLowerCase() === 'everyone') return;

    e.preventDefault();
    e.stopPropagation();

    const cleanTarget = cleanMention.toLowerCase();
    const cleanMy = (myName || '').trim().toLowerCase();
    const isMe = cleanTarget === cleanMy;

    if (isMe) {
      openUserProfile({
        id: myId || 'me',
        name: myName || cleanMention,
        avatarUrl: myAvatarUrl,
        isMe: true,
        tag: (useAppStore.getState().myTag || localStorage.getItem('concord_user_tag') || '7236').replace('#', ''),
      });
      return;
    }

    const foundUser = users.find((u) => (u.name || '').trim().toLowerCase() === cleanTarget);
    const foundMember = serverMembers.find((m) => (m.username || '').trim().toLowerCase() === cleanTarget);

    openUserProfile({
      id: foundUser?.id || foundMember?.id || cleanMention,
      name: foundUser?.name || foundMember?.username || cleanMention,
      avatarUrl: foundUser?.avatarUrl || foundMember?.avatarUrl || undefined,
      role: (foundUser?.role || foundMember?.role || 'member') as any,
      isMe: false,
      customRole: foundUser?.customRole || foundMember?.customRole,
    });
  }, [myName, myId, myAvatarUrl, openUserProfile, users, serverMembers]);

  return (
    <div
      className={`${styles.chatPanel} ${isDragging ? styles.dragging : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Background Ambient Glows (Idêntico ao Hub Concord) */}
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      {/* ── CABEÇALHO DO CHAT (PROTÓTIPO) ── */}
      <div className={styles.chatHeader}>
        <div className={styles.headerLeft}>
          {isDmMode && activeDmChat ? (
            <>
              <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
                {activeDmChat.partnerAvatarUrl || (activeDmChat as any).other_user_avatar ? (
                  <img
                    src={activeDmChat.partnerAvatarUrl || (activeDmChat as any).other_user_avatar}
                    alt={activeDmChat.partnerName || (activeDmChat as any).other_user_name}
                    style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#6366f1', color: '#fff', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                    {(activeDmChat.partnerName || (activeDmChat as any).other_user_name || 'DM').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className={styles.headerTitle}>
                <span className={styles.headerChannelName}>{cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name)}</span>
              </div>
              <span className={styles.headerDivider}></span>
              <span className={styles.headerTopic}>Mensagem Direta Privada</span>
            </>
          ) : (
            <>
              <div className={styles.headerTitle}>
                {showVideoPlayer ? (
                  <>
                    <i className="fa-solid fa-tv" style={{ color: '#7c5cff' }}></i>
                    <span className={styles.headerChannelName}>Player de Vídeo</span>
                  </>
                ) : isServer ? (
                  <>
                    <i className="fa-solid fa-hashtag" style={{ color: '#7c5cff' }}></i>
                    <span className={styles.headerChannelName}>{activeChannel.name}</span>
                  </>
                ) : (
                  <>
                    <i className="fa-regular fa-comments" style={{ color: '#7c5cff' }}></i>
                    <span className={styles.headerChannelName}>Chat da Sala</span>
                  </>
                )}
              </div>
              <span className={styles.headerDivider}></span>
              <span className={styles.headerTopic}>
                {isServer ? `Canal de bate-papo ${activeChannel.name.toLowerCase()} do servidor` : 'Canal de bate-papo geral da sala'}
              </span>
            </>
          )}
        </div>

        <div className={styles.headerActions}>
          {isDmMode && activeDmChat && (
            <>
              <button
                type="button"
                className={`${styles.dmHeaderBtn} ${isDmMuted(activeDmChat.id, activeDmChat.partnerName) ? styles.dmHeaderBtnMuted : ''}`}
                onClick={() => {
                  const partnerName = cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || 'Usuário');
                  const isNowMuted = toggleMuteDm(activeDmChat.id, partnerName);
                  if (isNowMuted) {
                    toast(`Notificações de ${partnerName} silenciadas.`, { icon: '🔕' });
                  } else {
                    toast.success(`Notificações de ${partnerName} reativadas!`);
                  }
                }}
                title={isDmMuted(activeDmChat.id, activeDmChat.partnerName) ? 'Reativar notificações desta conversa' : 'Silenciar notificações desta conversa'}
              >
                <i className={`fa-solid ${isDmMuted(activeDmChat.id, activeDmChat.partnerName) ? 'fa-bell-slash' : 'fa-bell'}`}></i>
                <span>{isDmMuted(activeDmChat.id, activeDmChat.partnerName) ? 'Silenciado' : 'Silenciar'}</span>
              </button>

              <button
                type="button"
                className={`${styles.dmHeaderBtn} ${styles.dmHeaderBtnDanger}`}
                onClick={() => {
                  const partnerName = cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || 'Usuário');
                  const chatId = activeDmChat.id;
                  showConfirmModal({
                    title: 'Excluir Conversa',
                    message: `Tem certeza que deseja excluir toda a conversa com ${partnerName}? Esta ação apagará todas as mensagens e não pode ser desfeita.`,
                    confirmText: 'Excluir Conversa',
                    cancelText: 'Cancelar',
                    isDanger: true,
                    onConfirm: () => {
                      deleteDmConversation(chatId, partnerName);
                      toast.success('Conversa excluída com sucesso.');
                    },
                  });
                }}
                title="Excluir esta conversa e histórico"
              >
                <i className="fa-solid fa-trash-can"></i>
                <span>Excluir</span>
              </button>
            </>
          )}

          {!showVideoPlayer && (
            <div className={styles.searchWrapper}>
              <i className={`fa-solid fa-magnifying-glass ${styles.searchIcon}`}></i>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className={styles.clearSearchBtn}
                  onClick={() => setSearchQuery('')}
                  title="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Botão rápido de iniciar Watch Party no cabeçalho quando player aberto */}
          {showVideoPlayer && !watchSession && activeMediaTab !== 'youtube' && (
            <button
              className={styles.headerWatchSyncBtn}
              onClick={() => handleStartWatchParty()}
              title="Iniciar Watch Party com o vídeo atual para todos na call"
            >
              <i className="fa-solid fa-tower-broadcast"></i>
              <span>Iniciar Watch Party</span>
            </button>
          )}

          {/* Botão de alternar entre Chat e Streaming quando há streaming ativo ou player aberto */}
          {((Boolean(activeStreaming || streamingSessions.netflix || streamingSessions.prime || (streamingSessions as any).crunchyroll || currentVideoId)) || showVideoPlayer) && (
            <button
              className={`${styles.watchBtn} ${showVideoPlayer ? styles.watchBtnActive : ''}`}
              onClick={() => {
                if (showVideoPlayer) {
                  const electron = (window as any).electron;
                  if (electron?.setActiveMediaTab) electron.setActiveMediaTab('youtube');
                  setRenderMedia(false);
                  setShowVideoPlayer(false);
                } else {
                  setShowVideoPlayer(true);
                }
              }}
              title={showVideoPlayer ? 'Voltar ao Chat' : 'Voltar ao Streaming'}
            >
              <i className={`fa-solid ${showVideoPlayer ? 'fa-arrow-left' : 'fa-tv'}`}></i>
              <span>{showVideoPlayer ? 'Chat' : 'Assistir'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── FLIP CARD CONTAINER ── */}
      <div className={`${styles.flipCard} ${showVideoPlayer ? styles.flipped : ''}`}>
        <div
          className={styles.flipCardInner}
          onTransitionEnd={(e) => {
            // Only react to the rotateY transition on this exact element
            if (e.propertyName === 'transform' && e.target === e.currentTarget && showVideoPlayer) {
              setRenderMedia(true);
            }
          }}
        >

          {/* ══ FACE FRENTE: Chat normal ══ */}
          <div className={styles.flipCardFront}>

            {isDragging && (
              <div className={styles.dragOverlay}>
                <div className={styles.dragMessage}>
                  <span className={styles.dragIcon}>📁</span>
                  <span>Solte o arquivo aqui para enviar</span>
                </div>
              </div>
            )}

            {/* Message list */}
            <div ref={messageListRef} className={styles.messageList} onClick={handleMessageListClick}>
              {isLoadingMessages ? (
                <div className={styles.chatLoadingContainer}>
                  <div className={styles.chatLoadingSpinner} />
                  <p className={styles.chatLoadingTitle}>Carregando mensagens...</p>
                  <p className={styles.chatLoadingSubtitle}>
                    {isDmMode && activeDmChat
                      ? `Sincronizando conversa com ${cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || 'amigo')}`
                      : isServer
                      ? `Sincronizando histórico de #${activeChannel.name}`
                      : 'Sincronizando mensagens da sala'}
                  </p>
                </div>
              ) : displayedMessages.length === 0 ? (
                <div className={styles.emptyMessages}>
                  {searchQuery ? (
                    <p>Nenhuma mensagem encontrada para &quot;{searchQuery}&quot;</p>
                  ) : (
                    <>
                      <div className={styles.emptyIcon}>👋</div>
                      <p>
                        {isServer
                          ? `Bem-vindo ao #${activeChannel.name}! Seja o primeiro a falar!`
                          : 'Nenhuma mensagem ainda. Diga oi!'}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                displayedMessages.map((msg, index) => {
                  const prevMsg = index > 0 ? displayedMessages[index - 1] : null;
                  const isSystemMsg = Boolean(msg.isSystem || msg.userName === 'Sistema' || (typeof msg.message === 'string' && msg.message.startsWith('O usuário ') && msg.message.includes(' executou o comando /')));
                  const prevIsSystem = prevMsg ? Boolean(prevMsg.isSystem || prevMsg.userName === 'Sistema' || (typeof prevMsg.message === 'string' && prevMsg.message.startsWith('O usuário ') && prevMsg.message.includes(' executou o comando /'))) : false;

                  const cleanMyName = (myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '').trim().toLowerCase();
                  const cleanMsgUser = (msg.userName || '').trim().toLowerCase();
                  const cleanPrevUser = prevMsg ? (prevMsg.userName || '').trim().toLowerCase() : '';
                  const isMe = !isSystemMsg && Boolean(
                    (cleanMyName && cleanMsgUser && cleanMyName === cleanMsgUser) ||
                    (msg.userId && myId && msg.userId === myId) ||
                    cleanMsgUser === 'você'
                  );

                  const parsedReply = parseReplyMessage(msg.message);

                  // Agrupamento de mensagens consecutivas do mesmo autor (padrão Discord)
                  const isConsecutive = Boolean(
                    !isSystemMsg &&
                    !prevIsSystem &&
                    !parsedReply &&
                    prevMsg &&
                    cleanMsgUser === cleanPrevUser &&
                    (!msg.timestamp || !prevMsg.timestamp || msg.timestamp === prevMsg.timestamp)
                  );

                  const displayAvatar = isMe ? (myAvatarUrl || msg.avatarUrl) : msg.avatarUrl;
                  const foundUser = users.find((u) => (u.name || '').trim().toLowerCase() === cleanMsgUser);
                  const foundMember = serverMembers.find((m) => (m.username || '').trim().toLowerCase() === cleanMsgUser);
                  const targetUserId = msg.userId || foundUser?.id || foundMember?.id || msg.id;
                  const targetRole = (foundUser?.role || foundMember?.role || 'member') as any;

                  const handleProfileClick = () => {
                    openUserProfile({
                      id: targetUserId,
                      name: msg.userName,
                      avatarUrl: displayAvatar,
                      role: targetRole,
                      isMe,
                      tag: isMe ? (useAppStore.getState().myTag || localStorage.getItem('concord_user_tag') || '7236').replace('#', '') : undefined,
                    });
                  };

                  const displayMessageText = parsedReply ? parsedReply.actualText : msg.message;
                  const onlyEmojis = isOnlyEmojis(displayMessageText);
                  const isMentioned = Boolean(
                    myName &&
                    (displayMessageText.toLowerCase().includes(`@${myName.toLowerCase()}`) ||
                     displayMessageText.toLowerCase().includes('@everyone'))
                  );

                  return (
                    <div
                      key={msg.id}
                      className={
                        isSystemMsg
                          ? styles.systemWrapper
                          : `${styles.messageRow} ${isMe ? styles.messageRowMe : styles.messageRowOther} ${isMentioned ? styles.messageRowMentioned : ''} ${isConsecutive ? styles.consecutiveRow : ''}`
                      }
                      onContextMenu={(e) => {
                        if (isSystemMsg) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          msg,
                          isImage: msg.type === 'image' && Boolean(msg.url),
                          imageUrl: msg.url,
                        });
                      }}
                    >
                      {isSystemMsg ? (
                        msg.type === 'system_error' ? (
                          <div className={styles.systemErrorMessage}>
                            <span className={styles.systemMessageIcon}>⛔</span>
                            <span>{msg.message}</span>
                          </div>
                        ) : systemNotificationsEnabled ? (
                          <div className={styles.systemMessage}>
                            {!/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u.test(msg.message) && (
                              <span className={styles.systemMessageIcon}>⚙️</span>
                            )}
                            <span>{msg.message}</span>
                          </div>
                        ) : null
                      ) : (
                        <>
                          {/* Barra de Ações Rápidas Estilo Discord (Hover) */}
                          <div className={styles.messageActionBar}>
                            <div className={styles.quickReactionsGroup}>
                              {['👍', '❤️', '😂', '🔥', '🚀'].map((em) => (
                                <button
                                  key={em}
                                  type="button"
                                  className={styles.actionBarEmojiBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleReaction(msg.id, em);
                                  }}
                                  title={`Reagir com ${em}`}
                                >
                                  {em}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              className={styles.actionBarBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartReply(msg);
                              }}
                              title="Responder"
                            >
                              <i className="fa-solid fa-reply"></i>
                            </button>
                          </div>

                          {isConsecutive ? (
                            <div className={styles.consecutiveGutter}>
                              <span className={styles.gutterTimestamp}>{msg.timestamp || ''}</span>
                            </div>
                          ) : displayAvatar ? (
                            <img
                              src={displayAvatar}
                              alt={msg.userName}
                              className={`${styles.messageAvatar} ${isMe ? styles.messageAvatarMe : ''}`}
                              onClick={handleProfileClick}
                              style={{ cursor: 'pointer' }}
                              title={`Ver perfil de ${msg.userName}`}
                            />
                          ) : (
                            <div 
                              className={styles.messageAvatarFallback}
                              onClick={handleProfileClick}
                              style={{ cursor: 'pointer' }}
                              title={`Ver perfil de ${msg.userName}`}
                            >
                              {msg.userName.substring(0, 2).toUpperCase()}
                            </div>
                          )}

                          <div className={styles.messageContentCol}>
                            {/* Citação da Mensagem Respondida (Discord Style) */}
                            {parsedReply && (
                              <div className={styles.replyQuoteHeader}>
                                <i className="fa-solid fa-reply"></i>
                                <span className={styles.replyQuoteUser}>@{parsedReply.quotedUser}</span>
                                <span className={styles.replyQuoteSnippet}>{parsedReply.quotedText}</span>
                              </div>
                            )}

                            {!isConsecutive && (
                              <div className={styles.messageUserHeader}>
                                <span 
                                  className={styles.senderName}
                                  onClick={handleProfileClick}
                                  style={{ cursor: 'pointer' }}
                                  title={`Ver perfil de ${msg.userName}`}
                                >
                                  {msg.userName}
                                  {isMe && <span className={styles.meBadge}>VOCÊ</span>}
                                </span>
                                {(() => {
                                  const customRole = msg.customRole || foundUser?.customRole || foundMember?.customRole;
                                  if (!customRole) return null;
                                  return (
                                    <span 
                                      className={styles.msgRoleBadge}
                                      style={{
                                        borderColor: customRole.color || '#7c5cff',
                                        color: customRole.color || '#c4b5fd',
                                        background: `${customRole.color || '#7c5cff'}22`,
                                      }}
                                      title={`Cargo: ${customRole.name}`}
                                    >
                                      <span>{customRole.emoji}</span>
                                      <span>{customRole.name}</span>
                                    </span>
                                  );
                                })()}
                                <span className={styles.timestamp}>{msg.timestamp || 'Hoje'}</span>
                              </div>
                            )}

                            {/* Conteúdo da mensagem */}
                            {msg.type === 'giphy' && msg.url ? (
                              <div className={styles.gifCard}>
                                <img
                                  src={msg.url}
                                  alt="GIF"
                                  className={styles.messageGif}
                                  onLoad={() => scrollToBottom(false)}
                                />
                              </div>
                            ) : msg.type === 'image' && msg.url ? (
                              <>
                                <div
                                  className={styles.imageCard}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setViewingImage(msg.url!);
                                    setImageZoom(1);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setContextMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      msg,
                                      isImage: true,
                                      imageUrl: msg.url!,
                                    });
                                  }}
                                  title="Clique para ampliar / Botão direito para copiar"
                                >
                                  <img
                                    src={msg.url}
                                    alt={msg.filename || 'Imagem'}
                                    className={styles.messageImage}
                                    onLoad={() => scrollToBottom(false)}
                                  />
                                </div>
                                {displayMessageText && displayMessageText !== '📷 Imagem' && (
                                  <div
                                    className={`${isMe ? styles.myBubble : styles.otherBubble} ${onlyEmojis ? styles.jumboEmoji : ''}`}
                                    dangerouslySetInnerHTML={{
                                      __html: formatMessageHtml(displayMessageText, myName),
                                    }}
                                  />
                                )}
                              </>
                            ) : msg.type === 'file' && msg.url ? (
                              <>
                                <div className={styles.fileContainer}>
                                  <a href={msg.url} target="_blank" rel="noopener noreferrer" className={styles.fileLink}>
                                    <i className="fa-solid fa-paperclip"></i>
                                    <span className={styles.fileName}>{msg.filename || 'Arquivo'}</span>
                                  </a>
                                </div>
                                {displayMessageText && displayMessageText !== '📄 ' + msg.filename && (
                                  <div
                                    className={`${isMe ? styles.myBubble : styles.otherBubble} ${onlyEmojis ? styles.jumboEmoji : ''}`}
                                    dangerouslySetInnerHTML={{
                                      __html: formatMessageHtml(displayMessageText, myName),
                                    }}
                                  />
                                )}
                              </>
                            ) : (
                              <div
                                className={`${isMe ? styles.myBubble : styles.otherBubble} ${onlyEmojis ? styles.jumboEmoji : ''}`}
                                dangerouslySetInnerHTML={{
                                  __html: formatMessageHtml(displayMessageText, myName),
                                }}
                              />
                            )}

                            {/* Reações com Emojis */}
                            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                              <div className={styles.reactionsList}>
                                {Object.entries(msg.reactions).map(([em, userList]) => {
                                  if (!userList || userList.length === 0) return null;
                                  const reacted = userList.includes(cleanMyName) || userList.includes(myName || '');
                                  return (
                                    <button
                                      key={em}
                                      type="button"
                                      className={`${styles.reactionBadge} ${reacted ? styles.reactionBadgeActive : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleReaction(msg.id, em);
                                      }}
                                      title={`Reagido por: ${userList.join(', ')}`}
                                    >
                                      <span className={styles.reactionEmoji}>{em}</span>
                                      <span className={styles.reactionCount}>{userList.length}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Staged multiple attachments preview tray (Discord Style) */}
            {stagedFiles.length > 0 && (
              <div className={styles.attachmentsTray}>
                {stagedFiles.map((staged) => (
                  <div
                    key={staged.id}
                    className={`${styles.attachmentCard} ${staged.isImage ? styles.attachmentCardImage : ''}`}
                    title={staged.file.name}
                  >
                    <button
                      type="button"
                      className={styles.attachmentRemoveBtn}
                      onClick={() => removeStagedFile(staged.id)}
                      title="Remover este arquivo"
                      aria-label="Remover este arquivo"
                    >
                      ✕
                    </button>

                    {staged.isImage ? (
                      <img src={staged.previewUrl} alt={staged.file.name} className={styles.attachmentThumb} />
                    ) : (
                      <div className={styles.attachmentFileIcon}>
                        <i className={`fa-solid ${getFileIcon(staged.file.name, staged.file.type)}`} style={{ color: '#5865f2' }}></i>
                      </div>
                    )}

                    <div className={styles.attachmentMeta}>
                      <span className={styles.attachmentName}>{staged.file.name}</span>
                      <span className={styles.attachmentSize}>{formatFileSize(staged.file.size)}</span>
                    </div>
                  </div>
                ))}

                {/* Botão de adicionar mais arquivos */}
                <button
                  type="button"
                  className={styles.attachmentAddMoreBtn}
                  onClick={() => fileInputRef.current?.click()}
                  title="Adicionar mais arquivos"
                >
                  <i className="fa-solid fa-plus" style={{ fontSize: '16px' }}></i>
                  <span>Mais</span>
                </button>
              </div>
            )}

            {/* Giphy Popover */}
            {showGiphy && (
              <div className={styles.giphyPopover} ref={giphyPickerRef}>
                <div className={styles.giphyHeader}>
                  <input
                    type="text"
                    placeholder="Buscar GIFs no Giphy..."
                    className={styles.giphySearchInput}
                    value={giphySearch}
                    onChange={(e) => setGiphySearch(e.target.value)}
                    autoFocus
                  />
                  <button
                    className={styles.closeGiphyBtn}
                    onClick={() => setShowGiphy(false)}
                  >
                    ✕
                  </button>
                </div>
                <div className={styles.giphyGridContainer}>
                  {giphyError ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center', color: '#f87171', fontSize: '13px' }}>
                      <p style={{ margin: '0 0 8px 0', fontWeight: 500 }}>Erro ao carregar GIFs.</p>
                      <p style={{ margin: '0 0 12px 0', fontSize: '11px', color: '#94a3b8' }}>{giphyError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setGiphyError(null);
                          setGiphySearch(s => s ? s : ' ');
                        }}
                        style={{
                          padding: '6px 14px',
                          background: '#5865F2',
                          color: '#fff',
                          borderRadius: '4px',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 500
                        }}
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : (
                    <Grid
                      key={giphySearch}
                      width={300}
                      columns={2}
                      fetchGifs={fetchGifs}
                      onGifClick={handleSelectGif}
                      noLink
                      hideAttribution
                    />
                  )}
                </div>
              </div>
            )}

            {/* Chat input matching prototype */}
            <div className={styles.inputContainer}>
              {/* Barra de Resposta Ativa (Discord Style) */}
              {replyingTo && (
                <div className={styles.replyBanner}>
                  <div className={styles.replyBannerContent}>
                    <i className="fa-solid fa-reply"></i>
                    <span>Respondendo a <strong>@{replyingTo.userName}</strong></span>
                    <span className={styles.replyBannerSnippet}>
                      {replyingTo.message}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.replyBannerCancel}
                    onClick={() => setReplyingTo(null)}
                    title="Cancelar resposta"
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
              )}

              {/* Aviso se a conversa de DM estiver bloqueada */}
              {isPartnerBlocked && (
                <div className={styles.blockedNoticeBanner}>
                  <i className="fa-solid fa-ban" />
                  <span>Esta conversa direta está bloqueada. Não é possível enviar mensagens para este usuário.</span>
                </div>
              )}

              {/* Barra de Progresso de Upload de Arquivo (Ilustrativa e Visível) */}
              {uploadState && (
                <div className={styles.uploadProgressContainer}>
                  <div className={styles.uploadProgressHeader}>
                    <div className={styles.uploadProgressFileInfo}>
                      <div className={styles.uploadProgressIconWrapper}>
                        <i className={`fa-solid ${getFileIcon(uploadState.fileName, '')}`}></i>
                      </div>
                      <div className={styles.uploadProgressTextGroup}>
                        <span className={styles.uploadProgressFileName} title={uploadState.fileName}>
                          {uploadState.fileName}
                        </span>
                        <span className={styles.uploadProgressFileCounter}>
                          {uploadState.totalFiles > 1
                            ? `Enviando arquivo ${uploadState.fileIndex} de ${uploadState.totalFiles}`
                            : 'Enviando arquivo para o servidor...'}
                        </span>
                      </div>
                    </div>
                    <div className={styles.uploadProgressStats}>
                      <span className={styles.uploadProgressBytes}>
                        {formatFileSize(uploadState.loaded)} / {formatFileSize(uploadState.total)}
                      </span>
                      <span className={styles.uploadProgressPercent}>{uploadState.percent}%</span>
                    </div>
                  </div>
                  <div className={styles.uploadProgressBarTrack}>
                    <div
                      className={styles.uploadProgressBarFill}
                      style={{ width: `${Math.max(4, uploadState.percent)}%` }}
                    />
                  </div>
                  <div className={styles.uploadProgressFooter}>
                    <span>
                      <i className="fa-solid fa-cloud-arrow-up" style={{ marginRight: '6px' }}></i>
                      {uploadState.percent < 100
                        ? 'Fazendo upload... Por favor, não feche o aplicativo.'
                        : 'Processando arquivo no servidor...'}
                    </span>
                    <span>{uploadState.percent}% concluído</span>
                  </div>
                </div>
              )}

              <form
                id="chatForm"
                className={`${styles.chatForm} ${isPartnerBlocked ? styles.chatFormBlocked : ''}`}
                onDragOver={(e) => {
                  if (isPartnerBlocked || isUploading) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={isPartnerBlocked || isUploading ? undefined : handleDrop}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                  disabled={isPartnerBlocked || isUploading}
                  multiple
                />

                <button
                  type="button"
                  className={styles.formIconBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isPartnerBlocked || isUploading}
                  title={isPartnerBlocked ? "Conversa bloqueada" : isUploading ? "Enviando arquivo..." : "Anexar arquivo"}
                >
                  <i className="fa-solid fa-circle-plus"></i>
                </button>

                <input
                  type="text"
                  id="chatInput"
                  className={`${styles.chatInput} ${(isPartnerBlocked || isUploading) ? styles.chatInputDisabled : ''}`}
                  disabled={isPartnerBlocked || isUploading}
                  placeholder={
                    isPartnerBlocked
                      ? 'Você não pode enviar mensagens diretas para este usuário (bloqueado).'
                      : isUploading
                      ? 'Enviando arquivo(s)... Aguarde a conclusão do envio.'
                      : isDmMode
                      ? `Conversar com ${cleanDisplayName(activeDmChat?.partnerName || (activeDmChat as any)?.other_user_name || 'amigo')}...`
                      : isServer
                      ? `Conversar em #${activeChannel.name}... (digite @ para mencionar, / para comandos)`
                      : 'Conversar na sala... (digite @ para mencionar, / para comandos)'
                  }
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onDragOver={(e) => {
                    if (isPartnerBlocked || isUploading) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={isPartnerBlocked || isUploading ? undefined : handleDrop}
                  maxLength={2000}
                />

                <div className={styles.inputActionsRight}>
                  <button
                    type="button"
                    ref={giphyBtnRef}
                    className={styles.actionBtnGiphy}
                    onClick={() => !isPartnerBlocked && !isUploading && setShowGiphy(!showGiphy)}
                    disabled={isPartnerBlocked || isUploading}
                    title={isPartnerBlocked ? "Conversa bloqueada" : "Presentear Nitro / GIFs"}
                  >
                    <i className="fa-solid fa-gift text-sm"></i>
                  </button>

                  <button
                    type="button"
                    ref={emojiBtnRef}
                    className={styles.actionBtnEmoji}
                    onClick={() => !isPartnerBlocked && !isUploading && setShowEmojiPicker(!showEmojiPicker)}
                    disabled={isPartnerBlocked || isUploading}
                    title={isPartnerBlocked ? "Conversa bloqueada" : "Emojis"}
                  >
                    <i className="fa-solid fa-face-smile text-sm"></i>
                  </button>

                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={isPartnerBlocked || (!input.trim() && stagedFiles.length === 0) || isUploading}
                    title={isPartnerBlocked ? "Conversa bloqueada" : "Enviar Mensagem (Enter)"}
                  >
                    {isUploading ? (
                      <span className={styles.spinner} />
                    ) : (
                      <i className="fa-solid fa-paper-plane text-xs"></i>
                    )}
                  </button>
                </div>
              </form>

              {showEmojiPicker && (
                <div className={styles.emojiPickerContainer} ref={emojiPickerRef}>
                  <Suspense fallback={<div style={{ padding: '16px', color: '#aaa' }}>Carregando...</div>}>
                    <EmojiPicker onEmojiClick={onEmojiClick} theme={"dark" as any} />
                  </Suspense>
                </div>
              )}

              {/* Autocomplete de Menções (@) */}
              {showMentionMenu && mentionFilter.length > 0 && (
                <div className={styles.mentionMenu} ref={mentionMenuRef}>
                  <div className={styles.mentionHeader}>
                    <span>Membros (@)</span>
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>↑↓ navegar • Enter selecionar</span>
                  </div>
                  <div className={styles.mentionList}>
                    {mentionFilter.map((m, i) => (
                      <button
                        key={m.id || m.name}
                        type="button"
                        className={`${styles.mentionItem} ${i === mentionHighlight ? styles.mentionItemActive : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyMention(m.name);
                        }}
                        onMouseEnter={() => setMentionHighlight(i)}
                      >
                        {m.avatarUrl ? (
                          <img src={m.avatarUrl} alt={m.name} className={styles.mentionAvatar} />
                        ) : (
                          <div className={styles.mentionAvatarFallback}>
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className={styles.mentionInfo}>
                          <span className={styles.mentionName}>@{m.name}</span>
                          {m.role && <span className={styles.mentionRole}>{m.role}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Slash command menu */}
              {showCmdMenu && (
                <div className={styles.cmdMenu} ref={cmdMenuRef}>
                  <div className={styles.cmdMenuHeader}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <i className="fa-solid fa-music" style={{ color: '#7c5cff' }}></i>
                      Comandos de Música
                    </span>
                    <kbd className={styles.cmdKbd}>↑↓ navegar</kbd>
                    <kbd className={styles.cmdKbd}>Enter executar</kbd>
                  </div>
                  {cmdFilter.map((c, i) => (
                    <button
                      key={c.cmd}
                      type="button"
                      className={`${styles.cmdItem} ${i === cmdHighlight ? styles.cmdItemActive : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); applyCommand(c.cmd); }}
                      onMouseEnter={() => setCmdHighlight(i)}
                    >
                      <span className={styles.cmdItemIcon}>
                        <i className={c.icon} style={{ color: c.color }}></i>
                      </span>
                      <span className={styles.cmdItemName}>{c.cmd}</span>
                      <span className={styles.cmdItemDesc}>{c.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>{/* end flipCardFront */}

          {/* ══ FACE VERSO: Video Player ══ */}
          <div className={styles.flipCardBack}>
            <div className={styles.videoPlayerContainer}>

              {/* ── Multi-Platform Media Tab Bar ── */}
              <div className={styles.mediaTabBar} role="tablist" aria-label="Navegar entre plataformas">
                {/* YouTube Tab */}
                <button
                  className={`${styles.mediaTab} ${styles.mediaTabYoutube} ${activeMediaTab === 'youtube' ? styles.mediaTabActive : ''}`}
                  onClick={() => {
                    setActiveMediaTab('youtube');
                    setActiveStreaming(null);
                    setShowVideoPlayer(true);
                    const electron = (window as any).electron;
                    if (electron?.setActiveMediaTab) electron.setActiveMediaTab('youtube');
                    if (!currentVideoId) {
                      setIsYouTubeSearchOpen(true);
                    }
                  }}
                  title="YouTube (Músicas e Vídeos)"
                >
                  <YouTubeIcon active={activeMediaTab === 'youtube'} />
                  <span className={styles.mediaTabTitle}>YouTube</span>
                  {currentVideoId && isPlaying && (
                    <span className={styles.mediaTabLiveDot} title="Reproduzindo" />
                  )}
                </button>

                {/* Netflix Tab */}
                <button
                  className={`${styles.mediaTab} ${styles.mediaTabNetflix} ${activeMediaTab === 'netflix' ? styles.mediaTabActive : ''}`}
                  onClick={() => {
                    setActiveMediaTab('netflix');
                    setActiveStreaming({ service: 'netflix' });
                    setStreamingSession('netflix', true);
                    const electron = (window as any).electron;
                    if (electron?.setActiveMediaTab && renderMedia) electron.setActiveMediaTab('netflix');
                  }}
                  title="Netflix (Beta)"
                >
                  <NetflixIcon />
                  <span className={styles.mediaTabTitle}>Netflix</span>
                  <span className={styles.mediaTabActiveBadge} title="Recurso em Beta">BETA</span>
                </button>

                {/* Prime Video Tab */}
                <button
                  className={`${styles.mediaTab} ${styles.mediaTabPrime} ${activeMediaTab === 'prime' ? styles.mediaTabActive : ''}`}
                  onClick={() => {
                    setActiveMediaTab('prime');
                    setActiveStreaming({ service: 'prime' });
                    setStreamingSession('prime', true);
                    const electron = (window as any).electron;
                    if (electron?.setActiveMediaTab && renderMedia) electron.setActiveMediaTab('prime');
                  }}
                  title="Prime (Beta)"
                >
                  <PrimeIcon />
                  <span className={styles.mediaTabTitle}>Prime</span>
                  <span className={styles.mediaTabActiveBadge} title="Recurso em Beta">BETA</span>
                </button>

                {/* Crunchyroll Tab */}
                <button
                  className={`${styles.mediaTab} ${styles.mediaTabCrunchyroll} ${(activeMediaTab as any) === 'crunchyroll' ? styles.mediaTabActive : ''}`}
                  onClick={() => {
                    (setActiveMediaTab as any)('crunchyroll');
                    setActiveStreaming({ service: 'crunchyroll' as any });
                    (setStreamingSession as any)('crunchyroll', true);
                    const electron = (window as any).electron;
                    if (electron?.setActiveMediaTab && renderMedia) electron.setActiveMediaTab('crunchyroll');
                  }}
                  title="Crunchyroll (Beta)"
                >
                  <CrunchyrollIcon />
                  <span className={styles.mediaTabTitle}>Crunchyroll</span>
                  <span className={styles.mediaTabActiveBadge} title="Recurso em Beta">BETA</span>
                </button>
                <button
                  type="button"
                  className={styles.mediaTabCloseBtn}
                  onClick={() => {
                    const electron = (window as any).electron;
                    if (electron?.setActiveMediaTab) electron.setActiveMediaTab('youtube');
                    setRenderMedia(false);
                    setShowVideoPlayer(false);
                  }}
                  title="Fechar player e voltar ao chat"
                  aria-label="Fechar player e voltar ao chat"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              {/* ── Conteúdo: Streaming (Netflix, Prime Video ou Crunchyroll) ── */}
              <div
                style={{
                  display: (activeMediaTab === 'netflix' || activeMediaTab === 'prime' || (activeMediaTab as any) === 'crunchyroll') ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  width: '100%',
                }}
              >
                {(() => {
                  const currentService: 'netflix' | 'prime' | 'crunchyroll' = (activeMediaTab === 'netflix' || activeMediaTab === 'prime' || (activeMediaTab as any) === 'crunchyroll') ? (activeMediaTab as any) : 'prime';
                  const isSessionActive = Boolean((streamingSessions as any)[currentService] || activeStreaming?.service === currentService || (watchSession?.platform === currentService));
                  const platformLabel = currentService === 'netflix' ? 'Netflix' : currentService === 'prime' ? 'Prime' : 'Crunchyroll';

                  if (!isSessionActive) {
                    return (
                      <div className={styles.streamingLauncherCard}>
                        <div className={`${styles.streamingLauncherIcon} ${currentService === 'netflix' ? styles.streamingLauncherNetflix : currentService === 'prime' ? styles.streamingLauncherPrime : styles.streamingLauncherCrunchyroll}`}>
                          {currentService === 'netflix' ? <NetflixIcon /> : currentService === 'prime' ? <i className="fa-solid fa-play" style={{ color: '#00A8E1', fontSize: '20px' }}></i> : <CrunchyrollIcon />}
                        </div>
                        <h3 className={styles.streamingLauncherTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                          <span>Sessão da {platformLabel}</span>
                          <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '6px', background: 'rgba(139, 92, 246, 0.22)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.4)' }}>BETA</span>
                        </h3>
                        <p className={styles.streamingLauncherDesc}>
                          Assista {platformLabel} com seus amigos em tempo real com suporte a Watch Party e Widevine DRM diretamente no Concord (versão Beta).
                        </p>
                        <button
                          className={`${styles.streamingLauncherBtn} ${currentService === 'netflix' ? styles.streamingLauncherBtnNetflix : currentService === 'prime' ? styles.streamingLauncherBtnPrime : styles.streamingLauncherBtnCrunchyroll}`}
                          onClick={() => {
                            setActiveStreaming({ service: currentService as any });
                            (setStreamingSession as any)(currentService, true);
                            const electron = (window as any).electron;
                            if (electron?.setActiveMediaTab && renderMedia) electron.setActiveMediaTab(currentService);
                          }}
                          title={`Iniciar ${platformLabel} (Beta)`}
                        >
                          <i className="fa-solid fa-play" style={{ marginRight: '6px' }}></i> Iniciar {platformLabel}
                        </button>
                      </div>
                    );
                  }

                  return (
                    <>
                      <div
                        className={styles.videoSlotWrapper}
                        style={{
                          position: 'relative',
                          overflow: 'hidden',
                          flex: 1,
                          minHeight: 0,
                          borderRadius: '16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: '#090a0f',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                        }}
                      >
                        <div
                          ref={streamingHostRef}
                          id="streaming-host"
                          style={{
                            position: 'relative',
                            overflow: 'hidden',
                            width: '100%',
                            height: '100%',
                            borderRadius: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {!isElectron && renderMedia ? (
                            <iframe
                              src={activeStreaming?.url || (currentService === 'netflix' ? 'https://www.netflix.com/browse' : currentService === 'prime' ? 'https://www.primevideo.com' : 'https://www.crunchyroll.com')}
                              title={platformLabel}
                              className={styles.streamingIframe}
                              allow="autoplay; encrypted-media; fullscreen"
                            />
                          ) : !renderMedia ? (
                            <div key="streaming-skeleton-wrap" className={styles.streamingSkeleton}>
                              <div
                                key="streaming-skeleton-spinner"
                                className={styles.skeletonSpinner}
                                style={{ borderTopColor: currentService === 'netflix' ? '#E50914' : currentService === 'prime' ? '#00A8E1' : '#F47521' }}
                              />
                              <p className={styles.skeletonLabel}>
                                {platformLabel}
                              </p>
                            </div>
                          ) : (
                            <div key="streaming-drm-wrap" style={{ textAlign: 'center', padding: '24px', color: '#888' }}>
                              <div
                                key="streaming-drm-spinner"
                                style={{
                                  width: '36px',
                                  height: '36px',
                                  borderRadius: '50%',
                                  borderWidth: '3px',
                                  borderStyle: 'solid',
                                  borderColor: 'rgba(255, 255, 255, 0.1)',
                                  borderTopColor: currentService === 'netflix' ? '#E50914' : currentService === 'prime' ? '#00A8E1' : '#F47521',
                                  margin: '0 auto 14px',
                                  animation: 'spin 1s linear infinite',
                                }}
                              />
                              <p style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                                Conectando {currentService === 'prime' ? 'ao' : 'à'} {platformLabel}...
                              </p>
                              <p style={{ margin: 0, fontSize: '12px', color: '#71717a' }}>
                                Navegador com Widevine DRM ativo
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Controles do Streaming (Play, Pause, Skip 10s, Sincronizar, Sair/Catálogo, Tela Cheia) */}
                      <div className={styles.videoShortcutWrapper}>
                        <p className={styles.videoShortcutLabel}>⎯⎯ Controles da {platformLabel} ⎯⎯</p>
                        <div className={styles.videoShortcutGrid}>
                          <button
                            className={`${styles.videoShortcutBtn} ${styles.videoShortcutPlay}`}
                            onClick={() => {
                              const electron = (window as any).electron;
                              if (electron?.sendStreamingCommand) electron.sendStreamingCommand('play', { service: currentService });
                              else if (electron?.streamingCommand) electron.streamingCommand('play', { service: currentService });
                              const currentSession = useAppStore.getState().watchSession || watchSession;
                              if (currentSession && currentSession.platform === currentService) {
                                onWatchSessionAction?.({ action: 'play' });
                              } else {
                                handleStartWatchParty(currentService);
                              }
                            }}
                            title="Reproduzir vídeo"
                          >
                            <i className="fa-solid fa-play"></i>
                            <span>/play</span>
                          </button>

                          <button
                            className={`${styles.videoShortcutBtn} ${styles.videoShortcutPause}`}
                            onClick={() => {
                              const electron = (window as any).electron;
                              if (electron?.sendStreamingCommand) electron.sendStreamingCommand('pause', { service: currentService });
                              else if (electron?.streamingCommand) electron.streamingCommand('pause', { service: currentService });
                              const currentSession = useAppStore.getState().watchSession || watchSession;
                              if (currentSession && currentSession.platform === currentService) {
                                onWatchSessionAction?.({ action: 'pause' });
                              }
                            }}
                            title="Pausar vídeo"
                          >
                            <i className="fa-solid fa-pause"></i>
                            <span>/pause</span>
                          </button>

                          <button
                            className={`${styles.videoShortcutBtn} ${styles.videoShortcutSkip}`}
                            onClick={() => {
                              const electron = (window as any).electron;
                              if (electron?.sendStreamingCommand) electron.sendStreamingCommand('skip', { service: currentService });
                              else if (electron?.streamingCommand) electron.streamingCommand('skip', { service: currentService });
                              const currentSession = useAppStore.getState().watchSession || watchSession;
                              if (currentSession && currentSession.platform === currentService) {
                                const elapsed = currentSession.isPlaying ? Math.max(0, (Date.now() - currentSession.lastUpdated) / 1000) : 0;
                                const newPos = (currentSession.positionSeconds || 0) + elapsed + 10;
                                onWatchSessionAction?.({ action: 'seek', positionSeconds: newPos });
                              }
                            }}
                            title="Pular 10 segundos para frente"
                          >
                            <i className="fa-solid fa-forward-step"></i>
                            <span>/skip</span>
                          </button>

                          <button
                            className={`${styles.videoShortcutBtn} ${styles.videoShortcutClear}`}
                            onClick={() => {
                              const electron = (window as any).electron;
                              if (electron?.sendStreamingCommand) electron.sendStreamingCommand('stop', { service: currentService });
                              else if (electron?.streamingCommand) electron.streamingCommand('stop', { service: currentService });
                              const currentSession = useAppStore.getState().watchSession || watchSession;
                              if (currentSession && currentSession.platform === currentService) {
                                onWatchSessionAction?.({ action: 'pause', positionSeconds: 0 });
                              }
                            }}
                            title="Limpar e resetar reprodução"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                            <span>/clear</span>
                          </button>
                        </div>

                        {/* Barra de Volume do Streaming (Netflix, Prime Video, Crunchyroll) */}
                        <div className={styles.streamingVolumeBar}>
                          <button
                            type="button"
                            className={styles.volumeMuteBtn}
                            onClick={handleToggleYtMute}
                            title={ytVol === 0 || callMuted ? "Desmutar streaming" : "Mutar streaming"}
                            aria-label={ytVol === 0 || callMuted ? "Desmutar streaming" : "Mutar streaming"}
                          >
                            <i className={`fa-solid ${ytVol === 0 || callMuted ? 'fa-volume-xmark' : ytVol < 50 ? 'fa-volume-low' : 'fa-volume-high'}`} style={{ fontSize: '13px', width: '16px', textAlign: 'center' }}></i>
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={ytVol}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              if (val > 0) prevYtVolRef.current = val;
                              setYtVol(val);
                            }}
                            className={styles.volumeSlider}
                            title={`Volume do Streaming: ${ytVol}%`}
                          />
                          <span className={styles.streamingVolumeValue}>{ytVol}%</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* ── Player area do YouTube (SEMPRE montado no DOM) ── */}
              <div
                style={{
                  display: activeMediaTab === 'youtube' ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  width: '100%',
                }}
              >
                {(() => {
                  const videoPlayerContent = (
                    <div ref={videoContainerRef} className={`${styles.videoSlotWrapper} ${!currentVideoId ? styles.hiddenSlot : ''}`}>
                      {/* Global YT Host - stays visible only when on YouTube tab */}
                      <div
                        style={{
                          display: isPiPActive ? 'none' : 'block',
                          visibility: 'visible',
                          opacity: (showVideoPlayer && currentVideoId && activeMediaTab === 'youtube') ? 1 : 0,
                          pointerEvents: (showVideoPlayer && currentVideoId && activeMediaTab === 'youtube') ? 'auto' : 'none',
                          width: '100%',
                          height: '100%'
                        }}
                      >
                        <div id="yt-host" className={styles.ytHostContainer} />
                      </div>
                      {isPiPActive && currentVideoId && (
                        <div className={styles.videoEmptyState} style={{ zIndex: 1, position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                          <div className={styles.videoEmptyIcon}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><rect x="12" y="14" width="7" height="5" rx="1" ry="1" /></svg></div>
                          <p className={styles.videoEmptyTitle}>Reproduzindo no PiP</p>
                        </div>
                      )}

                      {/* Custom Overlay Controls - always above YouTube iframe */}
                      {currentVideoId && (
                        <div className={styles.customVideoOverlay} style={{ zIndex: 100, pointerEvents: 'none' }}>
                          <div className={styles.videoOverlayTop}>
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: '85%' }}>
                              <span className={styles.videoOverlayTitle}>{activeTrackTitle}</span>
                              {currentRequestedBy && (
                                <span style={{ fontSize: '11px', color: '#cbd5e1', textShadow: '0 1px 4px rgba(0, 0, 0, 0.8)' }}>
                                  por {currentRequestedBy}
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            className={styles.centerPlayBtn}
                            onClick={() => {
                              const nextAction = isPlaying ? 'pause' : 'play';
                              executeMusicCommand(nextAction);
                            }}
                            title={isPlaying ? 'Pausar' : 'Reproduzir'}
                          >
                            <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`} style={{ fontSize: '24px' }}></i>
                          </button>

                          <div className={styles.videoOverlayBottom}>
                            <span className={styles.timeText}>{formatTime(isDraggingSeek ? seekValue : currentTime)}</span>

                            <div className={styles.seekContainer}>
                              <input
                                type="range"
                                min={0}
                                max={duration || 100}
                                step={0.1}
                                value={isDraggingSeek ? seekValue : currentTime}
                                className={styles.seekBar}
                                onMouseDown={() => {
                                  setIsDraggingSeek(true);
                                  setSeekValue(currentTime);
                                }}
                                onTouchStart={() => {
                                  setIsDraggingSeek(true);
                                  setSeekValue(currentTime);
                                }}
                                onChange={(e) => setSeekValue(parseFloat(e.target.value))}
                                onMouseUp={(e) => {
                                  setIsDraggingSeek(false);
                                  const targetTime = parseFloat((e.target as HTMLInputElement).value);
                                  seekLockRef.current = Date.now() + 1000;
                                  onMusicSeek?.(targetTime);
                                }}
                                touch-action="none"
                                onTouchEnd={(e) => {
                                  setIsDraggingSeek(false);
                                  const targetTime = parseFloat((e.target as HTMLInputElement).value);
                                  seekLockRef.current = Date.now() + 1000;
                                  onMusicSeek?.(targetTime);
                                }}
                              />
                              <div className={styles.seekTrack}>
                                <div
                                  className={styles.seekFill}
                                  style={{ width: `${Math.min(100, (((isDraggingSeek ? seekValue : currentTime) / (duration || 1)) * 100))}%` }}
                                />
                              </div>
                            </div>

                            <span className={styles.timeText}>{formatTime(duration)}</span>

                            <div className={styles.volumeContainer}>
                              <button
                                type="button"
                                className={styles.volumeMuteBtn}
                                onClick={handleToggleYtMute}
                                title={ytVol === 0 || callMuted ? "Desmutar vídeo (Restaurar volume)" : "Mutar vídeo"}
                                aria-label={ytVol === 0 || callMuted ? "Desmutar vídeo" : "Mutar vídeo"}
                              >
                                <i className={`fa-solid ${ytVol === 0 || callMuted ? 'fa-volume-xmark' : ytVol < 50 ? 'fa-volume-low' : 'fa-volume-high'}`} style={{ fontSize: '13px', width: '16px', textAlign: 'center' }}></i>
                              </button>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={ytVol}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (val > 0) prevYtVolRef.current = val;
                                  setYtVol(val);
                                }}
                                className={styles.volumeSlider}
                                title={`Volume: ${ytVol}%`}
                              />
                            </div>

                            {(() => {
                              return (
                                <div className={styles.pipButtonWrapper}>
                                  <button
                                    className={`${styles.overlayControlBtn} ${useAppStore.getState().isPiPActive ? styles.btnActive : ''}`}
                                    onClick={togglePiP}
                                    title={isElectron ? (useAppStore.getState().isPiPActive ? "Fechar PiP" : "Picture-in-Picture") : undefined}
                                    style={!isElectron ? { cursor: 'not-allowed' } : undefined}
                                  >
                                    <i className="fa-solid fa-clone" style={{ fontSize: '13px' }}></i>
                                  </button>
                                  {!isElectron && (
                                    <div className={styles.pipWebTooltip}>
                                      Apenas para <a href="https://github.com/nathatargino/Concord-Repo/releases/latest" target="_blank" rel="noopener noreferrer">Desktop</a>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Botão de Engrenagem (Configurações de Legenda e Qualidade) */}
                            <div className={styles.settingsWrapper} ref={settingsMenuRef}>
                              <button
                                className={`${styles.overlayControlBtn} ${showSettingsMenu ? styles.btnActive : ''}`}
                                onClick={() => {
                                  if (!showSettingsMenu) {
                                    setSettingsSubMenu('main');
                                    if (getYtQuality) setSelectedQuality(getYtQuality());
                                  }
                                  setShowSettingsMenu(prev => !prev);
                                }}
                                title="Configurações (Legendas e Qualidade)"
                              >
                                <i className="fa-solid fa-gear" style={{ fontSize: '13px' }}></i>
                              </button>

                              {showSettingsMenu && (
                                <div className={styles.settingsMenuOverlay}>
                                  {settingsSubMenu === 'main' ? (
                                    <div className={styles.settingsMenuList}>
                                      {/* Item Legendas */}
                                      <button
                                        className={styles.settingsMenuItem}
                                        onClick={() => {
                                          const nextState = !isCCActive;
                                          setIsCCActive(nextState);
                                          onSetCC?.(nextState);
                                        }}
                                      >
                                        <div className={styles.settingsItemLeft}>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="2" y="4" width="20" height="16" rx="2" />
                                            <path d="M7 15h4M13 15h4M7 11h10" />
                                          </svg>
                                          <span>Legendas</span>
                                        </div>
                                        <span className={`${styles.settingsBadge} ${isCCActive ? styles.badgeActive : ''}`}>
                                          {isCCActive ? 'ATIVADO' : 'DESATIVADO'}
                                        </span>
                                      </button>

                                      {/* Item Qualidade */}
                                      <button
                                        className={styles.settingsMenuItem}
                                        onClick={() => setSettingsSubMenu('quality')}
                                      >
                                        <div className={styles.settingsItemLeft}>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polygon points="12 2 2 7 12 12 22 7 12 2" />
                                            <polyline points="2 17 12 22 22 17" />
                                            <polyline points="2 12 12 17 22 12" />
                                          </svg>
                                          <span>Qualidade</span>
                                        </div>
                                        <div className={styles.settingsItemRight}>
                                          <span className={styles.settingsValueText}>
                                            {formatQualityLabel(selectedQuality)}
                                          </span>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                                        </div>
                                      </button>
                                    </div>
                                  ) : (
                                    /* Submenu de Qualidade */
                                    <div className={styles.settingsMenuList}>
                                      <button
                                        className={styles.settingsMenuBack}
                                        onClick={() => setSettingsSubMenu('main')}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                                        <span>Qualidade</span>
                                      </button>
                                      {(() => {
                                        const storeQualities = ytAvailableQualities && ytAvailableQualities.length > 0 ? ytAvailableQualities : [];
                                        const hookQualities = getYtAvailableQualities ? getYtAvailableQualities() : [];
                                        const rawList = storeQualities.length > 0 ? storeQualities : (hookQualities.length > 0 ? hookQualities : ['auto']);
                                        const allQualities = Array.from(new Set(['auto', ...rawList]));
                                        return allQualities.map((q) => (
                                          <button
                                            key={q}
                                            className={`${styles.settingsMenuItem} ${selectedQuality === q ? styles.menuItemActive : ''}`}
                                            onClick={() => {
                                              setSelectedQuality(q);
                                              onSetQuality?.(q);
                                              setShowSettingsMenu(false);
                                              setSettingsSubMenu('main');
                                            }}
                                          >
                                            <span>{formatQualityLabel(q)}</span>
                                            {selectedQuality === q && (
                                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                                            )}
                                          </button>
                                        ));
                                      })()}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <button
                              className={styles.overlayControlBtn}
                              onClick={toggleFullscreen}
                              title="Tela Cheia"
                            >
                              <i className="fa-solid fa-expand" style={{ fontSize: '13px' }}></i>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );

                  return videoPlayerContent;
                })()}

                {!currentVideoId && (
                  <div className={styles.videoEmptyState}>
                    <div className={styles.videoEmptyIcon}>
                      <IconNoVideo />
                    </div>
                    <p className={styles.videoEmptyTitle}>Nenhum vídeo tocando</p>
                    <p className={styles.videoEmptySubtitle}>
                      Adicione um vídeo do YouTube na fila do painel de streaming para assistir aqui.
                    </p>
                    <button
                      type="button"
                      className={styles.searchYouTubeEmptyBtn}
                      onClick={() => {
                        if (!inVoice) {
                          toast.error('Você precisa estar em uma call de voz para buscar e reproduzir vídeos.');
                          return;
                        }
                        setIsYouTubeSearchOpen(true);
                      }}
                    >
                      <i className="fa-solid fa-magnifying-glass"></i>
                      <span>Buscar Vídeo no YouTube</span>
                    </button>
                    <div className={styles.videoEmptyPulse} />
                  </div>
                )}

                {/* Shortcut buttons — controles de música YouTube */}
                <div className={styles.videoShortcutWrapper}>
                  <p className={styles.videoShortcutLabel}>⎯⎯ Comandos de Controle ⎯⎯</p>
                  <div className={styles.videoShortcutGrid}>
                    <button
                      className={`${styles.videoShortcutBtn} ${styles.videoShortcutPlay}`}
                      onClick={() => executeMusicCommand('play')}
                      title="Retomar música"
                    >
                      <i className="fa-solid fa-play"></i>
                      <span>/play</span>
                    </button>
                    <button
                      className={`${styles.videoShortcutBtn} ${styles.videoShortcutPause}`}
                      onClick={() => executeMusicCommand('pause')}
                      title="Pausar música"
                    >
                      <i className="fa-solid fa-pause"></i>
                      <span>/pause</span>
                    </button>
                    <button
                      className={`${styles.videoShortcutBtn} ${styles.videoShortcutSkip}`}
                      onClick={() => executeMusicCommand('skip')}
                      title="Pular música"
                    >
                      <i className="fa-solid fa-forward-step"></i>
                      <span>/skip</span>
                    </button>
                    <button
                      className={`${styles.videoShortcutBtn} ${styles.videoShortcutClear}`}
                      onClick={() => executeMusicCommand('clear')}
                      title="Limpar fila"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                      <span>/clear</span>
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>{/* end flipCardBack */}

        </div>{/* end flipCardInner */}
      </div>{/* end flipCard */}

      {/* ═══ PORTAL: LIGHTBOX / VISUALIZADOR DE IMAGEM AMPLIADA ═══ */}
      {viewingImage && createPortal(
        <div
          className={styles.lightboxOverlay}
          onClick={() => setViewingImage(null)}
        >
          <div className={styles.lightboxTopBar} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div className={styles.lightboxZoomControls} onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`${styles.lightboxBtn} ${imageZoom <= 1 ? styles.lightboxBtnDisabled : ''}`}
                disabled={imageZoom <= 1}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (imageZoom > 1) {
                    setImageZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))));
                  }
                }}
                title={imageZoom <= 1 ? "Zoom mínimo (100%)" : "Diminuir Zoom (-)"}
              >
                <i className="fa-solid fa-magnifying-glass-minus"></i>
              </button>
              <span className={styles.lightboxZoomPercent}>{Math.round(imageZoom * 100)}%</span>
              <button
                type="button"
                className={styles.lightboxBtn}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setImageZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))));
                }}
                title="Aumentar Zoom (+)"
              >
                <i className="fa-solid fa-magnifying-glass-plus"></i>
              </button>
              {imageZoom !== 1 && (
                <button
                  type="button"
                  className={styles.lightboxBtnText}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setImageZoom(1);
                  }}
                  title="Ajustar à tela (100%)"
                >
                  Ajustar (100%)
                </button>
              )}
            </div>

            <div className={styles.lightboxActions} onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={styles.lightboxBtnText}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await copyImageToClipboard(viewingImage);
                  if (ok) toast.success('Imagem copiada para a área de transferência!');
                  else toast.error('Não foi possível copiar a imagem.');
                }}
                title="Copiar imagem"
              >
                <i className="fa-regular fa-copy"></i>
                <span>Copiar Imagem</span>
              </button>

              <button
                type="button"
                className={styles.lightboxBtnText}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (viewingImage.startsWith('data:')) {
                    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
                    if (isElectron && (window as any).electron?.openBase64InBrowser) {
                      (window as any).electron.openBase64InBrowser(viewingImage);
                      return;
                    }
                  }
                  window.open(viewingImage, '_blank');
                }}
                title="Abrir no navegador"
              >
                <i className="fa-solid fa-arrow-up-right-from-square"></i>
                <span>Abrir Original</span>
              </button>

              <button
                type="button"
                className={styles.lightboxCloseBtn}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingImage(null);
                }}
                title="Fechar (Esc)"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>

          <div
            className={styles.lightboxViewport}
            onClick={() => setViewingImage(null)}
          >
            <div
              className={styles.lightboxImageContainer}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={viewingImage}
                className={`${styles.lightboxImage} ${imageZoom > 1 ? styles.lightboxImageZoomed : ''}`}
                style={imageZoom > 1 ? { transform: `scale(${imageZoom})`, transformOrigin: 'center center' } : {}}
                onClick={() => setImageZoom((z) => (z === 1 ? 2 : 1))}
                title={imageZoom === 1 ? 'Clique para ampliar (2x)' : 'Clique para ajustar à tela'}
                alt="Visualização de imagem"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ═══ PORTAL: MENU DE CONTEXTO (RIGHT-CLICK) ═══ */}
      {contextMenu && createPortal(
        <div
          className={styles.contextMenuOverlay}
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className={styles.contextMenu}
            style={{
              top: Math.min(contextMenu.y, window.innerHeight - 260),
              left: Math.min(contextMenu.x, window.innerWidth - 220),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Quick Reactions Bar */}
            <div className={styles.contextMenuQuickReactions}>
              {['👍', '❤️', '😂', '🔥', '🚀'].map((em) => (
                <button
                  key={em}
                  type="button"
                  className={styles.contextMenuEmojiBtn}
                  onClick={() => {
                    handleToggleReaction(contextMenu.msg.id, em);
                    setContextMenu(null);
                  }}
                  title={`Reagir com ${em}`}
                >
                  {em}
                </button>
              ))}
            </div>

            <div className={styles.contextMenuDivider} />

            <button
              type="button"
              className={styles.contextMenuItem}
              onClick={() => handleStartReply(contextMenu.msg)}
            >
              <i className="fa-solid fa-reply"></i>
              <span>Responder</span>
            </button>

            {contextMenu.isImage && contextMenu.imageUrl && (
              <>
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={async () => {
                    setContextMenu(null);
                    const ok = await copyImageToClipboard(contextMenu.imageUrl!);
                    if (ok) toast.success('Imagem copiada para a área de transferência!');
                    else toast.error('Não foi possível copiar a imagem.');
                  }}
                >
                  <i className="fa-regular fa-copy"></i>
                  <span>Copiar Imagem</span>
                </button>

                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={() => {
                    setViewingImage(contextMenu.imageUrl!);
                    setImageZoom(1);
                    setContextMenu(null);
                  }}
                >
                  <i className="fa-solid fa-expand"></i>
                  <span>Ver em Tela Cheia</span>
                </button>

                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={() => {
                    setContextMenu(null);
                    const url = contextMenu.imageUrl!;
                    if (url.startsWith('data:')) {
                      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
                      if (isElectron && (window as any).electron?.openBase64InBrowser) {
                        (window as any).electron.openBase64InBrowser(url);
                        return;
                      }
                    }
                    window.open(url, '_blank');
                  }}
                >
                  <i className="fa-solid fa-arrow-up-right-from-square"></i>
                  <span>Abrir no Navegador</span>
                </button>
              </>
            )}

            {contextMenu.msg.message && (
              <button
                type="button"
                className={styles.contextMenuItem}
                onClick={() => {
                  const parsed = parseReplyMessage(contextMenu.msg.message);
                  const textToCopy = parsed ? parsed.actualText : contextMenu.msg.message;
                  navigator.clipboard.writeText(textToCopy);
                  toast.success('Texto copiado!');
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-clipboard"></i>
                <span>Copiar Texto</span>
              </button>
            )}

            {isDmMode && activeDmChat && (
              <>
                <div className={styles.contextMenuDivider} />

                {/* Silenciar / Reativar Conversa */}
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  onClick={() => {
                    const partnerName = cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || 'Usuário');
                    const isNowMuted = toggleMuteDm(activeDmChat.id, partnerName);
                    if (isNowMuted) {
                      toast(`Notificações de ${partnerName} silenciadas.`, { icon: '🔕' });
                    } else {
                      toast.success(`Notificações de ${partnerName} reativadas!`);
                    }
                    setContextMenu(null);
                  }}
                >
                  <i className={`fa-solid ${isDmMuted(activeDmChat.id, activeDmChat.partnerName) ? 'fa-bell' : 'fa-bell-slash'}`}></i>
                  <span>
                    {isDmMuted(activeDmChat.id, activeDmChat.partnerName)
                      ? 'Reativar Notificações'
                      : 'Silenciar Conversa'}
                  </span>
                </button>

                {/* Excluir Esta Mensagem Individual */}
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  style={{ color: '#f87171' }}
                  onClick={() => {
                    const targetMsgId = contextMenu.msg.id;
                    const partnerName = cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || 'Usuário');
                    setDmMessages((prev) => prev.filter((m) => m.id !== targetMsgId));
                    deleteDmMessage(targetMsgId, activeDmChat.id, partnerName);
                    toast.success('Mensagem excluída.');
                    setContextMenu(null);
                  }}
                >
                  <i className="fa-regular fa-trash-can" style={{ color: '#f87171' }}></i>
                  <span>Excluir Mensagem</span>
                </button>

                {/* Excluir Conversa Inteira */}
                <button
                  type="button"
                  className={styles.contextMenuItem}
                  style={{ color: '#ef4444', fontWeight: 600 }}
                  onClick={() => {
                    const partnerName = cleanDisplayName(activeDmChat.partnerName || (activeDmChat as any).other_user_name || 'Usuário');
                    const chatId = activeDmChat.id;
                    setContextMenu(null);
                    showConfirmModal({
                      title: 'Excluir Conversa',
                      message: `Tem certeza que deseja excluir toda a conversa com ${partnerName}? Esta ação apagará todas as mensagens e não pode ser desfeita.`,
                      confirmText: 'Excluir Conversa',
                      cancelText: 'Cancelar',
                      isDanger: true,
                      onConfirm: () => {
                        deleteDmConversation(chatId, partnerName);
                        toast.success('Conversa excluída com sucesso.');
                      },
                    });
                  }}
                >
                  <i className="fa-solid fa-trash" style={{ color: '#ef4444' }}></i>
                  <span>Excluir Conversa</span>
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
