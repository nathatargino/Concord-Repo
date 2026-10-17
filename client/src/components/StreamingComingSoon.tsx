import React from 'react';
import styles from './StreamingComingSoon.module.css';
import { CrunchyrollIcon } from './MusicPanel';

interface StreamingComingSoonProps {
  platform: 'netflix' | 'prime' | 'crunchyroll';
  onBack?: () => void;
}

export const StreamingComingSoon: React.FC<StreamingComingSoonProps> = ({
  platform,
  onBack,
}) => {
  const isNetflix = platform === 'netflix';
  const isPrime = platform === 'prime';
  const isCrunchyroll = platform === 'crunchyroll';
  const name = isNetflix ? 'Netflix' : isPrime ? 'Prime Video' : 'Crunchyroll';

  const themeClass = isNetflix
    ? styles.netflixTheme
    : isPrime
    ? styles.primeTheme
    : styles.crunchyrollTheme;

  const badgeClass = isNetflix
    ? styles.netflixBadge
    : isPrime
    ? styles.primeBadge
    : styles.crunchyrollBadge;

  return (
    <div className={styles.container}>
      <div className={`${styles.iconWrapper} ${themeClass}`}>
        {isNetflix ? (
          <i className="fa-solid fa-n" style={{ fontWeight: 900 }} />
        ) : isPrime ? (
          <i className="fa-solid fa-play" />
        ) : (
          <CrunchyrollIcon />
        )}
      </div>

      <div className={`${styles.badge} ${badgeClass}`}>
        <i className="fa-solid fa-sparkles" />
        <span>Em Breve</span>
      </div>

      <h3 className={styles.title}>{name} no Concord</h3>
      
      <p className={styles.description}>
        Estamos finalizando a integração de Watch Party sincronizada para {isCrunchyroll ? 'a Crunchyroll' : isNetflix ? 'a Netflix' : 'o Prime Video'}.
        Em breve você poderá assistir seus animes, filmes e séries com seus amigos em tempo real com áudio compartilhado.
      </p>

      {onBack && (
        <button className={styles.backBtn} onClick={onBack}>
          <i className="fa-solid fa-arrow-left" />
          <span>Voltar para o YouTube</span>
        </button>
      )}
    </div>
  );
};
