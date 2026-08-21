import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import styles from './StatusBar.module.css';

export const StatusBar: React.FC = () => {
  const { connected, myName } = useAppStore();

  return (
    <footer className={styles.footer}>
      <div className={styles.left}>
        <div className={`${styles.statusDot} ${connected ? styles.connected : styles.disconnected}`} />
        <span className={styles.statusText}>
          {connected ? 'Conectado ao Servidor' : 'Desconectado'}
        </span>
      </div>
      <div className={styles.right}>
        <span className={styles.userText}>
          Logado como <strong className={styles.userName}>{myName || '...'}</strong>
        </span>
      </div>
    </footer>
  );
};
