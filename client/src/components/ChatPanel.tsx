import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { ChatMessage } from '../types';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import EmojiPicker from 'emoji-picker-react';
import styles from './ChatPanel.module.css';
import { fetchChannelMessages, saveMessageToSupabase } from '../lib/supabase';

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          {isServer ? (
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
        </div>
      </div>

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
                          <a href={msg.url} target="_blank" rel="noopener noreferrer">
                            <img 
                              src={msg.url} 
                              alt={msg.filename || 'Imagem'} 
                              className={styles.messageImage} 
                              onLoad={() => scrollToBottom(false)}
                            />
                          </a>
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

      {/* Giphy picker modal/popover */}
      {showGiphy && (
        <div className={styles.giphyPopover}>
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
          className={styles.actionIconBtn}
          onClick={() => setShowGiphy(!showGiphy)}
          title="Buscar GIF"
        >
          🎁
        </button>

        <button
          type="button"
          className={styles.actionIconBtn}
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          title="Inserir Emoji"
        >
          😊
        </button>

        {showEmojiPicker && (
          <div className={styles.emojiPickerContainer}>
            <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
          </div>
        )}

        <input
          type="text"
          className={styles.chatInput}
          placeholder={
            isServer
              ? `Conversar em #${activeChannel.name}...`
              : 'Envie uma mensagem...'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
    </div>
  );
};
