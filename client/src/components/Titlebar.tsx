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
                <img src="/logo.png" alt="Concord Logo" className={styles.logoImage} />
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
