import React, { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';

import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import type { ChatMessage } from '../types';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import styles from './ChatPanel.module.css';
import { fetchChannelMessages, saveMessageToSupabase } from '../lib/supabase';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

// SVG Icons para o player de vídeo
const IconVideo = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const IconArrowLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

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
    isBuffering,
    isPiPActive,
    isPlaying,
    musicStartTime,
    setVisualizerActive,
    activeStreaming,
    setActiveStreaming,
    ytAvailableQualities
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

  // ── Video Player Flip ──
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  // renderMedia becomes true only AFTER the flip transition ends (lazy mount)
  const [renderMedia, setRenderMedia] = useState(false);
  const streamingHostRef = useRef<HTMLDivElement>(null);

  // Auto flip when streaming is opened; reset renderMedia so skeleton shows during spin
  useEffect(() => {
    if (activeStreaming) {
      if (showVideoPlayer) {
        setRenderMedia(true);
      } else {
        setRenderMedia(false);
        setShowVideoPlayer(true);
      }
    } else {
      setRenderMedia(false);
    }
  }, [activeStreaming]);

  // Fallback timer: if onTransitionEnd fails to fire within 850ms, ensure media mounts
  useEffect(() => {
    if (showVideoPlayer && activeStreaming) {
      const timer = setTimeout(() => {
        setRenderMedia(true);
      }, 850);
      return () => clearTimeout(timer);
    } else if (!showVideoPlayer) {
      setRenderMedia(false);
    }
  }, [showVideoPlayer, activeStreaming]);

  // Synchronize Electron WebContentsView / BrowserView.
  // Mounts/opens ONLY once renderMedia is true (i.e. after the flip animation finishes).
  useEffect(() => {
    const electron = (window as any).electron;
    if (!activeStreaming || !renderMedia) {
      if (electron?.closeStreamingView) {
        electron.closeStreamingView();
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
          service: activeStreaming.service,
          url: activeStreaming.url,
          bounds,
          borderRadius: 16,
        });
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
      if (electron?.closeStreamingView) {
        electron.closeStreamingView();
      }
    };
  }, [activeStreaming, renderMedia]);

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

  // Auto-fechar o player e o PiP quando o vídeo parar de tocar (exceto se houver streaming ativo)
  useEffect(() => {
    if (!currentVideoId && !activeStreaming) {
      if (showVideoPlayer) {
        setShowVideoPlayer(false);
      }
      const store = useAppStore.getState();
      if (store.isPiPActive) {
        const electron = (window as any).electron;
        if (electron?.closePipWindow) electron.closePipWindow();
        store.setPiPActive(false);
      }
    }
  }, [currentVideoId, showVideoPlayer, activeStreaming]);

  // Sempre que for colocado um novo vídeo de reprodução, pré-selecionar a opção de qualidade automática
  useEffect(() => {
    if (currentVideoId) {
      setSelectedQuality('auto');
      onSetQuality?.('auto');
    }
  }, [currentVideoId, onSetQuality]);

  // ── Slash command autocomplete ──
  const SLASH_COMMANDS = [
    { cmd: '/skip', label: 'skip', icon: '⏭️', description: 'Pula para a próxima música da fila' },
    { cmd: '/play', label: 'play', icon: '▶️', description: 'Retoma a música pausada' },
    { cmd: '/pause', label: 'pause', icon: '⏸️', description: 'Pausa a música atual' },
    { cmd: '/clear', label: 'clear', icon: '🗑️', description: 'Limpa toda a fila de músicas' },
  ];

  const [showCmdMenu, setShowCmdMenu] = useState(false);
  const [cmdFilter, setCmdFilter] = useState<typeof SLASH_COMMANDS>([]);
  const [cmdHighlight, setCmdHighlight] = useState(0);
  const cmdMenuRef = useRef<HTMLDivElement>(null);

  // Custom Video Player Single-Player Teleport & Controls
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const seekLockRef = useRef<number>(0);
  const [isSeekingLocked, setIsSeekingLocked] = useState(false);

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
  const [showSearch, setShowSearch] = useState(false);

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
        const loaded: ChatMessage[] = history.map((m) => ({
          id: m.id,
          userName: m.sender_name,
          message: m.content,
          timestamp: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          type: m.msg_type,
          url: m.file_url || undefined,
          filename: m.file_name || undefined,
          channelId: m.channel_id || 'ch-geral',
        }));
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
      {/* ── CABEÇALHO DO CHAT COM NOME DO CANAL E BARRA DE PESQUISA ── */}
      <div className={styles.chatHeader}>
        <div className={styles.headerTitle}>
          {showVideoPlayer ? (
            <>
              <span className={styles.headerIcon}>📺</span>
              <span className={styles.headerChannelName}>Player de Vídeo</span>
            </>
          ) : isServer ? (
            <>
              <span className={styles.headerHash}>#</span>
              <span className={styles.headerChannelName}>{activeChannel.name}</span>
            </>
          ) : (
            <>
              <span className={styles.headerIcon}>💬</span>
              <span className={styles.headerChannelName}>Chat da Sala</span>
            </>
          )}
        </div>

        <div className={styles.headerActions}>
          {!showVideoPlayer && (
            <>
              {showSearch ? (
                <div className={styles.searchBar}>
                  <span className={styles.searchIcon}>🔍</span>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Pesquisar mensagens..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {searchQuery && (
                    <span className={styles.searchResultsBadge}>
                      {displayedMessages.length} {displayedMessages.length === 1 ? 'resultado' : 'resultados'}
                    </span>
                  )}
                  <button
                    className={styles.closeSearchBtn}
                    onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                    title="Fechar pesquisa"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  className={styles.searchToggleBtn}
                  onClick={() => setShowSearch(true)}
                  title="Pesquisar mensagens neste chat"
                >
                  🔍
                </button>
              )}
            </>
          )}

          {/* Botão só aparece quando há vídeo tocando ou streaming ativo */}
          {(currentVideoId || showVideoPlayer || activeStreaming) && (
            <button
              className={`${styles.videoToggleBtn} ${showVideoPlayer ? styles.videoToggleBtnActive : ''} ${(isPlaying || activeStreaming) ? styles.videoToggleBtnPlaying : ''}`}
              onClick={() => {
                // When closing the player, immediately hide media; when opening, skeleton
                // shows during the flip and renderMedia is set by onTransitionEnd.
                setRenderMedia(false);
                setShowVideoPlayer(v => !v);
              }}
              title={showVideoPlayer ? 'Voltar ao Chat' : (activeStreaming ? `Assistir ${activeStreaming.service === 'netflix' ? 'Netflix' : 'Prime Video'}` : 'Assistir Vídeo')}
            >
              {showVideoPlayer ? <IconArrowLeft /> : <IconVideo />}
              <span>{showVideoPlayer ? 'Chat' : (activeStreaming ? (activeStreaming.service === 'netflix' ? 'Netflix' : 'Prime') : 'Assistir')}</span>
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
                  const isMe = msg.userName === myName;
                  return (
                    <div
                      key={msg.id}
                      className={`${styles.messageWrapper} ${msg.isSystem ? styles.systemWrapper : isMe ? styles.myWrapper : styles.otherWrapper
                        }`}
                    >
                      {msg.isSystem ? (
                        <div className={styles.systemMessage}>
                          <span>{msg.message}</span>
                        </div>
                      ) : (
                        <>
                          {!isMe && (
                            <div className={styles.avatarWrapper}>
                              {msg.avatarUrl ? (
                                <img src={msg.avatarUrl} alt="Avatar" className={styles.avatarImage} />
                              ) : (
                                <div className={styles.avatarFallback}>
                                  {msg.userName.substring(0, 2).toUpperCase()}
                                </div>
                              )}
                            </div>
                          )}
                          <div className={`${styles.messageBubble} ${isMe ? styles.myBubble : styles.otherBubble}`}>
                            {!isMe && (
                              <span className={styles.senderName}>{msg.userName}</span>
                            )}

                            {/* Conteúdo da mensagem */}
                            {msg.type === 'giphy' && msg.url ? (
                              <div className={styles.gifContainer}>
                                <img
                                  src={msg.url}
                                  alt="GIF"
                                  className={styles.messageGif}
                                  onLoad={() => scrollToBottom(false)}
                                />
                              </div>
                            ) : msg.type === 'image' && msg.url ? (
                              <>
                                <div className={styles.imageContainer}>
                                  <img
                                    src={msg.url}
                                    alt={msg.filename || 'Imagem'}
                                    className={styles.messageImage}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setViewingImage(msg.url!);
                                      setImageZoom(1);
                                    }}
                                    style={{ cursor: 'pointer' }}
                                    onLoad={() => scrollToBottom(false)}
                                  />
                                </div>
                                {msg.message && msg.message !== '📷 Imagem' && (
                                  <p
                                    className={styles.messageText}
                                    style={{ marginTop: '8px' }}
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
                                    <span className={styles.fileIcon}>📎</span>
                                    <span className={styles.fileName}>{msg.filename || 'Arquivo'}</span>
                                  </a>
                                </div>
                                {msg.message && msg.message !== '📄 ' + msg.filename && (
                                  <p
                                    className={styles.messageText}
                                    style={{ marginTop: '8px' }}
                                    dangerouslySetInnerHTML={{
                                      __html: parseLinks(escapeHtml(msg.message)),
                                    }}
                                  />
                                )}
                              </>
                            ) : (
                              <p
                                className={styles.messageText}
                                dangerouslySetInnerHTML={{
                                  __html: parseLinks(escapeHtml(msg.message)),
                                }}
                              />
                            )}

                            <span className={styles.timestamp}>{msg.timestamp}</span>
                          </div>
                          {isMe && (
                            <div className={styles.avatarWrapper}>
                              {myAvatarUrl ? (
                                <img src={myAvatarUrl} alt="Avatar" className={styles.avatarImage} />
                              ) : (
                                <div className={styles.avatarFallback}>
                                  {myName.substring(0, 2).toUpperCase()}
                                </div>
                              )}
                            </div>
                          )}
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

            {/* Chat input */}
            <div className={styles.inputContainer}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />

              <button
                type="button"
                className={styles.actionIconBtn}
                onClick={() => fileInputRef.current?.click()}
                title="Enviar Arquivo ou Imagem"
              >
                📎
              </button>

              <button
                type="button"
                ref={giphyBtnRef}
                className={styles.actionIconBtn}
                onClick={() => setShowGiphy(!showGiphy)}
                title="Buscar GIF"
              >
                🎁
              </button>

              <button
                type="button"
                ref={emojiBtnRef}
                className={styles.actionIconBtn}
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="Inserir Emoji"
              >
                😊
              </button>

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
                    <span>💡 Comandos de Música</span>
                    <kbd className={styles.cmdKbd}>↑↓ navegar</kbd>
                    <kbd className={styles.cmdKbd}>Enter executar</kbd>
                  </div>
                  {cmdFilter.map((c, i) => (
                    <button
                      key={c.cmd}
                      className={`${styles.cmdItem} ${i === cmdHighlight ? styles.cmdItemActive : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); applyCommand(c.cmd); }}
                      onMouseEnter={() => setCmdHighlight(i)}
                    >
                      <span className={styles.cmdItemIcon}>{c.icon}</span>
                      <span className={styles.cmdItemName}>{c.cmd}</span>
                      <span className={styles.cmdItemDesc}>{c.description}</span>
                    </button>
                  ))}
                </div>
              )}

              <input
                type="text"
                className={styles.chatInput}
                placeholder={
                  isServer
                    ? `Conversar em #${activeChannel.name}... (/ para comandos)`
                    : 'Envie uma mensagem... (/ para comandos)'
                }
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                maxLength={2000}
              />

              <button
                type="button"
                className={styles.sendButton}
                onClick={handleSend}
                disabled={(!input.trim() && !stagedFile) || isUploading}
                title="Enviar (Enter)"
              >
                {isUploading ? (
                  <span className={styles.spinner} />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13" />
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                )}
              </button>
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

              {/* Streaming View for Netflix & Prime Video */}
              {activeStreaming ? (
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
                      background: '#090912',
                      border: '1px solid rgba(124, 58, 237, 0.4)',
                      boxShadow: '0 0 24px rgba(124, 58, 237, 0.15)',
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
                          src={activeStreaming.url || (activeStreaming.service === 'netflix' ? 'https://www.netflix.com/browse' : 'https://www.primevideo.com')}
                          title={activeStreaming.service === 'netflix' ? 'Netflix' : 'Prime Video'}
                          className={styles.streamingIframe}
                          allow="autoplay; encrypted-media; fullscreen"
                        />
                      ) : !renderMedia ? (
                        <div className={styles.streamingSkeleton}>
                          <div
                            className={styles.skeletonSpinner}
                            style={{ borderTopColor: activeStreaming.service === 'netflix' ? '#E50914' : '#00A8E1' }}
                          />
                          <p className={styles.skeletonLabel}>
                            {activeStreaming.service === 'netflix' ? 'Netflix' : 'Prime Video'}
                          </p>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '24px', color: '#888' }}>
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              border: '3px solid rgba(255, 255, 255, 0.1)',
                              borderTopColor: activeStreaming.service === 'netflix' ? '#E50914' : '#00A8E1',
                              margin: '0 auto 14px',
                              animation: 'spin 1s linear infinite',
                            }}
                          />
                          <p style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                            Conectando ao {activeStreaming.service === 'netflix' ? 'Netflix' : 'Prime Video'}...
                          </p>
                          <p style={{ margin: 0, fontSize: '12px', color: '#71717a' }}>
                            Iniciando navegador com Widevine DRM ativo
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Controles no mesmo padrão do YouTube */}
                  <div className={styles.videoShortcutWrapper}>
                    <p className={styles.videoShortcutLabel}>⎯⎯ Comandos de Controle ⎯⎯</p>
                    <div className={styles.videoShortcutGrid}>
                      <button
                        className={`${styles.videoShortcutBtn} ${styles.videoShortcutPlay}`}
                        onClick={() => {
                          const electron = (window as any).electron;
                          if (electron?.sendStreamingCommand) electron.sendStreamingCommand('play');
                          else if (electron?.streamingCommand) electron.streamingCommand('play');
                        }}
                        title="Reproduzir vídeo"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        <span>/play</span>
                        <small>Reproduzir</small>
                      </button>

                      <button
                        className={`${styles.videoShortcutBtn} ${styles.videoShortcutPause}`}
                        onClick={() => {
                          const electron = (window as any).electron;
                          if (electron?.sendStreamingCommand) electron.sendStreamingCommand('pause');
                          else if (electron?.streamingCommand) electron.streamingCommand('pause');
                        }}
                        title="Pausar vídeo"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                        <span>/pause</span>
                        <small>Pausar</small>
                      </button>

                      <button
                        className={`${styles.videoShortcutBtn} ${styles.videoShortcutSkip}`}
                        onClick={() => {
                          const electron = (window as any).electron;
                          if (electron?.sendStreamingCommand) electron.sendStreamingCommand('skip');
                          else if (electron?.streamingCommand) electron.streamingCommand('skip');
                        }}
                        title="Pular (abertura / 10s / próximo episódio)"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                        <span>/skip</span>
                        <small>Pular</small>
                      </button>

                      <button
                        className={`${styles.videoShortcutBtn} ${styles.videoShortcutClear}`}
                        onClick={() => {
                          setRenderMedia(false);
                          (window as any).electron?.closeStreamingView?.();
                          setActiveStreaming(null);
                          setShowVideoPlayer(false);
                        }}
                        title="Sair do Streaming"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Sair</span>
                        <small>Fechar</small>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Player area */}
                  {(() => {
                    const videoPlayerContent = (
                  <div ref={videoContainerRef} className={`${styles.videoSlotWrapper} ${!currentVideoId ? styles.hiddenSlot : ''}`}>
                    {/* Global YT Host - stays visible only when on video player tab */}
                    <div
                      style={{
                        display: (isPiPActive || !currentVideoId || !!activeStreaming) ? 'none' : 'block',
                        visibility: showVideoPlayer ? 'visible' : 'hidden',
                        pointerEvents: showVideoPlayer ? 'auto' : 'none',
                        width: '100%',
                        height: '100%'
                      }}
                    >
                      <div id="yt-host" className={`${styles.ytHostContainer} ${(isDraggingSeek || isSeekingLocked || isBuffering) ? styles.ytHostSeeking : ''} ${!showVideoPlayer ? styles.audioOnlyMode : ''}`} />
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
                          onClick={() => onMusicAction?.(isPlaying ? 'pause' : 'play')}
                          title={isPlaying ? 'Pausar' : 'Reproduzir'}
                        >
                          {isPlaying ? (
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                          ) : (
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                          )}
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
                                  setIsSeekingLocked(true);
                                  setTimeout(() => setIsSeekingLocked(false), 1000);
                                  onMusicSeek?.(targetTime);
                                }}
                                onTouchEnd={(e) => {
                                  setIsDraggingSeek(false);
                                  const targetTime = parseFloat((e.target as HTMLInputElement).value);
                                  seekLockRef.current = Date.now() + 1000;
                                  setIsSeekingLocked(true);
                                  setTimeout(() => setIsSeekingLocked(false), 1000);
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
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                {ytVol === 0 || callMuted ? (
                                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                                ) : ytVol < 50 ? (
                                  <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                                ) : (
                                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                                )}
                              </svg>
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
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><rect x="12" y="14" width="7" height="5" rx="1" ry="1" /></svg>
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
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="3"></circle>
                                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                                </svg>
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
                                          {isCCActive ? 'Ativadas' : 'Desativadas'}
                                        </span>
                                      </button>

                                      {/* Item Qualidade */}
                                      <button
                                        className={styles.settingsMenuItem}
                                        onClick={() => {
                                          setSettingsSubMenu('quality');
                                          getYtAvailableQualities?.();
                                        }}
                                      >
                                        <div className={styles.settingsItemLeft}>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                          </svg>
                                          <span>Qualidade</span>
                                        </div>
                                        <div className={styles.settingsItemRight}>
                                          <span className={styles.settingsValueText}>{formatQualityLabel(selectedQuality)}</span>
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                                        </div>
                                      </button>
                                    </div>
                                  ) : (
                                    <div className={styles.settingsMenuList}>
                                      {/* Header Submenu Qualidade */}
                                      <button
                                        className={styles.settingsSubHeader}
                                        onClick={() => setSettingsSubMenu('main')}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                                        <span>Qualidade</span>
                                      </button>

                                      {/* Opções de Qualidade Nativas do YouTube */}
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
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
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
                    Adicione um vídeo do YouTube na fila do painel de música para assistir aqui.
                  </p>
                  <div className={styles.videoEmptyPulse} />
                </div>
              )}

              {/* Shortcut buttons — controles de música */}
              <div className={styles.videoShortcutWrapper}>
                <p className={styles.videoShortcutLabel}>⎯⎯ Comandos de Controle ⎯⎯</p>
                <div className={styles.videoShortcutGrid}>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutPlay}`}
                    onClick={() => onMusicAction?.('play')}
                    title="Retomar música"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    <span>/play</span>
                    <small>Retomar</small>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutPause}`}
                    onClick={() => onMusicAction?.('pause')}
                    title="Pausar música"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                    <span>/pause</span>
                    <small>Pausar</small>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutSkip}`}
                    onClick={() => onMusicAction?.('skip')}
                    title="Pular música"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    <span>/skip</span>
                    <small>Pular</small>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutClear}`}
                    onClick={() => {
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
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
                    <span>/clear</span>
                    <small>Limpar fila</small>
                  </button>
                </div>
              </div>
            </>
          )}

            </div>
          </div>{/* end flipCardBack */}

        </div>{/* end flipCardInner */}
      </div>{/* end flipCard */}
    </div>
  );
};
