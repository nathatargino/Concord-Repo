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

interface Props {
  onSendMessage: (msg: string, type?: 'text'|'image'|'giphy', url?: string) => void;
}

export const ChatPanel: React.FC<Props> = ({ onSendMessage }) => {
  const { messages, myName } = useAppStore();
  const [input, setInput] = useState('');
  const [showGiphy, setShowGiphy] = useState(false);
  const [giphySearch, setGiphySearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput('');
  }, [input, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem deve ter no máximo 5MB');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(`${SERVER_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Erro no upload');
      const data = await res.json();
      
      // Send image message
      onSendMessage('📷 Imagem', 'image', `${SERVER_URL}${data.url}`);
    } catch (err) {
      console.error(err);
      alert('Falha ao enviar a imagem.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    <div className={styles.panel}>
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
            accept="image/*"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button 
            className={styles.iconBtn} 
            onClick={() => fileInputRef.current?.click()}
            title="Enviar Imagem"
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
            maxLength={2000}
          />
          <button
            id="btnSendChat"
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim()}
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
          <img src={msg.url} alt="User Upload" className={styles.msgImage} />
        ) : msg.type === 'giphy' && msg.url ? (
          <img src={msg.url} alt="Giphy" className={styles.msgGif} />
        ) : (
          <div
            className={styles.msgBubble}
            dangerouslySetInnerHTML={{ __html: escapeHtml(msg.message) }}
          />
        )}
        
        {isMe && <span className={styles.msgTimeMe}>{msg.timestamp}</span>}
      </div>
    </div>
  );
};
