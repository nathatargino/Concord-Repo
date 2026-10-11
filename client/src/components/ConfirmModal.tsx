import React, { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import styles from './ConfirmModal.module.css';

export const ConfirmModal: React.FC = () => {
  const confirmModal = useAppStore((s) => s.confirmModal);
  const closeConfirmModal = useAppStore((s) => s.closeConfirmModal);

  useEffect(() => {
    if (!confirmModal?.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        confirmModal.onCancel?.();
        closeConfirmModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmModal, closeConfirmModal]);

  if (!confirmModal || !confirmModal.isOpen) return null;

  const isDanger = confirmModal.isDanger !== false; // default true for dangerous actions

  const handleConfirm = () => {
    confirmModal.onConfirm();
    closeConfirmModal();
  };

  const handleCancel = () => {
    confirmModal.onCancel?.();
    closeConfirmModal();
  };

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div
        className={`${styles.modal} ${!isDanger ? styles.modalNormal : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.header}>
          <div className={`${styles.iconWrapper} ${isDanger ? styles.iconDanger : styles.iconNormal}`}>
            {isDanger ? (
              <i className="fa-solid fa-triangle-exclamation" />
            ) : (
              <i className="fa-solid fa-circle-question" />
            )}
          </div>
          <div className={styles.titleArea}>
            <h3 className={styles.title}>{confirmModal.title}</h3>
          </div>
        </div>

        <div className={styles.body}>
          <p className={styles.message}>{confirmModal.message}</p>
          {confirmModal.subMessage && (
            <p className={styles.subMessage}>{confirmModal.subMessage}</p>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={handleCancel}
          >
            {confirmModal.cancelText || 'Cancelar'}
          </button>
          <button
            type="button"
            className={isDanger ? styles.confirmDangerBtn : styles.confirmNormalBtn}
            onClick={handleConfirm}
          >
            {confirmModal.confirmText || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};
