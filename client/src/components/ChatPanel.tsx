import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { ChatMessage } from '../types';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
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

interface Props {
  onSendMessage: (msg: string, type?: 'text' | 'image' | 'giphy' | 'file', url?: string, filename?: string, channelId?: string) => void;
}

export const ChatPanel: React.FC<Props> = ({ onSendMessage }) => {
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

  // Barra de Pesquisa de Mensagens
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Obter o canal ativo atual
  const activeChannel = useMemo(() => {
    return channels.find(c => c.id === activeChannelId) || { id: activeChannelId || 'ch-geral', name: 'geral' };
  }, [channels, activeChannelId]);

  // Carregar histórico do Supabase ao mudar de canal ou servidor
  useEffect(() => {
    if (!room?.id || !isServer) return;

    fetchChannelMessages(room.id, activeChannelId).then((history) => {
      if (history && history.length > 0) {
        const formatted: ChatMessage[] = history.map((h) => ({
          id: h.id,
          userName: h.sender_name,
          message: h.content,
          timestamp: new Date(h.created_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          }),
          type: h.msg_type || 'text',
          url: h.file_url || undefined,
          filename: h.file_name || undefined,
          channelId: h.channel_id || 'ch-geral',
        }));

        // Manter mensagens já na memória sem duplicar IDs
        const existingMap = new Map(messages.map(m => [m.id, m]));
        formatted.forEach(m => existingMap.set(m.id, m));
        setMessages(Array.from(existingMap.values()));
      }
    });
  }, [room?.id, isServer, activeChannelId]);

  // Filtrar mensagens para o canal ativo
  const channelMessages = useMemo(() => {
    if (!isServer) return messages;
    return messages.filter(
      (m) =>
        !m.channelId ||
        m.channelId === activeChannelId ||
        (activeChannelId === 'ch-geral' && (m.channelId === 'geral' || m.channelId === 'ch-geral'))
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

  useEffect(() => {
    if (!searchQuery) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [channelMessages, searchQuery]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed && !stagedFile) return;

    const currentChannel = activeChannelId || 'ch-geral';

    if (stagedFile) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', stagedFile.file);

        const res = await fetch(`${SERVER_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error('Erro no upload');
        const data = await res.json();

        const isImage = stagedFile.file.type.startsWith('image/');
        const fileUrl = `${SERVER_URL}${data.url}`;
        const fileName = stagedFile.file.name;
        const msgText = trimmed || (isImage ? '📷 Imagem' : `📄 ${fileName}`);
        const msgType = isImage ? 'image' : 'file';

        // Salvar no Supabase
        if (room?.id && isServer) {
          saveMessageToSupabase(room.id, myName, msgText, currentChannel, msgType, fileUrl, fileName);
        }

        onSendMessage(msgText, msgType, fileUrl, fileName, currentChannel);

        URL.revokeObjectURL(stagedFile.previewUrl);
        setStagedFile(null);
      } catch (err) {
        console.error(err);
        alert('Falha ao enviar o arquivo.');
      } finally {
        setIsUploading(false);
      }
    } else {
      // Salvar no Supabase
      if (room?.id && isServer) {
        saveMessageToSupabase(room.id, myName, trimmed, currentChannel, 'text');
      }

      onSendMessage(trimmed, 'text', undefined, undefined, currentChannel);
    }

    setInput('');
  }, [input, stagedFile, onSendMessage, activeChannelId, room?.id, isServer, myName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) {
          stageFile(file);
          return;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      stageFile(file);
    }
  };

  const handleGifClick = (gif: any, e: React.SyntheticEvent<HTMLElement, Event>) => {
    e.preventDefault();
    const gifUrl = gif.images.fixed_height.url;
    const currentChannel = activeChannelId || 'ch-geral';

    if (room?.id && isServer) {
      saveMessageToSupabase(room.id, myName, 'GIF', currentChannel, 'giphy', gifUrl);
    }

    onSendMessage('GIF', 'giphy', gifUrl, undefined, currentChannel);
    setShowGiphy(false);
    setGiphySearch('');
  };

  const fetchGifs = (offset: number) => {
    if (giphySearch) {
      return gf.search(giphySearch, { offset, limit: 10 });
    }
    return gf.trending({ offset, limit: 10 });
  };

  return (
    <div
      className={`${styles.panel} ${isDragging ? styles.panelDragging : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── CABEÇALHO COM CANAL E BUSCA ── */}
      <div className={styles.header}>
        <div className={styles.headerTitleArea}>
          <span className={styles.headerIcon}>
            {isServer ? '#' : '💬'}
          </span>
          <h2 className={styles.headerTitle}>
            {isServer ? activeChannel.name : 'Chat da Sala'}
          </h2>
        </div>

        <div className={styles.headerActions}>
          {showSearch ? (
            <div className={styles.searchBar}>
              <span className={styles.searchIcon}>🔍</span>
              <input
                type="text"
                placeholder="Pesquisar mensagens..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
                autoFocus
              />
              {searchQuery && (
                <span className={styles.searchCount}>
                  {displayedMessages.length}
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
              className={styles.toggleSearchBtn}
              onClick={() => setShowSearch(true)}
              title="Pesquisar mensagens"
            >
              🔍
            </button>
          )}
        </div>
      </div>

      {/* ── LISTAGEM DE MENSAGENS ── */}
      <div className={styles.messages} id="chat-messages">
        {displayedMessages.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              {searchQuery ? '🔍' : '👋'}
            </span>
            <p>
              {searchQuery 
                ? `Nenhuma mensagem encontrada para "${searchQuery}"` 
                : `Bem-vindo ao #${activeChannel.name}! Seja o primeiro a falar!`}
            </p>
          </div>
        )}
        {displayedMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} isMe={msg.userName === myName} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── ÁREA DE DIGITAÇÃO ── */}
      <div className={styles.inputAreaWrapper}>
        {stagedFile && (
          <div className={styles.stagedFilePreview}>
            {stagedFile.file.type.startsWith('image/') ? (
              <img src={stagedFile.previewUrl} alt="Staged" className={styles.stagedImage} />
            ) : (
              <div className={styles.stagedDocument}>
                <span className={styles.stagedDocIcon}>📄</span>
                <span className={styles.stagedDocName}>{stagedFile.file.name}</span>
              </div>
            )}
            <button
              className={styles.removeStagedBtn}
              onClick={() => {
                URL.revokeObjectURL(stagedFile.previewUrl);
                setStagedFile(null);
              }}
              title="Remover anexo"
            >
              ✕
            </button>
          </div>
        )}
        {showGiphy && (
          <div className={styles.giphyPopover}>
            <div className={styles.giphyHeader}>
              <input
                type="text"
                placeholder="Pesquisar Giphy..."
                value={giphySearch}
                onChange={(e) => setGiphySearch(e.target.value)}
                className={styles.giphySearch}
                autoFocus
              />
              <button onClick={() => setShowGiphy(false)} className={styles.closeGiphy}>✕</button>
            </div>
            <div className={styles.giphyGridWrapper}>
              {!GIPHY_API_KEY ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#F43F5E', fontSize: '13px' }}>
                  <p>🔑 <b>Chave do Giphy ausente!</b></p>
                  <p style={{ marginTop: '10px', color: 'var(--text-muted)' }}>Crie um arquivo <b>.env</b> na pasta <i>client</i> com:<br /><br /><code>VITE_GIPHY_API_KEY=sua_chave_aqui</code><br /><br />Obtenha sua chave gratuita em <a href="https://developers.giphy.com/" target="_blank" style={{ color: '#22D3EE' }}>developers.giphy.com</a></p>
                </div>
              ) : (
                <Grid
                  width={360}
                  columns={2}
                  fetchGifs={fetchGifs}
                  key={giphySearch}
                  onGifClick={handleGifClick}
                  noLink
                  hideAttribution
                />
              )}
            </div>
          </div>
        )}

        <div className={styles.inputArea}>
          <input
            type="file"
            accept="image/*,application/pdf,application/x-pkcs12,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,application/x-rar-compressed,.pdf,.pfx,.doc,.docx,.xls,.xlsx,.zip,.rar"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button
            className={styles.iconBtn}
            onClick={() => fileInputRef.current?.click()}
            title="Enviar Arquivo"
            disabled={isUploading}
          >
            {isUploading ? '⌛' : '📎'}
          </button>

          <button
            className={`${styles.iconBtn} ${showGiphy ? styles.activeIconBtn : ''}`}
            onClick={() => setShowGiphy(!showGiphy)}
            title="Enviar GIF"
          >
            🎁
          </button>

          <input
            id="chat-input"
            className={styles.input}
            type="text"
            placeholder={isServer ? `Conversar em #${activeChannel.name}...` : "Envie uma mensagem..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            maxLength={2000}
          />
          <button
            id="btnSendChat"
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={(!input.trim() && !stagedFile) || isUploading}
            title="Enviar mensagem"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

const MessageBubble: React.FC<{ msg: ChatMessage; isMe: boolean }> = ({ msg, isMe }) => {
  const hue = [...msg.userName].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  if (msg.isSystem) {
    return (
      <div className={styles.systemMsg}>
        <em dangerouslySetInnerHTML={{ __html: escapeHtml(msg.message) }} />
      </div>
    );
  }

  return (
    <div className={`${styles.message} ${isMe ? styles.messageMe : ''}`}>
      {!isMe && (
        <div
          className={styles.msgAvatar}
          style={{ background: `hsl(${hue}, 60%, 40%)` }}
        >
          {msg.userName.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className={styles.msgContent}>
        {!isMe && (
          <div className={styles.msgMeta}>
            <span className={styles.msgAuthor} style={{ color: `hsl(${hue}, 70%, 65%)` }}>
              {escapeHtml(msg.userName)}
            </span>
            <span className={styles.msgTime}>{msg.timestamp}</span>
          </div>
        )}

        {/* Render based on type */}
        {msg.type === 'image' && msg.url ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <img src={msg.url} alt="User Upload" className={styles.msgImage} />
            {msg.message !== '📷 Imagem' && (
              <div
                className={styles.msgBubble}
                dangerouslySetInnerHTML={{ __html: parseLinks(escapeHtml(msg.message)) }}
              />
            )}
          </div>
        ) : msg.type === 'file' && msg.url ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <a href={msg.url} target="_blank" rel="noopener noreferrer" className={styles.msgFile}>
              <span className={styles.msgFileIcon}>📄</span>
              <span className={styles.msgFileName}>{msg.filename || 'Documento'}</span>
              <span className={styles.msgFileDownload}>⬇️</span>
            </a>
            {msg.message && !msg.message.startsWith('📄') && (
              <div
                className={styles.msgBubble}
                dangerouslySetInnerHTML={{ __html: parseLinks(escapeHtml(msg.message)) }}
              />
            )}
          </div>
        ) : msg.type === 'giphy' && msg.url ? (
          <img src={msg.url} alt="Giphy" className={styles.msgGif} />
        ) : (
          <div
            className={styles.msgBubble}
            dangerouslySetInnerHTML={{ __html: parseLinks(escapeHtml(msg.message)) }}
          />
        )}

        {isMe && <span className={styles.msgTimeMe}>{msg.timestamp}</span>}
      </div>
    </div>
  );
};
