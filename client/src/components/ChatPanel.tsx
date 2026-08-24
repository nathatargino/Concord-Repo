import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { ChatMessage } from '../types';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import styles from './ChatPanel.module.css';

// Using Giphy API Key from .env or fallback
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || '';
const gf = new GiphyFetch(GIPHY_API_KEY || 'GlVGYHqc3SyCEGpo3sZa1n5aD1bZ0vE4');
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

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
  onSendMessage: (msg: string, type?: 'text'|'image'|'giphy'|'file', url?: string, filename?: string) => void;
}

export const ChatPanel: React.FC<Props> = ({ onSendMessage }) => {
  const { messages, myName } = useAppStore();
  const [input, setInput] = useState('');
  const [showGiphy, setShowGiphy] = useState(false);
  const [giphySearch, setGiphySearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [stagedFile, setStagedFile] = useState<{ file: File, previewUrl: string } | null>(null);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed && !stagedFile) return;

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
        onSendMessage(
          trimmed || (isImage ? '📷 Imagem' : `📄 ${stagedFile.file.name}`),
          isImage ? 'image' : 'file',
          `${SERVER_URL}${data.url}`,
          stagedFile.file.name
        );
        
        URL.revokeObjectURL(stagedFile.previewUrl);
        setStagedFile(null);
      } catch (err) {
        console.error(err);
        alert('Falha ao enviar a imagem.');
      } finally {
        setIsUploading(false);
      }
    } else {
      onSendMessage(trimmed);
    }
    
    setInput('');
  }, [input, stagedFile, onSendMessage]);

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
    onSendMessage('GIF', 'giphy', gif.images.fixed_height.url);
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
      <div className={styles.header}>
        <span className={styles.headerIcon}>💬</span>
        <h2 className={styles.headerTitle}>Chat</h2>
      </div>

      <div className={styles.messages} id="chat-messages">
        {messages.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>👋</span>
            <p>Seja o primeiro a falar!</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} isMe={msg.userName === myName} />
        ))}
        <div ref={bottomRef} />
      </div>

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
              title="Remover imagem"
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
                  <p style={{ marginTop: '10px', color: 'var(--text-muted)' }}>Crie um arquivo <b>.env</b> na pasta <i>client</i> com:<br/><br/><code>VITE_GIPHY_API_KEY=sua_chave_aqui</code><br/><br/>Obtenha sua chave gratuita em <a href="https://developers.giphy.com/" target="_blank" style={{color: '#22D3EE'}}>developers.giphy.com</a></p>
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
            placeholder="Envie uma mensagem..."
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
