import React, { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import toast from 'react-hot-toast';

import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import type { ChatMessage } from '../types';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import styles from './ChatPanel.module.css';
import { fetchChannelMessages, saveMessageToSupabase } from '../lib/supabase';
import { NetflixIcon, PrimeIcon, YouTubeIcon } from './MusicPanel';

const EmojiPicker = lazy(() => import('emoji-picker-react'));


const IconNoVideo = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// Using Giphy API Key from .env or fallback
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || '';
const gf = new GiphyFetch(GIPHY_API_KEY || 'GlVGYHqc3SyCEGpo3sZa1n5aD1bZ0vE4');
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://concord-repo.onrender.com' : 'http://localhost:3001');

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

interface ChatPanelProps {
  onSendMessage?: (msg: string, type?: 'text' | 'image' | 'giphy' | 'file', url?: string, filename?: string, channelId?: string, avatarUrl?: string | null) => void;
  onMusicAction?: (action: 'skip' | 'pause' | 'play' | 'clear') => void;
  onMusicSeek?: (time: number) => void;
  getYtCurrentTime?: () => number;
  getYtDuration?: () => number;
  onSetCC?: (enabled: boolean) => void;
  onSetQuality?: (quality: string) => void;
  getYtAvailableQualities?: () => string[];
  getYtQuality?: () => string;
}

export function ChatPanel({ onSendMessage, onMusicAction, onMusicSeek, getYtCurrentTime, getYtDuration, onSetCC, onSetQuality, getYtAvailableQualities, getYtQuality }: ChatPanelProps) {
  const {
    messages,
    setMessages,
    myName,
    myAvatarUrl,
    room,
    isServer,
    channels,
    activeChannelId,
    currentVideoId,
    currentTrackTitle,
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
  } = useAppStore();

  const { ytVol, setYtVol, callMuted } = useAudioStore();

  const [input, setInput] = useState('');
  const [showGiphy, setShowGiphy] = useState(false);
  const [giphySearch, setGiphySearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [stagedFile, setStagedFile] = useState<{ file: File, previewUrl: string } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState<number>(1);
  const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;

  // ── Aviso no chat para comandos de áudio (/play, /pause, /skip, /clear) ──
  const broadcastAudioCommandNotice = useCallback((action: 'play' | 'pause' | 'skip' | 'clear') => {
    const currentChannel = activeChannelId || 'ch-geral';
    const noticeText = `O usuário ${myName || 'Anônimo'} executou o comando /${action}`;

    if (room?.id) {
      saveMessageToSupabase(room.id, 'Sistema', noticeText, currentChannel, 'text');
    }

    onSendMessage?.(noticeText, 'text', undefined, undefined, currentChannel, null);
  }, [activeChannelId, myName, onSendMessage, room?.id]);

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
        }
      });
      return unsub;
    }
  }, [setActiveStreaming, setActiveMediaTab, setStreamingSession]);

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

    const isStreamingTab = activeMediaTab === 'netflix' || activeMediaTab === 'prime';

    if (!showVideoPlayer || !isStreamingTab || !renderMedia) {
      if (electron.setActiveMediaTab) {
        electron.setActiveMediaTab(showVideoPlayer ? activeMediaTab : 'youtube');
      }
      return;
    }

    let isCancelled = false;

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
        await electron.openStreamingView({
          service: activeMediaTab,
          url: activeStreaming?.service === activeMediaTab ? activeStreaming.url : undefined,
          bounds,
          borderRadius: 16,
        });
        if (!isCancelled) {
          setStreamingSession(activeMediaTab, true);
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
    if (val.startsWith('/') && val.length >= 1) {
      const q = val.toLowerCase();
      const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q));
      setCmdFilter(filtered);
      setShowCmdMenu(filtered.length > 0);
      setCmdHighlight(0);
    } else {
      setShowCmdMenu(false);
    }
  };

  const applyCommand = (cmd: string) => {
    const action = cmd.replace('/', '') as 'skip' | 'pause' | 'play' | 'clear';
    if (onMusicAction) onMusicAction(action);
    setInput('');
    setShowCmdMenu(false);
  };

  // Navegação por teclado no menu de comandos
  const handleKeyDown = (e: React.KeyboardEvent) => {
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

  // Carregar mensagens persistentes do canal via Supabase/Local cache
  useEffect(() => {
    if (!room?.id) return;
    const chId = isServer ? (activeChannelId || 'ch-geral') : null;

    fetchChannelMessages(room.id, chId).then((history) => {
      if (history && history.length > 0) {
        const loaded: ChatMessage[] = history.map((m) => {
          const isSystem = m.sender_name === 'Sistema' || (m.msg_type as string) === 'system' || (typeof m.content === 'string' && m.content.startsWith('O usuário ') && m.content.includes(' executou o comando /'));
          return {
            id: m.id,
            userName: isSystem ? 'Sistema' : m.sender_name,
            message: m.content,
            timestamp: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            type: m.msg_type,
            url: m.file_url || undefined,
            filename: m.file_name || undefined,
            channelId: m.channel_id || 'ch-geral',
            isSystem,
          };
        });
        setMessages(loaded);
      }
    });
  }, [room?.id, activeChannelId, isServer, setMessages]);

  // Filtrar mensagens para o canal atual (em servidores)
  const channelMessages = useMemo(() => {
    if (!isServer) return messages;
    const currentChannel = activeChannelId || 'ch-geral';
    return messages.filter(
      (m) => (m.channelId || 'ch-geral') === currentChannel || (currentChannel === 'ch-geral' && !m.channelId)
    );
  }, [messages, isServer, activeChannelId]);

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

  const scrollToBottom = useCallback((smooth = true) => {
    if (messageListRef.current) {
      messageListRef.current.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

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

  // Timers múltiplos de alinhamento suave ao entrar no servidor ou mudar de canal
  useEffect(() => {
    if (!searchQuery) {
      scrollToBottom(false);
      const t1 = setTimeout(() => scrollToBottom(false), 50);
      const t2 = setTimeout(() => scrollToBottom(false), 150);
      const t3 = setTimeout(() => scrollToBottom(true), 350);
      const t4 = setTimeout(() => scrollToBottom(true), 700);
      const t5 = setTimeout(() => scrollToBottom(true), 1200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
        clearTimeout(t5);
      };
    }
  }, [displayedMessages.length, activeChannelId, searchQuery, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed && !stagedFile) return;

    // Interceptação direta dos comandos de música
    if (!stagedFile && trimmed.startsWith('/')) {
      const cmd = trimmed.toLowerCase();
      if (cmd === '/pause' || cmd === '/play' || cmd === '/skip' || cmd === '/clear') {
        const action = cmd.replace('/', '') as 'skip' | 'pause' | 'play' | 'clear';
        broadcastAudioCommandNotice(action);
        if (onMusicAction) {
          onMusicAction(action);
        }
        if (action === 'clear') {
          const store = useAppStore.getState();
          if (store.isPiPActive) {
            const electron = (window as any).electron;
            if (electron?.closePipWindow) electron.closePipWindow();
            store.setPiPActive(false);
          }
        }
        setInput('');
        return;
      }
    }

    const currentChannel = activeChannelId || 'ch-geral';

    if (stagedFile) {
      setIsUploading(true);
      try {
        const isImage = stagedFile.file.type.startsWith('image/');
        let fileUrl = '';
        const fileName = stagedFile.file.name;

        if (isImage) {
          // Imagens convertidas para Base64 Data URL: permanente e instantanea
          fileUrl = await fileToBase64(stagedFile.file);
        } else {
          // Outros arquivos: tenta upload com fallback Base64
          try {
            const formData = new FormData();
            formData.append('file', stagedFile.file);
            const res = await fetch(`${SERVER_URL}/api/upload`, {
              method: 'POST',
              body: formData,
            });
            if (res.ok) {
              const data = await res.json();
              fileUrl = `${SERVER_URL}${data.url}`;
            } else {
              fileUrl = await fileToBase64(stagedFile.file);
            }
          } catch {
            fileUrl = await fileToBase64(stagedFile.file);
          }
        }

        const msgText = trimmed || (isImage ? '📷 Imagem' : `📄 ${fileName}`);
        const msgType = isImage ? 'image' : 'file';

        // Salvar no Supabase
        if (room?.id) {
          saveMessageToSupabase(room.id, myName, msgText, currentChannel, msgType, fileUrl, fileName);
        }

        onSendMessage?.(msgText, msgType, fileUrl, fileName, currentChannel, myAvatarUrl);

        URL.revokeObjectURL(stagedFile.previewUrl);
        setStagedFile(null);
      } catch (err) {
        console.error('Erro no upload/conversao de arquivo:', err);
        alert('Falha ao processar o arquivo.');
      } finally {
        setIsUploading(false);
      }
    } else {
      // Salvar no Supabase
      if (room?.id) {
        saveMessageToSupabase(room.id, myName, trimmed, currentChannel, 'text');
      }

      onSendMessage?.(trimmed, 'text', undefined, undefined, currentChannel, myAvatarUrl);
    }

    setInput('');
  }, [input, stagedFile, onSendMessage, onMusicAction, activeChannelId, room?.id, myName]);


  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          stageFile(file);
          break;
        }
      }
    }
  };

  const stageFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      alert('O arquivo deve ter no máximo 5MB');
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setStagedFile({ file, previewUrl });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stageFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      stageFile(file);
    }
  };

  const handleSelectGif = (gif: any) => {
    const gifUrl = gif.images.fixed_height.url;
    const currentChannel = activeChannelId || 'ch-geral';

    if (room?.id) {
      saveMessageToSupabase(room.id, myName, 'GIF', currentChannel, 'giphy', gifUrl);
    }

    onSendMessage?.('GIF', 'giphy', gifUrl, undefined, currentChannel, myAvatarUrl);
    setShowGiphy(false);
  };

  const fetchGifs = (offset: number) => {
    if (giphySearch.trim()) {
      return gf.search(giphySearch, { offset, limit: 10 });
    }
    return gf.trending({ offset, limit: 10 });
  };

  return (
    <div
      className={`${styles.chatPanel} ${isDragging ? styles.dragging : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── CABEÇALHO DO CHAT (PROTÓTIPO) ── */}
      <div className={styles.chatHeader}>
        <div className={styles.headerLeft}>
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
        </div>

        <div className={styles.headerActions}>
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

          {/* Botão de alternar entre Chat e Streaming quando há streaming ativo ou player aberto */}
          {((Boolean(activeStreaming || streamingSessions.netflix || streamingSessions.prime || currentVideoId)) || showVideoPlayer) && (
            <button
              className={`${styles.watchBtn} ${showVideoPlayer ? styles.watchBtnActive : ''}`}
              onClick={() => {
                if (showVideoPlayer) {
                  setRenderMedia(false);
                  setShowVideoPlayer(false);
                } else {
                  setShowVideoPlayer(true);
                }
              }}
              title={showVideoPlayer ? 'Voltar ao Chat' : 'Voltar ao Streaming'}
            >
              <i className={`fa-solid ${showVideoPlayer ? 'fa-arrow-left' : 'fa-tv'}`}></i>
              <span>{showVideoPlayer ? 'Chat' : 'Streaming'}</span>
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
            <div ref={messageListRef} className={styles.messageList}>
              {displayedMessages.length === 0 ? (
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
                displayedMessages.map((msg) => {
                  const isSystemMsg = Boolean(msg.isSystem || msg.userName === 'Sistema' || (typeof msg.message === 'string' && msg.message.startsWith('O usuário ') && msg.message.includes(' executou o comando /')));
                  const cleanMyName = (myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '').trim().toLowerCase();
                  const cleanMsgUser = (msg.userName || '').trim().toLowerCase();
                  const isMe = !isSystemMsg && Boolean(cleanMyName && cleanMsgUser && cleanMyName === cleanMsgUser);
                  const displayAvatar = isMe ? (myAvatarUrl || msg.avatarUrl) : msg.avatarUrl;
                  return (
                    <div
                      key={msg.id}
                      className={isSystemMsg ? styles.systemWrapper : `${styles.messageRow} ${isMe ? styles.messageRowMe : styles.messageRowOther}`}
                    >
                      {isSystemMsg ? (
                        <div className={styles.systemMessage}>
                          <span className={styles.systemMessageIcon}>⚙️</span>
                          <span>{msg.message}</span>
                        </div>
                      ) : (
                        <>
                          {displayAvatar ? (
                            <img
                              src={displayAvatar}
                              alt={msg.userName}
                              className={`${styles.messageAvatar} ${isMe ? styles.messageAvatarMe : ''}`}
                            />
                          ) : (
                            <div className={styles.messageAvatarFallback}>
                              {msg.userName.substring(0, 2).toUpperCase()}
                            </div>
                          )}

                          <div className={styles.messageContentCol}>
                            <div className={styles.messageUserHeader}>
                              <span className={styles.senderName}>
                                {msg.userName}
                                {isMe && <span className={styles.meBadge}>VOCÊ</span>}
                              </span>
                              <span className={styles.timestamp}>{msg.timestamp || 'Hoje'}</span>
                            </div>

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
                                >
                                  <img
                                    src={msg.url}
                                    alt={msg.filename || 'Imagem'}
                                    className={styles.messageImage}
                                    onLoad={() => scrollToBottom(false)}
                                  />
                                </div>
                                {msg.message && msg.message !== '📷 Imagem' && (
                                  <div
                                    className={isMe ? styles.myBubble : styles.otherBubble}
                                    dangerouslySetInnerHTML={{
                                      __html: parseLinks(escapeHtml(msg.message)),
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
                                {msg.message && msg.message !== '📄 ' + msg.filename && (
                                  <div
                                    className={isMe ? styles.myBubble : styles.otherBubble}
                                    dangerouslySetInnerHTML={{
                                      __html: parseLinks(escapeHtml(msg.message)),
                                    }}
                                  />
                                )}
                              </>
                            ) : (
                              <div
                                className={isMe ? styles.myBubble : styles.otherBubble}
                                dangerouslySetInnerHTML={{
                                  __html: parseLinks(escapeHtml(msg.message)),
                                }}
                              />
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

            {/* Staged file preview */}
            {stagedFile && (
              <div className={styles.previewContainer}>
                {stagedFile.file.type.startsWith('image/') ? (
                  <img src={stagedFile.previewUrl} alt="Preview" className={styles.filePreviewThumb} />
                ) : (
                  <div className={styles.genericFilePreview}>
                    <span>📄</span>
                  </div>
                )}
                <div className={styles.previewDetails}>
                  <span className={styles.previewName}>{stagedFile.file.name}</span>
                  <span className={styles.previewSize}>
                    {(stagedFile.file.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <button
                  className={styles.removeFileBtn}
                  onClick={() => {
                    URL.revokeObjectURL(stagedFile.previewUrl);
                    setStagedFile(null);
                  }}
                >
                  ✕
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
                  <Grid
                    key={giphySearch}
                    width={300}
                    columns={2}
                    fetchGifs={fetchGifs}
                    onGifClick={handleSelectGif}
                    noLink
                    hideAttribution
                  />
                </div>
              </div>
            )}

            {/* Chat input matching prototype */}
            <div className={styles.inputContainer}>
              <form
                id="chatForm"
                className={styles.chatForm}
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
                />

                <button
                  type="button"
                  className={styles.formIconBtn}
                  onClick={() => fileInputRef.current?.click()}
                  title="Anexar arquivo"
                >
                  <i className="fa-solid fa-circle-plus"></i>
                </button>

                <input
                  type="text"
                  id="chatInput"
                  className={styles.chatInput}
                  placeholder={
                    isServer
                      ? `Conversar em #${activeChannel.name}... (digite / para comandos)`
                      : 'Conversar na sala... (digite / para comandos)'
                  }
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  maxLength={2000}
                />

                <div className={styles.inputActionsRight}>
                  <button
                    type="button"
                    ref={giphyBtnRef}
                    className={styles.actionBtnGiphy}
                    onClick={() => setShowGiphy(!showGiphy)}
                    title="Presentear Nitro / GIFs"
                  >
                    <i className="fa-solid fa-gift text-sm"></i>
                  </button>

                  <button
                    type="button"
                    ref={emojiBtnRef}
                    className={styles.actionBtnEmoji}
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    title="Emojis"
                  >
                    <i className="fa-solid fa-face-smile text-sm"></i>
                  </button>

                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={(!input.trim() && !stagedFile) || isUploading}
                    title="Enviar Mensagem (Enter)"
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

            {viewingImage && (
              <div className={styles.imageViewerOverlay} onClick={() => setViewingImage(null)}>
                <div className={styles.imageViewerControls} onClick={(e) => e.stopPropagation()}>
                  <a
                    href={viewingImage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.imageViewerLink}
                    onClick={(e) => {
                      if (viewingImage.startsWith('data:')) {
                        e.preventDefault();

                        const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
                        if (isElectron && (window as any).electron?.openBase64InBrowser) {
                          (window as any).electron.openBase64InBrowser(viewingImage);
                          return;
                        }

                        fetch(viewingImage)
                          .then(res => res.blob())
                          .then(blob => {
                            const blobUrl = URL.createObjectURL(blob);
                            window.open(blobUrl, '_blank');
                          })
                          .catch(() => {
                            window.open(viewingImage, '_blank');
                          });
                      }
                    }}
                  >
                    Abrir Original
                  </a>
                  <button className={styles.imageViewerClose} onClick={() => setViewingImage(null)}>×</button>
                </div>
                <img
                  src={viewingImage}
                  className={`${styles.imageViewerImage} ${imageZoom > 1 ? styles.zoomed : ''}`}
                  style={{ transform: `scale(${imageZoom})` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setImageZoom(z => z === 1 ? 2 : 1);
                  }}
                  alt="Ampliada"
                />
              </div>
            )}

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
                    if (electron?.setActiveMediaTab) electron.setActiveMediaTab('netflix');
                  }}
                  title="Netflix"
                >
                  <NetflixIcon />
                  <span className={styles.mediaTabTitle}>Netflix</span>
                  {streamingSessions.netflix && (
                    <span className={styles.mediaTabActiveBadge} title="Sessão ativa">Ativo</span>
                  )}
                </button>

                {/* Prime Video Tab */}
                <button
                  className={`${styles.mediaTab} ${styles.mediaTabPrime} ${activeMediaTab === 'prime' ? styles.mediaTabActive : ''}`}
                  onClick={() => {
                    setActiveMediaTab('prime');
                    setActiveStreaming({ service: 'prime' });
                    setStreamingSession('prime', true);
                    const electron = (window as any).electron;
                    if (electron?.setActiveMediaTab) electron.setActiveMediaTab('prime');
                  }}
                  title="Prime Video"
                >
                  <PrimeIcon />
                  <span className={styles.mediaTabTitle}>Prime Video</span>
                  {streamingSessions.prime && (
                    <span className={styles.mediaTabActiveBadge} title="Sessão ativa">Ativo</span>
                  )}
                </button>
              </div>

              {/* ── Conteúdo: Streaming (Netflix ou Prime Video) ── */}
              <div
                style={{
                  display: (activeMediaTab === 'netflix' || activeMediaTab === 'prime') ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  width: '100%',
                }}
              >
                {(() => {
                  const currentService = activeMediaTab === 'netflix' || activeMediaTab === 'prime' ? activeMediaTab : 'prime';
                  const isSessionActive = Boolean(streamingSessions[currentService] || activeStreaming?.service === currentService);
                  const platformLabel = currentService === 'netflix' ? 'Netflix' : 'Prime Video';

                  if (!isSessionActive) {
                    return (
                      <div className={styles.streamingLauncherCard}>
                        <div className={`${styles.streamingLauncherIcon} ${currentService === 'netflix' ? styles.streamingLauncherNetflix : styles.streamingLauncherPrime}`}>
                          {currentService === 'netflix' ? <NetflixIcon /> : <i className="fa-solid fa-play" style={{ color: '#00A8E1', fontSize: '20px' }}></i>}
                        </div>
                        <h3 className={styles.streamingLauncherTitle}>
                          Sessão da {platformLabel} não iniciada
                        </h3>
                        <p className={styles.streamingLauncherDesc}>
                          Inicie a {platformLabel} no Concord com suporte a DRM Widevine para assistir seus filmes e séries sem sair do app.
                        </p>
                        <button
                          className={`${styles.streamingLauncherBtn} ${currentService === 'netflix' ? styles.streamingLauncherBtnNetflix : styles.streamingLauncherBtnPrime}`}
                          onClick={() => {
                            if (!inVoice) {
                              toast.error(`Você precisa estar em uma call de voz para assistir ${platformLabel}.`);
                              return;
                            }
                            setActiveStreaming({ service: currentService });
                            setActiveMediaTab(currentService);
                            setStreamingSession(currentService, true);
                            const electron = (window as any).electron;
                            if (electron?.setActiveMediaTab) {
                              electron.setActiveMediaTab(currentService);
                            }
                          }}
                        >
                          <span>▶</span> Abrir {platformLabel} no Concord
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
                              src={activeStreaming?.url || (currentService === 'netflix' ? 'https://www.netflix.com/browse' : 'https://www.primevideo.com')}
                              title={platformLabel}
                              className={styles.streamingIframe}
                              allow="autoplay; encrypted-media; fullscreen"
                            />
                          ) : !renderMedia ? (
                            <div key="streaming-skeleton-wrap" className={styles.streamingSkeleton}>
                              <div
                                key="streaming-skeleton-spinner"
                                className={styles.skeletonSpinner}
                                style={{ borderTopColor: currentService === 'netflix' ? '#E50914' : '#00A8E1' }}
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
                                  borderTopColor: currentService === 'netflix' ? '#E50914' : '#00A8E1',
                                  margin: '0 auto 14px',
                                  animation: 'spin 1s linear infinite',
                                }}
                              />
                              <p style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                                Conectando ao {platformLabel}...
                              </p>
                              <p style={{ margin: 0, fontSize: '12px', color: '#71717a' }}>
                                Navegador com Widevine DRM ativo
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Controles do Streaming (Play, Pause, Skip 10s, Sair/Catálogo, Tela Cheia) */}
                      <div className={styles.videoShortcutWrapper}>
                        <p className={styles.videoShortcutLabel}>⎯⎯ Controles da {platformLabel} ⎯⎯</p>
                        <div className={styles.videoShortcutGrid}>
                          <button
                            className={`${styles.videoShortcutBtn} ${styles.videoShortcutPlay}`}
                            onClick={() => {
                              const electron = (window as any).electron;
                              if (electron?.sendStreamingCommand) electron.sendStreamingCommand('play', { service: currentService });
                              else if (electron?.streamingCommand) electron.streamingCommand('play', { service: currentService });
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
                              if (electron?.sendStreamingCommand) electron.sendStreamingCommand('exit', { service: currentService });
                              else if (electron?.streamingCommand) electron.streamingCommand('exit', { service: currentService });
                              setRenderMedia(false);
                              setShowVideoPlayer(false);
                            }}
                            title="Sair da transmissão e voltar ao chat"
                          >
                            <i className="fa-solid fa-arrow-left"></i>
                            <span>Sair</span>
                          </button>

                          <button
                            className={`${styles.videoShortcutBtn} ${styles.videoShortcutFullscreen}`}
                            onClick={() => {
                              const electron = (window as any).electron;
                              if (electron?.sendStreamingCommand) electron.sendStreamingCommand('fullscreen', { service: currentService });
                              else if (electron?.streamingCommand) electron.streamingCommand('fullscreen', { service: currentService });
                            }}
                            title="Tela Cheia"
                          >
                            <i className="fa-solid fa-expand"></i>
                            <span>Tela Cheia</span>
                          </button>
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
                          <span className={styles.videoOverlayTitle}>{activeTrackTitle}</span>
                        </div>

                        <button
                          className={styles.centerPlayBtn}
                          onClick={() => {
                            const nextAction = isPlaying ? 'pause' : 'play';
                            broadcastAudioCommandNotice(nextAction);
                            onMusicAction?.(nextAction);
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
                              <i className={`fa-solid ${ytVol === 0 || callMuted ? 'fa-volume-xmark' : ytVol < 50 ? 'fa-volume-low' : 'fa-volume-high'}`} style={{ fontSize: '13px', width: '16px', textAlign: 'center' }}></i>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={ytVol}
                                onChange={(e) => setYtVol(parseInt(e.target.value))}
                                className={styles.volumeSlider}
                                title="Volume"
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
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
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
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
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
                                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
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
                    onClick={() => {
                      broadcastAudioCommandNotice('play');
                      onMusicAction?.('play');
                    }}
                    title="Retomar música"
                  >
                    <i className="fa-solid fa-play"></i>
                    <span>/play</span>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutPause}`}
                    onClick={() => {
                      broadcastAudioCommandNotice('pause');
                      onMusicAction?.('pause');
                    }}
                    title="Pausar música"
                  >
                    <i className="fa-solid fa-pause"></i>
                    <span>/pause</span>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutSkip}`}
                    onClick={() => {
                      broadcastAudioCommandNotice('skip');
                      onMusicAction?.('skip');
                    }}
                    title="Pular música"
                  >
                    <i className="fa-solid fa-forward-step"></i>
                    <span>/skip</span>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutClear}`}
                    onClick={() => {
                      broadcastAudioCommandNotice('clear');
                      onMusicAction?.('clear');
                      const store = useAppStore.getState();
                      if (store.isPiPActive) {
                        const electron = (window as any).electron;
                        if (electron?.closePipWindow) electron.closePipWindow();
                        store.setPiPActive(false);
                      }
                    }}
                    title="Limpar fila"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                    <span>/clear</span>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutClear}`}
                    onClick={() => {
                      setRenderMedia(false);
                      setShowVideoPlayer(false);
                    }}
                    title="Voltar ao chat"
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                    <span>Sair</span>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutFullscreen}`}
                    onClick={toggleFullscreen}
                    title="Tela Cheia"
                  >
                    <i className="fa-solid fa-expand"></i>
                    <span>Tela Cheia</span>
                  </button>
                </div>
              </div>
            </div>

            </div>
          </div>{/* end flipCardBack */}

        </div>{/* end flipCardInner */}
      </div>{/* end flipCard */}
    </div>
  );
};
