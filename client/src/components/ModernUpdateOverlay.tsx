import React from 'react';
import styles from './ModernUpdateOverlay.module.css';

export const ModernUpdateOverlay: React.FC = () => {
  return (
    <div className={styles.overlay}>
      <div className={styles.content}>
        <div className={styles.logoWrapper}>
          <div className={styles.logoGlow} />
          <img src="/logo.png" alt="Concord Logo" className={styles.logoImg} />
        </div>
        <h2 className={styles.title}>Atualizando o Concord</h2>
        <p className={styles.subtitle}>
          Instalando a nova versão... O aplicativo será reiniciado automaticamente em instantes.
        </p>
        <div className={styles.progressBarContainer}>
          <div className={styles.progressBarFill} />
        </div>
        <p className={styles.footerNote}>
          <i className="fa-solid fa-spinner fa-spin" style={{ color: '#7c5cff' }} />
          Por favor, aguarde alguns segundos sem fechar a janela.
        </p>
      </div>
    </div>
  );
};
