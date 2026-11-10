import { SERVER_URL } from '../config';
import type { DbRoom } from './supabase';

/**
 * Fallback de busca: consulta o hub de tempo real (backend) por uma sala/servidor ativo em memória.
 * Necessário para servidores que existem no backend mas ainda não foram persistidos no Supabase
 * (ex: servidores criados quando a gravação original no banco falhou).
 */
export async function findLiveRoomInHub(idOrCode: string): Promise<DbRoom | null> {
  const clean = (idOrCode || '').trim();
  if (!clean) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/rooms/${encodeURIComponent(clean)}`);
    if (!res.ok) return null;
    const info = await res.json();
    if (!info?.id || !info?.code) return null;
    return {
      id: info.id,
      code: info.code,
      name: info.name || (info.isServer ? 'Servidor Concord' : `Sala ${info.code}`),
      icon_url: info.iconUrl || null,
      is_server: Boolean(info.isServer),
      created_at: new Date(Number.isFinite(info.createdAt) ? info.createdAt : Date.now()).toISOString(),
    };
  } catch {
    return null;
  }
}

