import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { ChatMessage } from '../types';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import EmojiPicker from 'emoji-picker-react';
import styles from './ChatPanel.module.css';
import { fetchChannelMessages, saveMessageToSupabase } from '../lib/supabase';

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

interface Props {
  onSendMessage: (msg: string, type?: 'text' | 'image' | 'giphy' | 'file', url?: string, filename?: string, channelId?: string) => void;
  onMusicAction?: (action: 'skip' | 'pause' | 'play' | 'clear') => void;
}

export const ChatPanel: React.FC<Props> = ({ onSendMessage, onMusicAction }) => {
  const { 
    messages, 
    setMessages,
    myName, 
    room, 
    isServer, 
    channels, 
    activeChannelId 
  } = useAppStore();

  const [input, setInput] = useState('');
  const [showGiphy, setShowGiphy] = useState(false);
  const [giphySearch, setGiphySearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [stagedFile, setStagedFile] = useState<{ file: File, previewUrl: string } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState<number>(1);

  // ── Video Player Flip ──
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  const { currentVideoId, currentTrackTitle, isPlaying } = useAppStore();

  // Auto-fechar o player quando o vídeo parar de tocar
  useEffect(() => {
    if (!currentVideoId && showVideoPlayer) {
      setShowVideoPlayer(false);
    }
  }, [currentVideoId, showVideoPlayer]);

  // ── Slash command autocomplete ──
  const SLASH_COMMANDS = [
    { cmd: '/skip',  label: 'skip',  icon: '⏭️', description: 'Pula para a próxima música da fila' },
    { cmd: '/play',  label: 'play',  icon: '▶️', description: 'Retoma a música pausada' },
    { cmd: '/pause', label: 'pause', icon: '⏸️', description: 'Pausa a música atual' },
    { cmd: '/clear', label: 'clear', icon: '🗑️', description: 'Limpa toda a fila de músicas' },
  ];

  const [showCmdMenu, setShowCmdMenu] = useState(false);
  const [cmdFilter, setCmdFilter] = useState<typeof SLASH_COMMANDS>([]);
  const [cmdHighlight, setCmdHighlight] = useState(0);
  const cmdMenuRef = useRef<HTMLDivElement>(null);

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

  // YouTube embed URL (muted, visual only — audio comes from the hidden #yt-host player)
  const ytEmbedUrl = currentVideoId
    ? `https://www.youtube.com/embed/${currentVideoId}?autoplay=1&mute=1&controls=1&modestbranding=1&rel=0&enablejsapi=0`
    : null;

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

        onSendMessage(msgText, msgType, fileUrl, fileName, currentChannel);

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

      onSendMessage(trimmed, 'text', undefined, undefined, currentChannel);
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

    onSendMessage('GIF', 'giphy', gifUrl, undefined, currentChannel);
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

          {/* Botão só aparece quando há vídeo tocando */}
          {(currentVideoId || showVideoPlayer) && (
            <button
              className={`${styles.videoToggleBtn} ${showVideoPlayer ? styles.videoToggleBtnActive : ''} ${isPlaying ? styles.videoToggleBtnPlaying : ''}`}
              onClick={() => setShowVideoPlayer(v => !v)}
              title={showVideoPlayer ? 'Voltar ao Chat' : 'Assistir Vídeo'}
            >
              {showVideoPlayer ? <IconArrowLeft /> : <IconVideo />}
              <span>{showVideoPlayer ? 'Chat' : 'Assistir'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── FLIP CARD CONTAINER ── */}
      <div className={`${styles.flipCard} ${showVideoPlayer ? styles.flipped : ''}`}>
        <div className={styles.flipCardInner}>

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
                className={`${styles.messageWrapper} ${
                  msg.isSystem ? styles.systemWrapper : isMe ? styles.myWrapper : styles.otherWrapper
                }`}
              >
                {msg.isSystem ? (
                  <div className={styles.systemMessage}>
                    <span>{msg.message}</span>
                  </div>
                ) : (
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
            <EmojiPicker onEmojiClick={onEmojiClick} theme={"dark" as any} />
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

              {/* Player area */}
              {currentVideoId ? (
                <div className={styles.videoIframeWrapper}>
                  <div className={styles.videoIframeContainer}>
                    <iframe
                      key={currentVideoId}
                      src={`https://www.youtube.com/embed/${currentVideoId}?autoplay=1&controls=1&rel=0&modestbranding=1&color=white&iv_load_policy=3&playsinline=1`}
                      className={styles.videoIframe}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      title={currentTrackTitle || 'Video Player'}
                    />
                  </div>
                </div>
              ) : (
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
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    <span>/play</span>
                    <small>Retomar</small>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutPause}`}
                    onClick={() => onMusicAction?.('pause')}
                    title="Pausar música"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    <span>/pause</span>
                    <small>Pausar</small>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutSkip}`}
                    onClick={() => onMusicAction?.('skip')}
                    title="Pular música"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    <span>/skip</span>
                    <small>Pular</small>
                  </button>
                  <button
                    className={`${styles.videoShortcutBtn} ${styles.videoShortcutClear}`}
                    onClick={() => onMusicAction?.('clear')}
                    title="Limpar fila"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    <span>/clear</span>
                    <small>Limpar fila</small>
                  </button>
                </div>
              </div>

            </div>
          </div>{/* end flipCardBack */}

        </div>{/* end flipCardInner */}
      </div>{/* end flipCard */}
    </div>
  );
};
