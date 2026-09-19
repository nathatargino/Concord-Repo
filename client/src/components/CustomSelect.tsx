import React, { useState, useRef, useEffect } from 'react';
import styles from './CustomSelect.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: string;
  disabled?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Selecione uma opção...',
  icon,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div 
      className={`${styles.selectContainer} ${disabled ? styles.disabled : ''}`} 
      ref={containerRef}
    >
      <button
        type="button"
        className={`${styles.triggerBtn} ${isOpen ? styles.triggerBtnOpen : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        <span className={styles.labelWrapper}>
          {icon && <i className={`fa-solid ${icon} ${styles.triggerIcon}`} />}
          <span className={styles.selectedText} title={displayLabel}>
            {displayLabel}
          </span>
        </span>
        <i className={`fa-solid fa-chevron-down ${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} />
      </button>

      {isOpen && (
        <div className={styles.dropdownMenu} role="listbox">
          {options.length === 0 ? (
            <div className={styles.emptyOption}>Nenhuma opção disponível</div>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  className={`${styles.optionItem} ${isSelected ? styles.optionSelected : ''}`}
                  onClick={() => handleSelect(opt.value)}
                  role="option"
                  aria-selected={isSelected}
                  title={opt.label}
                >
                  <span className={styles.optionText}>{opt.label}</span>
                  {isSelected && (
                    <i className={`fa-solid fa-check ${styles.checkIcon}`} />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
