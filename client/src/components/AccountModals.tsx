import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../stores/useAppStore';
import toast from 'react-hot-toast';

declare global {
  interface Window {
    abrirModal?: (idModal: string) => void;
    fecharModal?: (idModal: string) => void;
  }
}

export const AccountModals: React.FC = () => {
  const [newUsername, setNewUsername] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  // Inicializar métodos globais abrirModal e fecharModal
  useEffect(() => {
    window.abrirModal = (idModal: string) => {
      const modal = document.getElementById(idModal);
      if (modal) {
        modal.style.display = 'flex';
      }
    };

    window.fecharModal = (idModal: string) => {
      const modal = document.getElementById(idModal);
      if (modal) {
        modal.style.display = 'none';
      }
    };

    // Fechar modal ao clicar fora da caixa principal
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target && target.classList && target.classList.contains('modal-concord')) {
        target.style.display = 'none';
      }
    };

    window.addEventListener('click', handleOutsideClick);

    // Carregar e-mail e apelido atual do usuário caso logado no Supabase
    const loadUserData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          if (user.email) setResetEmail(user.email);
          const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .maybeSingle();
          if (profile?.username) {
            setNewUsername(profile.username);
          }
        }
      } catch (err) {
        console.debug('[AccountModals] Error loading user:', err);
      }
    };

    loadUserData();

    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, []);

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) {
      toast.error('Digite um nome de usuário válido!');
      return;
    }

    const cleanName = newUsername.trim();
    setSavingUsername(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').upsert({
          id: user.id,
          username: cleanName,
          updated_at: new Date().toISOString(),
        });
      }

      localStorage.setItem('concord_username', cleanName);
      localStorage.setItem('concord_username_v1', cleanName);
      useAppStore.getState().setMyName(cleanName);

      toast.success('Nome de usuário alterado com sucesso!');
      if (window.fecharModal) window.fecharModal('modal-alterar-usuario');
    } catch (err) {
      console.error('[AccountModals] Erro ao alterar usuário:', err);
      toast.error('Erro ao salvar o nome de usuário.');
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim() || !resetEmail.includes('@')) {
      toast.error('Por favor, informe um e-mail válido!');
      return;
    }

    setSendingReset(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: window.location.origin,
      });

      if (error) throw error;

      toast.success('Link de segurança enviado para seu e-mail!');
      if (window.fecharModal) window.fecharModal('modal-alterar-senha');
    } catch (err: any) {
      console.error('[AccountModals] Erro ao enviar redefinição:', err);
      toast.error(err.message || 'Falha ao enviar e-mail de redefinição.');
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <>
      {/* Estrutura do Modal para Alterar Nome de Usuário */}
      <div id="modal-alterar-usuario" className="modal-concord">
        <div className="modal-conteudo">
          <span
            className="fechar-modal"
            onClick={() => window.fecharModal?.('modal-alterar-usuario')}
          >
            &times;
          </span>
          <h2>Alterar Nome de Usuário</h2>
          <p>Digite seu novo nome de usuário abaixo.</p>
          <form onSubmit={handleSaveUsername}>
            <div className="input-grupo">
              <input
                type="text"
                id="novo-usuario"
                placeholder="Ex: CromaGamer"
                autoComplete="off"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                maxLength={32}
              />
            </div>
            <button type="submit" className="botao-neon" disabled={savingUsername || !newUsername.trim()}>
              {savingUsername ? 'Salvando...' : 'Salvar Alteração'}
            </button>
          </form>
        </div>
      </div>

      {/* Estrutura do Modal para Alterar Senha */}
      <div id="modal-alterar-senha" className="modal-concord">
        <div className="modal-conteudo">
          <span
            className="fechar-modal"
            onClick={() => window.fecharModal?.('modal-alterar-senha')}
          >
            &times;
          </span>
          <h2>Redefinir Senha</h2>
          <p>Enviaremos um e-mail com um link de segurança para redefinir sua senha.</p>
          <form onSubmit={handleSendResetLink}>
            <div className="input-grupo">
              <input
                type="email"
                id="email-confirmacao"
                placeholder="seu@email.com"
                autoComplete="off"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />
            </div>
            <button type="submit" className="botao-neon" disabled={sendingReset || !resetEmail.trim()}>
              {sendingReset ? 'Enviando...' : 'Enviar Link'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};
