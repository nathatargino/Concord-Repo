import styles from './Titlebar.module.css';

export function Titlebar() {
    // Only render if running inside Electron mapped window controls
    const isElectron = !!(window as any).electron;

    if (!isElectron) return null;

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
                {/* Concord Logo mark via SVG */}
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" />
                </svg>
                <span>Concord</span>
            </div>

            <div className={styles.right}>
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
