import { useState, useEffect } from 'react';
import styles from './Titlebar.module.css';

export function Titlebar() {
    // Only render if running inside Electron mapped window controls
    const isElectron = !!(window as any).electron;
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updateText, setUpdateText] = useState('Atualizar App');

    useEffect(() => {
        if (!isElectron) return;
        const unsub = (window as any).electron?.onUpdateMessage?.((msg: string) => {
            if (msg.includes('encontrada') || msg.includes('disponível') || msg.includes('Baixando')) {
                setUpdateAvailable(true);
                setUpdateText('Atualizar App');
            } else if (msg.includes('baixada') || msg.includes('pronta')) {
                setUpdateAvailable(true);
                setUpdateText('Reiniciar e Atualizar');
            } else if (msg.includes('atualizado')) {
                setUpdateAvailable(false);
            }
        });
        return () => {
            unsub?.();
        };
    }, [isElectron]);

    if (!isElectron) return null;

    const handleUpdateClick = () => {
        (window as any).electron?.checkForUpdates?.();
    };

    const handleMinimize = () => {
        (window as any).electron.minimize();
    };

    const handleMaximize = () => {
        (window as any).electron.maximize();
    };

    const handleClose = () => {
        (window as any).electron.close();
    };

    return (
        <div className={styles.titlebar}>
            <div className={styles.left}>
                <img src="/logo.png" alt="Concord Logo" className={styles.logoImage} />
                <span>Concord</span>
            </div>

            <div className={styles.right}>
                {updateAvailable && (
                    <button
                        type="button"
                        className={styles.updateButton}
                        onClick={handleUpdateClick}
                        title="Nova versão do Concord disponível! Clique para atualizar."
                    >
                        <i className="fa-solid fa-arrow-up-from-bracket" style={{ fontSize: '10px' }}></i>
                        <span>{updateText}</span>
                    </button>
                )}
                <button className={styles.controlButton} onClick={handleMinimize} title="Minimizar">
                    <svg viewBox="0 0 10 10">
                        <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
                    </svg>
                </button>
                <button className={styles.controlButton} onClick={handleMaximize} title="Maximizar">
                    <svg viewBox="0 0 10 10">
                        <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1" fill="none" />
                    </svg>
                </button>
                <button className={`${styles.controlButton} ${styles.controlClose}`} onClick={handleClose} title="Fechar">
                    <svg viewBox="0 0 10 10">
                        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
                        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
