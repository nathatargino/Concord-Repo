import React from 'react';
import styles from './StreamingComingSoon.module.css';

interface StreamingComingSoonProps {
  platform: 'netflix' | 'prime';
  onBack?: () => void;
}

export const StreamingComingSoon: React.FC<StreamingComingSoonProps> = ({
  platform,
  onBack,
}) => {
  const isNetflix = platform === 'netflix';
  const name = isNetflix ? 'Netflix' : 'Prime Video';

  return (
    <div className={styles.container}>
      <div className={`${styles.iconWrapper} ${isNetflix ? styles.netflixTheme : styles.primeTheme}`}>
        {isNetflix ? (
          <i className="fa-solid fa-n" style={{ fontWeight: 900 }} />
        ) : (
          <i className="fa-solid fa-play" />
        )}
      </div>

      <div className={`${styles.badge} ${isNetflix ? styles.netflixBadge : styles.primeBadge}`}>
        <i className="fa-solid fa-sparkles" />
        <span>Em Breve</span>
      </div>

      <h3 className={styles.title}>{name} no Concord</h3>
      
      <p className={styles.description}>
        Estamos finalizando a integração de Watch Party sincronizada para a {name}.
        Em breve você poderá assistir filmes e séries com seus amigos em tempo real com áudio compartilhado.
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
