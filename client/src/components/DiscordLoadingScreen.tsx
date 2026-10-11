import React, { useState, useEffect } from 'react';
import styles from './DiscordLoadingScreen.module.css';

interface Props {
  isReady: boolean;
  onFinished: () => void;
}

const STATUS_MESSAGES = [
  'Conectando aos servidores...',
  'Aquecendo os canais de voz...',
  'Carregando seus servidores e amigos...',
  'Sincronizando perfis e áudio HD...',
  'Tudo pronto! Preparando seu Hub...',
];

const DISCORD_TIPS = [
  'Clique no seu código no rodapé para copiar seu identificador completo!',
  'Sua chamada de voz permanece ativa enquanto você navega por outros servidores.',
  'Você pode silenciar ou ajustar o volume individual de qualquer membro clicando com o botão direito.',
  'Crie salas rápidas de 14 horas com streaming em grupo e áudio cristalino.',
];

export const DiscordLoadingScreen: React.FC<Props> = ({ isReady, onFinished }) => {
  const [msgIndex, setMsgIndex] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // Selecionar uma dica aleatória no início
  useEffect(() => {
    const randomTip = Math.floor(Math.random() * DISCORD_TIPS.length);
    setTipIndex(randomTip);
  }, []);

  // Rotacionar mensagens de status
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 700);
    return () => clearInterval(interval);
  }, []);

  // Garantir tempo mínimo para transição agradável (~2.6 segundos)
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 2600);
    return () => clearTimeout(timer);
  }, []);

  // Concluir transição quando tanto os dados estiverem prontos quanto o tempo mínimo passado
  useEffect(() => {
    if (minTimeElapsed && isReady && !isExiting) {
      setIsExiting(true);
      const exitTimer = setTimeout(() => {
        onFinished();
      }, 420);
      return () => clearTimeout(exitTimer);
    }
  }, [minTimeElapsed, isReady, isExiting, onFinished]);

  return (
    <div className={`${styles.loadingOverlay} ${isExiting ? styles.loadingOverlayExiting : ''}`}>
      <div className={styles.centerContainer}>
        {/* Logo Concord com Brilho Pulsante */}
        <div className={styles.logoWrapper}>
          <div className={styles.logoGlow} />
          <img src="/logo.png" alt="Concord" className={styles.logoImg} />
        </div>

        {/* Barra de Progresso Suave */}
        <div className={styles.progressContainer}>
          <div className={styles.progressBar} />
        </div>

        {/* Mensagem de Status Rotativa */}
        <p className={styles.statusMessage}>{STATUS_MESSAGES[msgIndex]}</p>
        <p className={styles.subText}>Carregando ambiente do Concord</p>
      </div>

      {/* Dica estilo Discord no Rodapé */}
      <div className={styles.tipBox}>
        <span className={styles.tipBadge}>Dica</span>
        <p className={styles.tipText}>{DISCORD_TIPS[tipIndex]}</p>
      </div>
    </div>
  );
};
