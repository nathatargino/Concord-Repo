import { createClient } from '@supabase/supabase-js';
import { useAppStore } from '../stores/useAppStore';
import { applyTheme } from '../utils/theme';

const DEFAULT_SUPABASE_URL = 'https://zryjdjvqprdrhunmvhbj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyeWpkanZxcHJkcmh1bm12aGJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzUwOTAsImV4cCI6MjEwMzE1MTA5MH0.YTdvlUu3TivaghK9eDqkupXyup8GVRmyT0dKB31lGrQ';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

// Sanitize URL (ensure https:// prefix)
let supabaseUrl = rawUrl.trim();
if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
  supabaseUrl = `https://${supabaseUrl}`;
}

const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isConfigured) {
  console.warn(
    '[Concord Supabase] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configuradas no .env. Algumas funcionalidades persistentes usarão modo local fallback.'
  );
}

// Safely initialize client instance to prevent top-level script crashes
export const supabase = (() => {
  try {
    return createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-key',
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
  } catch (err) {
    console.error('[Concord Supabase] Erro ao inicializar Supabase client:', err);
    return createClient('https://placeholder.supabase.co', 'placeholder-key');
  }
})();

// Backup de sessão no safeStorage do Electron para persistência resiliente em novas builds/instalações
if (typeof window !== 'undefined') {
  try {
    supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        const electron = (window as any).electron;
        if (electron?.saveSecureToken) {
          if (session) {
            await electron.saveSecureToken('concord_supabase_session', JSON.stringify({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            }));
          } else if (event === 'SIGNED_OUT') {
            await electron.saveSecureToken('concord_supabase_session', '');
          }
        }
      } catch {}
    });
  } catch {}
}

let sessionRestorationPromise: Promise<void> | null = null;

export async function ensureSupabaseSessionRestored(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!sessionRestorationPromise) {
    sessionRestorationPromise = (async () => {
      try {
        const electron = (window as any).electron;
        if (electron?.loadSecureToken) {
          const { data: { session: existingSession } } = await supabase.auth.getSession();
          if (!existingSession) {
            const raw = await electron.loadSecureToken('concord_supabase_session');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed.access_token && parsed.refresh_token) {
                await supabase.auth.setSession(parsed);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Supabase] Falha ao restaurar sessão segura do Electron:', err);
      }
    })();
  }
  return sessionRestorationPromise;
}

// Inicia imediatamente em segundo plano
if (typeof window !== 'undefined') {
  ensureSupabaseSessionRestored().catch(() => {});
}

export const isUuid = (val?: string | null): boolean =>
  Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim()));

const DOMAIN_LIKE_NAME_REGEX = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|co|io|net|org|app|dev|br|ai|me|in)$/i;

/**
 * Valida um nome de exibição candidato. Retorna `null` quando o valor parece ser
 * metadado técnico (host do Supabase, URL ou domínio) em vez de um nome de pessoa.
 * Isso evita que valores como "xxxx.supabase.co" virem o nome do usuário no Concord.
 */
export function sanitizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return null;

  const lower = name.toLowerCase();
  let supabaseHost = '';
  try {
    supabaseHost = new URL(supabaseUrl).hostname.toLowerCase();
  } catch {
    supabaseHost = '';
  }

  if (
    lower.includes('supabase') ||
    (supabaseHost && lower.includes(supabaseHost)) ||
    lower.includes('://') ||
    DOMAIN_LIKE_NAME_REGEX.test(name)
  ) {
    return null;
  }

  return name;
}

function firstWord(value: unknown): string | null {
  const clean = sanitizeDisplayName(value);
  return clean ? clean.split(' ')[0] : null;
}

/**
 * Resolve o nome de exibição do Concord a partir do usuário autenticado.
 * Ordem: username/display_name do Concord -> nome do Google -> parte local do e-mail -> "Usuário".
 */
export function resolveAuthDisplayName(user: any): string {
  const meta = user?.user_metadata || {};
  return (
    sanitizeDisplayName(meta.username) ||
    sanitizeDisplayName(meta.display_name) ||
    firstWord(meta.given_name) ||
    firstWord(meta.full_name) ||
    firstWord(meta.name) ||
    sanitizeDisplayName(user?.email ? String(user.email).split('@')[0] : null) ||
    'Usuário'
  );
}

/**
 * Obtém ou gera o persistentId do cliente.
 * Em modo de desenvolvimento no navegador (ex: localhost:5173), isola por aba via sessionStorage
 * para permitir testar múltiplos usuários simultaneamente na mesma máquina sem colisão de conexões.
 */
export function getOrCreatePersistentId(): string {
  const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
  const isDev = !import.meta.env.PROD;

  if (isDev && !isElectron && typeof sessionStorage !== 'undefined') {
    let tabPid = sessionStorage.getItem('concord_tab_pid');
    if (!tabPid) {
      tabPid = 'tab_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 10));
      sessionStorage.setItem('concord_tab_pid', tabPid);
    }
    return tabPid;
  }

  let persistentId = localStorage.getItem('concord_pid');
  if (!persistentId) {
    persistentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    localStorage.setItem('concord_pid', persistentId);
  }
  return persistentId;
}

export function getSavedUsername(): string {
  const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
  const isDev = !import.meta.env.PROD;

  if (isDev && !isElectron && typeof sessionStorage !== 'undefined') {
    const tabName = sessionStorage.getItem('concord_tab_username');
    if (tabName && tabName.trim()) return tabName.trim();
  }

  return (localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '').trim();
}

export function saveUsername(name: string) {
  const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
  const isDev = !import.meta.env.PROD;

  if (isDev && !isElectron && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('concord_tab_username', name);
  }
  localStorage.setItem('concord_username', name);
  localStorage.setItem('concord_username_v1', name);
}

// Helper type definitions
export interface DbRoom {
  id: string;
  code: string;
  name: string;
  icon_url?: string | null;
  is_server?: boolean;
  created_by?: string | null;
  is_private?: boolean;
  created_at: string;
}

export interface DbChannel {
  id: string;
  server_id: string;
  name: string;
  created_at: string;
}

export interface DbMember {
  id: string;
  server_id: string;
  user_id?: string | null;
  username: string;
  avatar_url?: string | null;
  role?: string;
  joined_at: string;
}

export interface DbMessage {
  id: string;
  room_id: string;
  channel_id?: string | null;
  user_id?: string | null;
  sender_name: string;
  content: string;
  msg_type?: 'text' | 'image' | 'giphy' | 'file';
  file_url?: string | null;
  file_name?: string | null;
  created_at: string;
}

export interface DbProfile {
  id: string;
  username: string;
  avatar_url?: string | null;
  created_at: string;
}

export interface SavedServer {
  id: string;
  code: string;
  name: string;
  icon_url?: string | null;
  role?: string;
  joined_at?: string;
  lastAccessedAt?: number;
}

// ==========================================
// SALAS (Temporárias de 14h)
// ==========================================
export async function createRoomInSupabase(name: string, code: string, customId?: string): Promise<DbRoom | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: customId || `local-${Date.now()}`,
      code,
      name,
      is_server: false,
      created_at: new Date().toISOString(),
    };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();

    const insertPayload: any = {
      code: code.toUpperCase(),
      name,
      is_server: false,
      created_by: user?.id || null,
    };
    if (customId && isUuid(customId)) {
      insertPayload.id = customId;
    }

    const { data, error } = await supabase
      .from('rooms')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.warn('[Supabase] Aviso ao criar sala temporária:', error.message);
      return null;
    }

    return data as DbRoom;
  } catch (err) {
    console.warn('[Supabase] Exceção ao criar sala temporária:', err);
    return null;
  }
}

export async function findRoomInSupabase(codeOrId: string): Promise<DbRoom | null> {
  if (!codeOrId || !codeOrId.trim()) return null;

  const clean = codeOrId.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: clean,
      code: clean.toUpperCase(),
      name: clean.toUpperCase().startsWith('SRV-') ? 'Servidor Concord' : `Sala ${clean}`,
      is_server: clean.toUpperCase().startsWith('SRV-'),
      created_at: new Date().toISOString(),
    };
  }

  try {
    // 1. Tentar busca exata por código primeiro
    const { data: byCode, error: errCode } = await supabase
      .from('rooms')
      .select('*')
      .ilike('code', clean)
      .maybeSingle();

    if (byCode && !errCode) {
      return {
        ...byCode,
        is_server: byCode.is_server !== undefined ? Boolean(byCode.is_server) : byCode.code?.toUpperCase().startsWith('SRV-'),
      } as DbRoom;
    }

    // 2. Se não encontrou por código e tem formato de UUID ou ID, tenta por ID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
    if (isUUID) {
      const { data: byId, error: errId } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', clean)
        .maybeSingle();

      if (byId && !errId) {
        return {
          ...byId,
          is_server: byId.is_server !== undefined ? Boolean(byId.is_server) : byId.code?.toUpperCase().startsWith('SRV-'),
        } as DbRoom;
      }
    }

    return null;
  } catch (err) {
    console.warn('[Supabase] Exceção ao buscar sala/servidor:', err);
    return null;
  }
}

// ==========================================
// SERVIDORES PERMANENTES
// ==========================================

/**
 * Verifica se já existe um servidor com este nome (case-insensitive)
 */
export async function checkServerNameAvailable(serverName: string, _excludeServerId?: string): Promise<{ available: boolean; message?: string }> {
  const trimmed = serverName.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 40) {
    return { available: false, message: 'O nome do servidor deve ter entre 2 e 40 caracteres.' };
  }

  // Nomes legíveis de servidor são livres e podem se repetir (a unicidade é estrita apenas no código/ID)
  return { available: true };
}

/**
 * Cria um novo servidor permanente no Supabase com canal padrão '#Geral'
 */
export async function createServerInSupabase(serverName: string, code: string, customId?: string): Promise<DbRoom | null> {
  const trimmed = serverName.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    const mock = {
      id: customId || `local-srv-${Date.now()}`,
      code,
      name: trimmed,
      is_server: true,
      created_at: new Date().toISOString(),
    };
    saveMyServer({ id: mock.id, code: mock.code, name: mock.name, role: 'owner' });
    return mock;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Inserir Servidor na tabela rooms (com suporte a fallback de schema)
    let serverData: any = null;
    let serverErr: any = null;

    const fullPayload: any = {
      code: code.toUpperCase(),
      name: trimmed,
      is_server: true,
      created_by: user?.id || null,
    };
    if (customId && isUuid(customId)) {
      fullPayload.id = customId;
    }

    const res1 = await supabase
      .from('rooms')
      .insert(fullPayload)
      .select()
      .single();

    serverData = res1.data;
    serverErr = res1.error;

    // Se falhar porque a coluna is_server ainda não existe no schema do Supabase (PGRST204)
    if (serverErr && (serverErr.code === 'PGRST204' || serverErr.message?.includes('is_server'))) {
      console.warn('[Supabase] Coluna is_server ausente no banco. Gravando servidor em modo compatível...');
      const compatPayload: any = {
        code: code.toUpperCase(),
        name: trimmed,
        created_by: user?.id || null,
      };
      if (customId && isUuid(customId)) {
        compatPayload.id = customId;
      }
      const res2 = await supabase
        .from('rooms')
        .insert(compatPayload)
        .select()
        .single();
      serverData = res2.data;
      serverErr = res2.error;
    }

    if (serverErr) {
      console.error('[Supabase] Erro ao criar servidor:', serverErr.message);
      return null;
    }

    const createdServer: DbRoom = {
      ...serverData,
      is_server: true,
    };

    // 2. Criar canal padrão '#Geral' (se tabela existir)
    try {
      await supabase
        .from('server_channels')
        .insert({
          server_id: createdServer.id,
          name: 'Geral',
        });
    } catch (chErr) {
      console.warn('[Supabase] Tabela server_channels ainda não configurada no Supabase:', chErr);
    }

    // 3. Registrar o criador como membro Dono (se tabela existir)
    const username = sanitizeDisplayName(user?.user_metadata?.username) || sanitizeDisplayName(user?.user_metadata?.display_name) || sanitizeDisplayName(user?.email?.split('@')[0]) || 'Admin';
    if (user?.id) {
      try {
        await supabase
          .from('server_members')
          .insert({
            server_id: createdServer.id,
            user_id: user.id,
            username,
            role: 'owner',
          });
      } catch (memErr) {
        console.warn('[Supabase] Tabela server_members ainda não configurada no Supabase:', memErr);
      }
    }

    // 4. Salvar localmente em "Meus Servidores"
    saveMyServer({
      id: createdServer.id,
      code: createdServer.code,
      name: createdServer.name,
      icon_url: createdServer.icon_url,
      role: 'owner',
    });

    return createdServer;
  } catch (err) {
    console.error('[Supabase] Exceção ao criar servidor:', err);
    return null;
  }
}

/**
 * Vincula o usuário autenticado à tabela server_members como membro de um servidor existente
 */
export async function joinServerInSupabase(serverId: string): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) return true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const username = useAppStore.getState().myName ||
      sanitizeDisplayName(user?.user_metadata?.username) ||
      sanitizeDisplayName(user?.user_metadata?.display_name) ||
      sanitizeDisplayName(user?.email?.split('@')[0]) || 'Membro';

    let resolvedServerId = serverId;
    if (!isUuid(resolvedServerId)) {
      const room = await findRoomInSupabase(serverId);
      if (room?.id && isUuid(room.id)) {
        resolvedServerId = room.id;
      }
    }

    if (isUuid(resolvedServerId)) {
      const { data: existing } = await supabase
        .from('server_members')
        .select('id')
        .eq('server_id', resolvedServerId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!existing) {
        await supabase
          .from('server_members')
          .insert({
            server_id: resolvedServerId,
            user_id: user.id,
            username,
            role: 'member',
          });
      }
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Erro ao associar membro ao servidor:', err);
    return false;
  }
}

/**
 * Atualiza o nome do servidor (apenas para o dono)
 */
export async function updateServerNameInSupabase(serverId: string, newName: string): Promise<{ success: boolean; message?: string }> {
  const check = await checkServerNameAvailable(newName, serverId);
  if (!check.available) {
    return { success: false, message: check.message };
  }

  const trimmed = newName.trim();
  saveMyServer({ id: serverId, name: trimmed });

  if (!supabaseUrl || !supabaseAnonKey) {
    return { success: true };
  }

  try {
    let query = supabase.from('rooms').update({ name: trimmed });
    if (isUuid(serverId)) {
      query = query.eq('id', serverId);
    } else {
      query = query.ilike('code', serverId);
    }

    const { error } = await query;

    if (error) {
      return { success: false, message: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * Atualiza a logo/ícone do servidor
 */
export async function updateServerLogoInSupabase(serverId: string, iconUrl: string): Promise<boolean> {
  saveMyServer({ id: serverId, icon_url: iconUrl });

  if (!supabaseUrl || !supabaseAnonKey) {
    return true;
  }

  try {
    let query = supabase.from('rooms').update({ icon_url: iconUrl });
    if (isUuid(serverId)) {
      query = query.eq('id', serverId);
    } else {
      query = query.ilike('code', serverId);
    }

    const { error } = await query;
    if (error && (error.code === 'PGRST204' || error.message?.includes('icon_url'))) {
      console.warn('[Supabase] Coluna icon_url ainda não migrada em rooms. Logo salva localmente.');
      return true;
    }
    return !error;
  } catch (err) {
    console.warn('[Supabase] Falha ao atualizar logo:', err);
    return false;
  }
}

// ==========================================
// HISTÓRICO: MEUS SERVIDORES & CONTROLE DE SAÍDA
// ==========================================

const MY_SERVERS_KEY = 'concord_my_servers_list';
const LEFT_SERVERS_KEY = 'concord_left_servers_v2';

export function getLeftServers(): string[] {
  try {
    const raw = localStorage.getItem(LEFT_SERVERS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map((item: any) => String(item).toLowerCase().trim()) : [];
  } catch {
    return [];
  }
}

export function isServerLeft(serverId?: string | null, serverCode?: string | null): boolean {
  if (!serverId && !serverCode) return false;
  const left = getLeftServers();
  if (left.length === 0) return false;

  const idNorm = serverId ? String(serverId).toLowerCase().trim() : '';
  const codeNorm = serverCode ? String(serverCode).toLowerCase().trim() : '';

  return (Boolean(idNorm) && left.includes(idNorm)) || (Boolean(codeNorm) && left.includes(codeNorm));
}

export function markServerAsLeft(serverId: string, serverCode?: string): void {
  try {
    const current = getLeftServers();
    const set = new Set(current);
    if (serverId) {
      set.add(String(serverId).toLowerCase().trim());
    }
    if (serverCode) {
      set.add(String(serverCode).toLowerCase().trim());
    }
    const arr = Array.from(set);
    localStorage.setItem(LEFT_SERVERS_KEY, JSON.stringify(arr));
    savePrefsToElectron({ [LEFT_SERVERS_KEY]: JSON.stringify(arr) });
  } catch (err) {
    console.warn('Erro ao marcar servidor como saído:', err);
  }
}

export function unmarkServerAsLeft(serverId: string, serverCode?: string): void {
  try {
    const current = getLeftServers();
    if (current.length === 0) return;
    const idNorm = serverId ? String(serverId).toLowerCase().trim() : '';
    const codeNorm = serverCode ? String(serverCode).toLowerCase().trim() : '';

    const filtered = current.filter(item => item !== idNorm && item !== codeNorm);
    localStorage.setItem(LEFT_SERVERS_KEY, JSON.stringify(filtered));
    savePrefsToElectron({ [LEFT_SERVERS_KEY]: JSON.stringify(filtered) });
  } catch (err) {
    console.warn('Erro ao desmarcar servidor como saído:', err);
  }
}

export function saveMyServer(server: Partial<SavedServer> & { id: string }): void {
  try {
    // Ao entrar ou interagir voluntariamente com o servidor, remove-o da lista de saídos
    unmarkServerAsLeft(server.id, server.code);

    const raw = localStorage.getItem(MY_SERVERS_KEY);
    let list: SavedServer[] = raw ? JSON.parse(raw) : [];

    const isGenericName = (name?: string) => {
      if (!name) return true;
      const n = name.trim().toLowerCase();
      return n === 'servidor concord' || n === 'sala concord' || n === 'concord' || n === 'sala rápida' || n.startsWith('sala ');
    };

    const existingIndex = list.findIndex(s => s.id === server.id || (server.code && s.code === server.code));
    if (existingIndex >= 0) {
      const existing = list[existingIndex];
      const newNameIsCustom = Boolean(server.name && !isGenericName(server.name));
      const existingNameIsCustom = Boolean(existing.name && !isGenericName(existing.name));
      const nameToSave = newNameIsCustom
        ? server.name!
        : (existingNameIsCustom ? existing.name : (server.name || existing.name || 'Servidor Concord'));
      const iconToSave = server.icon_url !== undefined ? server.icon_url : existing.icon_url;

      list[existingIndex] = {
        ...existing,
        ...server,
        name: nameToSave,
        code: server.code || existing.code || '',
        icon_url: iconToSave,
        role: server.role || existing.role || 'member',
        joined_at: new Date().toISOString(),
      };
    } else {
      list.unshift({
        id: server.id,
        code: server.code || '',
        name: server.name && !isGenericName(server.name) ? server.name : (server.name || 'Servidor Concord'),
        icon_url: server.icon_url || null,
        role: server.role || 'member',
        joined_at: new Date().toISOString(),
      });
    }

    // Filtra apenas registros válidos de servidores (nunca salas temporárias)
    list = list.filter(s => (s.code && s.code.toUpperCase().startsWith('SRV-')) || (s.id && s.id.toLowerCase().startsWith('srv-')) || isUuid(s.id));

    const stringified = JSON.stringify(list.slice(0, 50));
    localStorage.setItem(MY_SERVERS_KEY, stringified);
    savePrefsToElectron({ [MY_SERVERS_KEY]: stringified });

    // Sincronizar filiação do usuário no servidor na nuvem (server_members)
    if (supabaseUrl && supabaseAnonKey) {
      (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            let targetServerId = server.id;
            if (!isUuid(targetServerId)) {
              const r = await findRoomInSupabase(server.code || server.id);
              if (r?.id && isUuid(r.id)) targetServerId = r.id;
            }
            if (isUuid(targetServerId)) {
              const username = resolveAuthDisplayName(user);
              await supabase.from('server_members').upsert({
                server_id: targetServerId,
                user_id: user.id,
                username: username || 'Membro',
                role: server.role || 'member',
                joined_at: new Date().toISOString()
              }, { onConflict: 'server_id,user_id' });
              window.dispatchEvent(new CustomEvent('concord:servers-updated'));
            }
          }
        } catch (err) {
          console.warn('[Supabase] Erro ao sincronizar server_members:', err);
        }
      })();
    }
  } catch (err) {
    console.warn('Erro ao salvar servidor local:', err);
  }
}

// ==========================================
// SERVIDORES RECENTES (Últimos 3 acessados)
// ==========================================

export const RECENT_SERVERS_KEY = 'concord_recent_servers_v1';

export function getRecentServers(): SavedServer[] {
  try {
    const raw = localStorage.getItem(RECENT_SERVERS_KEY);
    if (!raw) return [];
    const list: SavedServer[] = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function recordRecentServerAccess(server: SavedServer): SavedServer[] {
  try {
    const current = getRecentServers();
    const updated: SavedServer = {
      ...server,
      lastAccessedAt: Date.now(),
    };
    const filtered = current.filter(s => s.id !== server.id && s.code !== server.code);
    filtered.unshift(updated);
    const capped = filtered.slice(0, 3);
    localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(capped));
    savePrefsToElectron({ [RECENT_SERVERS_KEY]: JSON.stringify(capped) });
    window.dispatchEvent(new CustomEvent('concord:recent-servers-updated', { detail: { recentServers: capped } }));
    return capped;
  } catch {
    return [];
  }
}

export const RECENT_CALL_SERVERS_KEY = 'concord_recent_call_servers_v1';

export function getRecentCallServers(): SavedServer[] {
  try {
    const raw = localStorage.getItem(RECENT_CALL_SERVERS_KEY);
    if (!raw) return [];
    const list: SavedServer[] = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, 2) : [];
  } catch {
    return [];
  }
}

export function recordRecentCallServer(server: SavedServer): SavedServer[] {
  try {
    const current = getRecentCallServers();
    const updated: SavedServer = {
      ...server,
      lastAccessedAt: Date.now(),
    };
    const filtered = current.filter(s => s.id !== server.id && s.code !== server.code);
    filtered.unshift(updated);
    const capped = filtered.slice(0, 2);
    localStorage.setItem(RECENT_CALL_SERVERS_KEY, JSON.stringify(capped));
    savePrefsToElectron({ [RECENT_CALL_SERVERS_KEY]: JSON.stringify(capped) });
    window.dispatchEvent(new CustomEvent('concord:recent-call-servers-updated', { detail: { recentCallServers: capped } }));
    return capped;
  } catch {
    return [];
  }
}

// ==========================================
// HISTÓRICO: SALAS TEMPORÁRIAS (14h)
// ==========================================

export interface SavedRoom {
  id: string;
  code: string;
  name: string;
  createdAt: number;
  expiresAt: number;
}

const RECENT_ROOMS_KEY = 'concord_recent_rooms';

export function saveRecentRoom(room: { id: string; code: string; name?: string; createdAt?: number }): void {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    let list: SavedRoom[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const created = room.createdAt || now;
    const expiresAt = created + 14 * 60 * 60 * 1000;

    // Remove duplicatas e salas já expiradas
    list = list.filter(r => r.id !== room.id && r.code.toUpperCase() !== room.code.toUpperCase() && r.expiresAt > now);

    list.unshift({
      id: room.id,
      code: room.code.toUpperCase(),
      name: room.name || `Sala ${room.code.toUpperCase()}`,
      createdAt: created,
      expiresAt,
    });

    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(list.slice(0, 30)));

    // Sincronizar na nuvem se autenticado para múltiplos dispositivos
    if (supabaseUrl && supabaseAnonKey) {
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        let canonicalId = room.id;
        if (!isUuid(canonicalId)) {
          const found = await findRoomInSupabase(room.code || room.id);
          if (found?.id && isUuid(found.id)) {
            canonicalId = found.id;
          }
        }
        if (isUuid(canonicalId)) {
          await supabase.from('user_recent_rooms').upsert({
            user_id: user.id,
            room_id: canonicalId,
            code: room.code.toUpperCase(),
            name: room.name || `Sala ${room.code.toUpperCase()}`,
            expires_at: new Date(expiresAt).toISOString(),
            last_accessed_at: new Date().toISOString(),
          }, { onConflict: 'user_id,room_id' });
        }
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('Erro ao salvar sala recente:', err);
  }
}

export function getRecentRooms(): SavedRoom[] {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return [];
    const list: SavedRoom[] = JSON.parse(raw);
    const now = Date.now();
    const active = list.filter(r => r.expiresAt > now);
    if (active.length !== list.length) {
      localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(active));
    }
    return active;
  } catch {
    return [];
  }
}

export async function syncCloudRecentRooms(): Promise<SavedRoom[]> {
  const localRooms = getRecentRooms();
  if (!supabaseUrl || !supabaseAnonKey) return localRooms;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return localRooms;

    const nowIso = new Date().toISOString();
    const { data: cloudRooms, error } = await supabase
      .from('user_recent_rooms')
      .select('room_id, code, name, created_at, expires_at')
      .eq('user_id', user.id)
      .gt('expires_at', nowIso)
      .order('last_accessed_at', { ascending: false });

    if (error || !cloudRooms) return localRooms;

    let merged = [...localRooms];
    cloudRooms.forEach((cr: any) => {
      const exists = merged.some(lr => lr.id === cr.room_id || lr.code.toUpperCase() === cr.code.toUpperCase());
      if (!exists) {
        merged.push({
          id: cr.room_id,
          code: cr.code.toUpperCase(),
          name: cr.name,
          createdAt: new Date(cr.created_at).getTime(),
          expiresAt: new Date(cr.expires_at).getTime(),
        });
      }
    });

    const now = Date.now();
    merged = merged.filter(r => r.expiresAt > now);
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(merged));
    return merged;
  } catch (err) {
    console.warn('[Supabase] Falha ao sincronizar salas temporárias na nuvem:', err);
    return localRooms;
  }
}

export function removeRecentRoom(idOrCode: string): void {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return;
    const list: SavedRoom[] = JSON.parse(raw);
    const filtered = list.filter(r => r.id !== idOrCode && r.code.toUpperCase() !== idOrCode.toUpperCase());
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(filtered));

    if (supabaseUrl && supabaseAnonKey) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          Promise.resolve(
            supabase.from('user_recent_rooms').delete().match({ user_id: user.id, room_id: idOrCode })
          ).catch(() => {});
        }
      }).catch(() => {});
    }
  } catch {}
}

export function formatRoomTimeRemaining(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expirada';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m restantes`;
  }
  return `${minutes}m restantes`;
}

export async function savePrefsToElectron(prefs: Record<string, string>) {
  const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
  if (isElectron && (window as any).electron?.savePreferences) {
    (window as any).electron.savePreferences(prefs);
  }
}

export interface UserAccountSettings {
  systemNotifications: boolean;
  theme: 'dark' | 'light';
  updatedAt?: string;
  [key: string]: any;
}

export function getLocalUserSettings(): UserAccountSettings {
  return {
    systemNotifications: typeof window !== 'undefined' ? localStorage.getItem('concord_system_notifications') !== 'false' : true,
    theme: (typeof window !== 'undefined' ? (localStorage.getItem('concord_theme') as 'dark' | 'light') : null) || 'dark',
  };
}

export async function saveUserSettingsToCloud(settings: Partial<UserAccountSettings>): Promise<void> {
  const current = getLocalUserSettings();
  const merged: UserAccountSettings = {
    ...current,
    ...settings,
    updatedAt: new Date().toISOString(),
  };

  // 1. Atualizar localStorage e estado Zustand local imediatamente
  if (merged.systemNotifications !== undefined) {
    try {
      localStorage.setItem('concord_system_notifications', String(merged.systemNotifications));
    } catch {}
    useAppStore.getState().setSystemNotificationsEnabled(merged.systemNotifications);
  }
  if (merged.theme) {
    try {
      localStorage.setItem('concord_theme', merged.theme);
    } catch {}
  }

  // 2. Persistir localmente no Electron se disponível
  savePrefsToElectron({
    concord_system_notifications: String(merged.systemNotifications),
    concord_theme: merged.theme,
  }).catch(() => {});

  // 3. Persistir na conta Supabase se logado (permanente em qualquer máquina)
  if (supabaseUrl && supabaseAnonKey) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // 3.1. Salvar em auth.users.user_metadata (permanente na conta, retornado em todo login)
        await supabase.auth.updateUser({
          data: {
            concord_settings: merged,
          },
        });

        // 3.2. Salvar em public.profiles
        await supabase
          .from('profiles')
          .update({
            settings: merged,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);
      }
    } catch (err) {
      console.warn('[UserSettings] Erro ao sincronizar configurações na nuvem:', err);
    }
  }
}

export async function syncProfileAfterAuth(user: any): Promise<{ username: string; avatarUrl: string | null }> {
  const meta = user.user_metadata || {};
  // Nome do Google (primeiro nome) com fallback seguro; nunca usa host/URL do Supabase
  const googleFirstName =
    firstWord(meta.given_name) ||
    firstWord(meta.full_name) ||
    firstWord(meta.name) ||
    sanitizeDisplayName(user.email ? String(user.email).split('@')[0] : null) ||
    'Usuário';
  const googleAvatar = meta.avatar_url || meta.picture || null;

  const isCustomProfile = localStorage.getItem('concord_is_custom_profile') === 'true';
  const localSavedName = (sanitizeDisplayName(useAppStore.getState().myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '') || '');
  const localSavedAvatar = (useAppStore.getState().myAvatarUrl || localStorage.getItem('concord_avatar_url') || '').trim();

  let existingProfile: { username?: string | null; avatar_url?: string | null; settings?: any } | null = null;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('username, avatar_url, settings')
      .eq('id', user.id)
      .maybeSingle();
    existingProfile = data;
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar perfil existente:', err);
  }

  let finalName = '';
  let finalAvatar: string | null = null;

  const hasCustomLocalName = Boolean(localSavedName && (isCustomProfile || (localSavedName !== 'Usuário' && !localSavedName.startsWith('Concordiano'))));
  const hasCustomLocalAvatar = Boolean(localSavedAvatar);

  const existingProfileName = sanitizeDisplayName(existingProfile?.username);

  if (existingProfile && existingProfileName) {
    // Vínculo de Usuário Anônimo / Conta Existente:
    // Se o usuário customizou dados na sessão anônima, preservamos os dados customizados; caso contrário mantemos os dados da conta.
    finalName = hasCustomLocalName ? localSavedName : existingProfileName;
    finalAvatar = hasCustomLocalAvatar ? localSavedAvatar : (existingProfile.avatar_url || null);
  } else {
    // Novo Usuário (Primeiro Acesso) ou perfil com nome inválido:
    // Se havia customização anônima prévia, preserva esses dados.
    // Senão, sincroniza o primeiro nome e a foto fornecidos pelo Google OAuth.
    finalName = hasCustomLocalName ? localSavedName : googleFirstName;
    finalAvatar = hasCustomLocalAvatar ? localSavedAvatar : (existingProfile?.avatar_url || googleAvatar);
  }

  const customTag = (existingProfile as any)?.custom_tag || generateUserTag(user.id);
  localStorage.setItem('concord_user_tag', customTag);

  try {
    await supabase.from('profiles').upsert({
      id: user.id,
      username: finalName,
      display_name: finalName,
      custom_tag: customTag,
      avatar_url: finalAvatar || null,
      email: user.email || null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[Supabase] Erro ao persistir perfil no banco:', err);
  }

  localStorage.setItem('concord_username', finalName);
  localStorage.setItem('concord_username_v1', finalName);
  if (finalAvatar) {
    localStorage.setItem('concord_avatar_url', finalAvatar);
  } else {
    localStorage.removeItem('concord_avatar_url');
  }
  useAppStore.getState().setMyName(finalName);
  useAppStore.getState().setMyAvatarUrl(finalAvatar);
  useAppStore.getState().setMyTag(customTag);
  await savePrefsToElectron({
    concord_username: finalName,
    concord_avatar_url: finalAvatar || '',
    concord_user_tag: customTag,
  });

  // Restaurar e aplicar configurações do usuário salvas na conta
  const cloudSettings: UserAccountSettings | null =
    (existingProfile as any)?.settings ||
    meta?.concord_settings ||
    null;

  if (cloudSettings) {
    if (typeof cloudSettings.systemNotifications === 'boolean') {
      try {
        localStorage.setItem('concord_system_notifications', String(cloudSettings.systemNotifications));
      } catch {}
      useAppStore.getState().setSystemNotificationsEnabled(cloudSettings.systemNotifications);
    }
    if (cloudSettings.theme && (cloudSettings.theme === 'dark' || cloudSettings.theme === 'light')) {
      try {
        localStorage.setItem('concord_theme', cloudSettings.theme);
      } catch {}
      applyTheme(cloudSettings.theme);
    }
  }

  // Disparar sincronização em nuvem completa multi-dispositivo em segundo plano
  syncCloudUserData(user.id).catch(() => {});

  return { username: finalName, avatarUrl: finalAvatar };
}

// ==========================================
// SISTEMA SOCIAL: AMIGOS E DMs
// ==========================================

export interface Friend {
  id: string; // ID da amizade
  userId: string;
  friendId: string;
  friendName: string;
  friendAvatarUrl: string | null;
  friendTag: string;
  status: 'pending' | 'accepted' | 'blocked';
  isIncomingRequest?: boolean;
  onlineStatus?: 'online' | 'offline';
}

export interface DirectChat {
  id: string; // ID do chat 1:1
  partnerId: string;
  partnerName: string;
  partnerAvatarUrl: string | null;
  partnerTag?: string;
  lastMessage?: string;
  updatedAt?: string;
}

export interface DirectMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  avatarUrl?: string | null;
  content: string;
  msgType?: string;
  fileUrl?: string | null;
  fileName?: string | null;
  createdAt: string;
}

export function generateUserTag(userId?: string): string {
  if (userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash |= 0;
    }
    const num = Math.abs(hash % 9000) + 1000;
    return `${num}`;
  }
  return `${Math.floor(1000 + Math.random() * 9000)}`;
}

export function getSavedUserTag(): string {
  let tag = localStorage.getItem('concord_user_tag');
  if (!tag) {
    tag = generateUserTag(getOrCreatePersistentId());
    localStorage.setItem('concord_user_tag', tag);
  }
  return tag;
}

/**
 * Sincronização central multi-dispositivo na nuvem (Chamada no login ou carregamento)
 */
export async function syncCloudUserData(userId?: string): Promise<void> {
  try {
    const uid = userId || (await supabase.auth.getUser())?.data?.user?.id;
    if (!uid) return;

    // 1. Sincronizar dados de perfil na nuvem
    if (supabaseUrl && supabaseAnonKey) {
      const { data: prof } = await supabase.from('profiles').select('username, display_name, avatar_url, custom_tag, settings').eq('id', uid).maybeSingle();
      if (prof) {
        if (prof.username) {
          useAppStore.getState().setMyName(prof.username);
          localStorage.setItem('concord_username', prof.username);
        }
        if (prof.avatar_url) {
          useAppStore.getState().setMyAvatarUrl(prof.avatar_url);
          localStorage.setItem('concord_avatar_url', prof.avatar_url);
        }
        if (prof.custom_tag) {
          useAppStore.getState().setMyTag(prof.custom_tag);
          localStorage.setItem('concord_user_tag', prof.custom_tag);
        }
      }

      // Sincronizar configurações do usuário associadas à conta
      let userSettings: UserAccountSettings | null = (prof as any)?.settings || null;
      if (!userSettings) {
        const authUser = (await supabase.auth.getUser())?.data?.user;
        if (authUser?.user_metadata?.concord_settings) {
          userSettings = authUser.user_metadata.concord_settings;
        }
      }

      if (userSettings) {
        if (typeof userSettings.systemNotifications === 'boolean') {
          try {
            localStorage.setItem('concord_system_notifications', String(userSettings.systemNotifications));
          } catch {}
          useAppStore.getState().setSystemNotificationsEnabled(userSettings.systemNotifications);
        }
        if (userSettings.theme && (userSettings.theme === 'dark' || userSettings.theme === 'light')) {
          try {
            localStorage.setItem('concord_theme', userSettings.theme);
          } catch {}
          applyTheme(userSettings.theme);
        }
        savePrefsToElectron({
          concord_system_notifications: String(userSettings.systemNotifications ?? true),
          concord_theme: userSettings.theme || 'dark',
        }).catch(() => {});
      }
    }

    // 2. Sincronizar salas temporárias ativas
    const cloudRooms = await syncCloudRecentRooms();
    useAppStore.getState().setRecentRooms(cloudRooms);

    // 3. Sincronizar servidores
    const servers = await getMyServers();
    if (servers && servers.length > 0) {
      useAppStore.getState().setServers(servers);
    }
    window.dispatchEvent(new CustomEvent('concord:servers-updated', { detail: { servers } }));

    // 4. Sincronizar amigos
    const friends = await fetchFriendsFromSupabase();
    useAppStore.getState().setFriends(friends);

    // 5. Sincronizar chats diretos
    const dms = await fetchDirectChatsFromSupabase();
    useAppStore.getState().setDirectChats(dms);
  } catch (err) {
    console.warn('[CloudSync] Erro na sincronização multi-dispositivo:', err);
  }
}

export async function fetchFriendsFromSupabase(): Promise<Friend[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    try {
      const raw = localStorage.getItem('concord_mock_friends');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const raw = localStorage.getItem('concord_mock_friends');
      return raw ? JSON.parse(raw) : [];
    }

    const { data, error } = await supabase
      .from('friendships')
      .select('id, user_id, friend_id, status, requester_id, created_at')
      .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

    if (error) {
      console.warn('[Supabase] Erro ao buscar amizades:', error.message);
      const raw = localStorage.getItem('concord_mock_friends');
      return raw ? JSON.parse(raw) : [];
    }

    const targetUserIds = Array.from(new Set(
      (data || []).map((f: any) => (f.user_id === user.id ? f.friend_id : f.user_id)).filter(Boolean)
    ));

    let profilesMap = new Map<string, { username: string; avatar_url: string | null; custom_tag: string }>();
    if (targetUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, custom_tag')
        .in('id', targetUserIds);

      (profiles || []).forEach((p: any) => {
        profilesMap.set(p.id, {
          username: p.username || 'Amigo',
          avatar_url: p.avatar_url || null,
          custom_tag: p.custom_tag || generateUserTag(p.id),
        });
      });
    }

    const result: Friend[] = (data || []).map((f: any) => {
      const partnerId = f.user_id === user.id ? f.friend_id : f.user_id;
      const partnerProfile = profilesMap.get(partnerId);
      const isIncoming = f.status === 'pending' && f.requester_id !== user.id;

      return {
        id: f.id,
        userId: user.id,
        friendId: partnerId,
        friendName: partnerProfile?.username || 'Usuário',
        friendAvatarUrl: partnerProfile?.avatar_url || null,
        friendTag: partnerProfile?.custom_tag || generateUserTag(partnerId),
        status: f.status,
        isIncomingRequest: isIncoming,
        onlineStatus: 'offline',
      };
    });

    // Mesclar solicitações pendentes locais / mock que possam não estar ainda no Supabase
    try {
      const raw = localStorage.getItem('concord_mock_friends');
      if (raw) {
        const localList: Friend[] = JSON.parse(raw);
        for (const lf of localList) {
          if (!result.some(r => r.id === lf.id || (lf.friendId && r.friendId === lf.friendId) || (lf.friendName && r.friendName?.trim().toLowerCase() === lf.friendName?.trim().toLowerCase()))) {
            result.push(lf);
          }
        }
      }
    } catch {}

    localStorage.setItem('concord_mock_friends', JSON.stringify(result));
    return result;
  } catch (err) {
    console.warn('[Supabase] Exceção ao buscar amigos:', err);
    try {
      const raw = localStorage.getItem('concord_mock_friends');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

export async function sendFriendRequestToSupabase(identifier: string, targetUserId?: string): Promise<{ success: boolean; message: string }> {
  let clean = identifier.trim();
  if (clean.startsWith('@')) {
    clean = clean.substring(1).trim();
  }
  if (!clean && !targetUserId) return { success: false, message: 'Digite o identificador do amigo (ex: Nome#1234 ou nome).' };

  let searchName = clean;
  let searchTag = '';
  if (clean.includes('#')) {
    const parts = clean.split('#');
    searchName = parts[0].trim();
    searchTag = parts[1].trim();
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    const mockFriend: Friend = {
      id: `local-friend-${Date.now()}`,
      userId: 'me',
      friendId: targetUserId || `mock-${Date.now()}`,
      friendName: searchName || 'Amigo',
      friendAvatarUrl: null,
      friendTag: searchTag || '0001',
      status: 'pending',
      isIncomingRequest: false,
      onlineStatus: 'offline',
    };
    const list = await fetchFriendsFromSupabase();
    list.unshift(mockFriend);
    localStorage.setItem('concord_mock_friends', JSON.stringify(list));
    useAppStore.getState().setFriends(list);
    window.dispatchEvent(new CustomEvent('concord:friends-updated'));
    return { success: true, message: `Solicitação enviada para ${searchName || 'usuário'}!` };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, message: 'Você precisa estar conectado em uma conta para adicionar amigos online.' };

    // 1. Garante que o perfil do usuário atual existe em public.profiles para não quebrar chave estrangeira
    const myName = useAppStore.getState().myName || resolveAuthDisplayName(user);
    const myTag = useAppStore.getState().myTag || getSavedUserTag() || generateUserTag(user.id);
    try {
      await supabase.from('profiles').upsert({
        id: user.id,
        username: myName,
        custom_tag: myTag,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch {}

    let matchedUser = null;

    // Se temos targetUserId (UUID), buscar perfil direto pelo ID
    if (targetUserId && isUuid(targetUserId)) {
      const { data: userById } = await supabase
        .from('profiles')
        .select('id, username, display_name, custom_tag, avatar_url')
        .eq('id', targetUserId)
        .maybeSingle();
      if (userById) {
        matchedUser = userById;
      }
    }

    if (!matchedUser) {
      // 2. Buscar usuários candidatos pelo nome ou display_name (case-insensitive)
      let query = supabase.from('profiles').select('id, username, display_name, custom_tag, avatar_url');
      if (searchName) {
        query = query.or(`username.ilike.${searchName},display_name.ilike.${searchName}`);
      }

      const { data: foundUsers } = await query;
      if (foundUsers && foundUsers.length > 0) {
        // Filtrar pelo custom_tag (ou tag calculada ou prefixo id)
        if (searchTag) {
          matchedUser = foundUsers.find((u: any) => {
            const uTag = String(u.custom_tag || generateUserTag(u.id) || '').trim().toLowerCase();
            const uId4 = (u.id ? u.id.slice(0, 4) : '').toLowerCase();
            return uTag === searchTag.toLowerCase() || uId4 === searchTag.toLowerCase();
          });
        }
        if (!matchedUser) {
          matchedUser = foundUsers[0];
        }
      }
    }

    // Se não encontrou no Supabase (usuário não logado/visitante na sala), criar solicitação pendente local
    if (!matchedUser) {
      if (searchName || targetUserId) {
        const fallbackFriend: Friend = {
          id: `local-friend-${Date.now()}`,
          userId: user.id,
          friendId: targetUserId || `guest-${Date.now()}`,
          friendName: searchName || 'Usuário',
          friendAvatarUrl: null,
          friendTag: searchTag || (targetUserId ? targetUserId.slice(0, 4).toUpperCase() : '0000'),
          status: 'pending',
          isIncomingRequest: false,
          onlineStatus: 'offline',
        };
        const currentFriends = useAppStore.getState().friends || [];
        const updated = [fallbackFriend, ...currentFriends.filter(f => f.friendName?.trim().toLowerCase() !== searchName.trim().toLowerCase())];
        useAppStore.getState().setFriends(updated);
        try {
          localStorage.setItem('concord_mock_friends', JSON.stringify(updated));
        } catch {}
        window.dispatchEvent(new CustomEvent('concord:friends-updated'));
        return { success: true, message: `Solicitação de amizade enviada para ${searchName}!` };
      }
      return { success: false, message: 'Nenhum usuário encontrado com esse identificador.' };
    }

    const targetUser = matchedUser;
    if (targetUser.id === user.id) {
      return { success: false, message: 'Você não pode adicionar a si mesmo como amigo.' };
    }

    // Se o custom_tag do alvo estava nulo no banco, atualiza com a tag calculada
    if (!targetUser.custom_tag) {
      const generated = generateUserTag(targetUser.id);
      supabase.from('profiles').update({ custom_tag: generated }).eq('id', targetUser.id).then(() => {}, () => {});
    }

    // 3. Verificar relação de amizade existente de forma segura
    const { data: existingRows } = await supabase
      .from('friendships')
      .select('id, status, requester_id, user_id, friend_id')
      .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

    const existing = existingRows?.find((f: any) =>
      (f.user_id === user.id && f.friend_id === targetUser.id) ||
      (f.user_id === targetUser.id && f.friend_id === user.id)
    );

    const targetDisplayName = targetUser.username || targetUser.display_name || 'Usuário';

    if (existing) {
      if (existing.status === 'accepted') {
        return { success: false, message: `Você e ${targetDisplayName} já são amigos!` };
      }
      if (existing.status === 'pending') {
        if (existing.requester_id === targetUser.id) {
          // O outro usuário já havia enviado solicitação! Aceita instantaneamente!
          await supabase.from('friendships').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', existing.id);
          const updated = await fetchFriendsFromSupabase();
          useAppStore.getState().setFriends(updated);
          return { success: true, message: `Você e ${targetDisplayName} agora são amigos!` };
        }
        return { success: false, message: 'Já existe uma solicitação de amizade pendente enviada por você.' };
      }
      if (existing.status === 'blocked') {
        return { success: false, message: 'Não foi possível enviar solicitação para este usuário.' };
      }
    }

    // 4. Inserir a nova solicitação de amizade
    const { data: insertedData, error: insertErr } = await supabase
      .from('friendships')
      .insert({
        user_id: user.id,
        friend_id: targetUser.id,
        requester_id: user.id,
        status: 'pending',
      })
      .select('id, user_id, friend_id, requester_id, status, created_at')
      .maybeSingle();

    if (insertErr) {
      console.warn('[Supabase] Erro ao enviar solicitação:', insertErr);
      return { success: false, message: `Erro ao enviar solicitação: ${insertErr.message || 'Falha no banco de dados'}` };
    }

    const newFriendObj: Friend = {
      id: insertedData?.id || `friendship-${Date.now()}`,
      userId: user.id,
      friendId: targetUser.id,
      friendName: targetDisplayName,
      friendAvatarUrl: targetUser.avatar_url || null,
      friendTag: targetUser.custom_tag || generateUserTag(targetUser.id),
      status: 'pending',
      isIncomingRequest: false,
      onlineStatus: 'offline',
    };

    const currentFriends = useAppStore.getState().friends || [];
    const updated = [newFriendObj, ...currentFriends.filter(f => f.id !== newFriendObj.id && f.friendId !== targetUser.id)];
    useAppStore.getState().setFriends(updated);
    try {
      localStorage.setItem('concord_mock_friends', JSON.stringify(updated));
    } catch {}
    window.dispatchEvent(new CustomEvent('concord:friends-updated'));

    return { success: true, message: `Solicitação de amizade enviada para ${targetDisplayName}!` };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Falha ao processar solicitação.' };
  }
}

export async function cancelFriendRequestInSupabase(friendshipIdOrTargetId: string): Promise<boolean> {
  try {
    // 1. Atualizar cache local
    const raw = localStorage.getItem('concord_mock_friends');
    if (raw) {
      let list: Friend[] = JSON.parse(raw);
      list = list.filter(f => f.id !== friendshipIdOrTargetId && f.friendId !== friendshipIdOrTargetId);
      localStorage.setItem('concord_mock_friends', JSON.stringify(list));
    }

    // 2. Atualizar store
    const current = useAppStore.getState().friends || [];
    const filtered = current.filter(f => f.id !== friendshipIdOrTargetId && f.friendId !== friendshipIdOrTargetId);
    useAppStore.getState().setFriends(filtered);
    window.dispatchEvent(new CustomEvent('concord:friends-updated'));

    if (!supabaseUrl || !supabaseAnonKey) return true;

    // 3. Deletar no Supabase se logado
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      if (isUuid(friendshipIdOrTargetId)) {
        await supabase
          .from('friendships')
          .delete()
          .or(`id.eq.${friendshipIdOrTargetId},and(user_id.eq.${user.id},friend_id.eq.${friendshipIdOrTargetId}),and(user_id.eq.${friendshipIdOrTargetId},friend_id.eq.${user.id})`);
      } else {
        await supabase
          .from('friendships')
          .delete()
          .eq('id', friendshipIdOrTargetId);
      }
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Erro ao cancelar solicitação:', err);
    return false;
  }
}

export async function respondFriendRequestInSupabase(friendshipId: string, accept: boolean): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) {
    let list = await fetchFriendsFromSupabase();
    if (accept) {
      list = list.map(f => f.id === friendshipId ? { ...f, status: 'accepted' } : f);
    } else {
      list = list.filter(f => f.id !== friendshipId);
    }
    localStorage.setItem('concord_mock_friends', JSON.stringify(list));
    return true;
  }

  try {
    if (accept) {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', friendshipId);
      return !error;
    } else {
      const { error } = await supabase
        .from('friendships')
        .delete()
        .eq('id', friendshipId);
      return !error;
    }
  } catch {
    return false;
  }
}

export async function removeFriendFromSupabase(friendshipId: string): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) {
    let list = await fetchFriendsFromSupabase();
    list = list.filter(f => f.id !== friendshipId);
    localStorage.setItem('concord_mock_friends', JSON.stringify(list));
    return true;
  }

  try {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    return !error;
  } catch {
    return false;
  }
}

export async function blockUserInSupabase(targetUserId: string, targetName?: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem('concord_mock_friends');
    let list: Friend[] = raw ? JSON.parse(raw) : [];
    const existingIdx = list.findIndex(f => 
      (targetUserId && (f.friendId === targetUserId || f.userId === targetUserId)) || 
      (targetName && f.friendName?.trim().toLowerCase() === targetName.trim().toLowerCase())
    );
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], status: 'blocked' };
    } else {
      list.push({
        id: `block-${Date.now()}`,
        userId: 'me',
        friendId: targetUserId,
        friendName: targetName || 'Usuário Bloqueado',
        friendAvatarUrl: null,
        friendTag: '0000',
        status: 'blocked',
      });
    }
    localStorage.setItem('concord_mock_friends', JSON.stringify(list));
  } catch {}

  if (!supabaseUrl || !supabaseAnonKey) return true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return true;

    if (isUuid(targetUserId)) {
      await supabase.from('friendships').upsert({
        user_id: user.id,
        friend_id: targetUserId,
        requester_id: user.id,
        status: 'blocked',
        updated_at: new Date().toISOString(),
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function unblockUserInSupabase(targetIdOrFriendshipId: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem('concord_mock_friends');
    if (raw) {
      let list: Friend[] = JSON.parse(raw);
      list = list.filter(f => f.id !== targetIdOrFriendshipId && f.friendId !== targetIdOrFriendshipId);
      localStorage.setItem('concord_mock_friends', JSON.stringify(list));
    }
  } catch {}

  if (!supabaseUrl || !supabaseAnonKey) return true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return true;

    if (isUuid(targetIdOrFriendshipId)) {
      await supabase.from('friendships').delete().or(`id.eq.${targetIdOrFriendshipId},friend_id.eq.${targetIdOrFriendshipId}`);
    }
    return true;
  } catch {
    return false;
  }
}

// ─── DIRECT CHATS (DMs) ──────────────────────────────────────────

export async function fetchDirectChatsFromSupabase(): Promise<DirectChat[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    try {
      const raw = localStorage.getItem('concord_direct_chats');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const raw = localStorage.getItem('concord_direct_chats');
      return raw ? JSON.parse(raw) : [];
    }

    const { data, error } = await supabase
      .from('direct_chats')
      .select('id, user1_id, user2_id, updated_at')
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .order('updated_at', { ascending: false });

    if (error || !data) {
      const raw = localStorage.getItem('concord_direct_chats');
      return raw ? JSON.parse(raw) : [];
    }

    const partnerIds = Array.from(new Set(
      data.map((c: any) => (c.user1_id === user.id ? c.user2_id : c.user1_id)).filter(Boolean)
    ));

    let profilesMap = new Map<string, any>();
    if (partnerIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, custom_tag')
        .in('id', partnerIds);

      (profiles || []).forEach((p: any) => profilesMap.set(p.id, p));
    }

    const list: DirectChat[] = data.map((c: any) => {
      const partnerId = c.user1_id === user.id ? c.user2_id : c.user1_id;
      const partner = profilesMap.get(partnerId);
      return {
        id: c.id,
        partnerId,
        partnerName: partner?.username || 'Usuário',
        partnerAvatarUrl: partner?.avatar_url || null,
        partnerTag: partner?.custom_tag || generateUserTag(partnerId),
        updatedAt: c.updated_at,
      };
    });

    localStorage.setItem('concord_direct_chats', JSON.stringify(list));
    return list;
  } catch (err) {
    console.warn('[Supabase] Exceção ao buscar DMs:', err);
    try {
      const raw = localStorage.getItem('concord_direct_chats');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

export async function getOrCreateDirectChatInSupabase(targetUserId: string): Promise<DirectChat | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const mockChat: DirectChat = {
      id: `local-dm-${targetUserId}`,
      partnerId: targetUserId,
      partnerName: 'Amigo',
      partnerAvatarUrl: null,
      updatedAt: new Date().toISOString(),
    };
    return mockChat;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: existing } = await supabase
      .from('direct_chats')
      .select('id, user1_id, user2_id, updated_at')
      .or(`and(user1_id.eq.${user.id},user2_id.eq.${targetUserId}),and(user1_id.eq.${targetUserId},user2_id.eq.${user.id})`)
      .maybeSingle();

    let chatId = existing?.id;
    if (!chatId) {
      const { data: created, error } = await supabase
        .from('direct_chats')
        .insert({
          user1_id: user.id,
          user2_id: targetUserId,
        })
        .select()
        .single();

      if (!error && created) {
        chatId = created.id;
      }
    }

    if (!chatId) return null;

    const { data: partnerProfile } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, custom_tag')
      .eq('id', targetUserId)
      .maybeSingle();

    return {
      id: chatId,
      partnerId: targetUserId,
      partnerName: partnerProfile?.username || 'Usuário',
      partnerAvatarUrl: partnerProfile?.avatar_url || null,
      partnerTag: partnerProfile?.custom_tag || generateUserTag(targetUserId),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[Supabase] Erro ao obter/criar chat direto:', err);
    return null;
  }
}

export async function fetchDirectMessagesFromSupabase(chatId: string): Promise<DirectMessage[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    try {
      const raw = localStorage.getItem(`concord_dm_${chatId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  try {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error || !data) return [];
    return data.map((m: any) => ({
      id: m.id,
      chatId: m.chat_id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      avatarUrl: m.avatar_url,
      content: m.content,
      msgType: m.msg_type,
      fileUrl: m.file_url,
      fileName: m.file_name,
      createdAt: m.created_at,
    }));
  } catch {
    return [];
  }
}

export async function sendDirectMessageToSupabase(
  chatId: string,
  content: string,
  msgType = 'text',
  fileUrl?: string,
  fileName?: string
): Promise<DirectMessage | null> {
  const currentName = useAppStore.getState().myName || 'Eu';
  const currentAvatar = useAppStore.getState().myAvatarUrl || null;

  if (!supabaseUrl || !supabaseAnonKey) {
    const mockMsg: DirectMessage = {
      id: `local-msg-${Date.now()}`,
      chatId,
      senderId: 'me',
      senderName: currentName,
      avatarUrl: currentAvatar,
      content,
      msgType,
      fileUrl,
      fileName,
      createdAt: new Date().toISOString(),
    };
    try {
      const raw = localStorage.getItem(`concord_dm_${chatId}`);
      const list = raw ? JSON.parse(raw) : [];
      list.push(mockMsg);
      localStorage.setItem(`concord_dm_${chatId}`, JSON.stringify(list));
    } catch {}
    return mockMsg;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('direct_messages')
      .insert({
        chat_id: chatId,
        sender_id: user.id,
        sender_name: currentName,
        avatar_url: currentAvatar,
        content,
        msg_type: msgType,
        file_url: fileUrl || null,
        file_name: fileName || null,
      })
      .select()
      .single();

    if (!error && data) {
      await supabase
        .from('direct_chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

      return {
        id: data.id,
        chatId: data.chat_id,
        senderId: data.sender_id,
        senderName: data.sender_name,
        avatarUrl: data.avatar_url,
        content: data.content,
        msgType: data.msg_type,
        fileUrl: data.file_url,
        fileName: data.file_name,
        createdAt: data.created_at,
      };
    }
    return null;
  } catch (err) {
    console.warn('[Supabase] Erro ao enviar mensagem direta:', err);
    return null;
  }
}

export function getSavedServersSync(): SavedServer[] {
  try {
    let raw = localStorage.getItem(MY_SERVERS_KEY);
    if (!raw) return [];
    const list: SavedServer[] = JSON.parse(raw);
    return (list || [])
      .filter(s => (s.code && s.code.toUpperCase().startsWith('SRV-')) || (s.id && s.id.toLowerCase().startsWith('srv-')) || isUuid(s.id))
      .filter(s => !isServerLeft(s.id, s.code));
  } catch {
    return [];
  }
}

export async function getMyServers(): Promise<SavedServer[]> {
  try {
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;

    // Sincroniza a lista de servidores saídos salva no Electron
    if (isElectron && (window as any).electron?.loadPreferences) {
      try {
        const prefs = await (window as any).electron.loadPreferences();
        if (prefs && prefs[LEFT_SERVERS_KEY]) {
          const parsedLeft = JSON.parse(prefs[LEFT_SERVERS_KEY]);
          if (Array.isArray(parsedLeft)) {
            const currentLeft = getLeftServers();
            const merged = Array.from(new Set([...currentLeft, ...parsedLeft.map((x: any) => String(x).toLowerCase().trim())]));
            localStorage.setItem(LEFT_SERVERS_KEY, JSON.stringify(merged));
          }
        }
      } catch {}
    }

    if (supabaseUrl && supabaseAnonKey) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const authName = resolveAuthDisplayName(user);
          const storeName = useAppStore.getState().myName;
          const localName = localStorage.getItem('concord_username');
          const metaName = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.username;
          const possibleNames = Array.from(new Set([authName, storeName, localName, metaName].filter(Boolean))) as string[];

          let remoteMembers: any[] = [];

          // 1. Buscar servidores onde o usuário é membro por user_id
          const { data: memByUid } = await supabase
            .from('server_members')
            .select('server_id, role, username')
            .eq('user_id', user.id);
          if (memByUid) remoteMembers.push(...memByUid);

          // 1b. Buscar também por todos os nomes possíveis
          for (const name of possibleNames) {
            if (name && name.length >= 2) {
              const { data: memByName } = await supabase
                .from('server_members')
                .select('server_id, role, username')
                .ilike('username', name);
              if (memByName) remoteMembers.push(...memByName);
            }
          }

          // 1c. Compatibilidade com tabela/relação user_servers se existir
          try {
            const { data: usData } = await supabase
              .from('user_servers')
              .select('server_id, role')
              .eq('user_id', user.id);
            if (usData) remoteMembers.push(...usData);
          } catch {}

          // 2. Buscar servidores onde o usuário é o criador
          let createdRooms: any[] = [];
          const { data: cr1 } = await supabase
            .from('rooms')
            .select('id, code, name, icon_url, created_by, is_server')
            .eq('created_by', user.id);

          if (cr1) {
            createdRooms = cr1.filter((r: any) => r.is_server === true || (r.code && r.code.toUpperCase().startsWith('SRV-')));
          }

          // 3. Ler servidores salvos localmente e no Electron para unificação
          let localSaved = getSavedServersSync();
          if (localSaved.length === 0 && isElectron && (window as any).electron?.loadPreferences) {
            try {
              const prefs = await (window as any).electron.loadPreferences();
              if (prefs && prefs[MY_SERVERS_KEY]) {
                const parsed = JSON.parse(prefs[MY_SERVERS_KEY]);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  localSaved = parsed
                    .filter(s => (s.code && s.code.toUpperCase().startsWith('SRV-')) || (s.id && s.id.toLowerCase().startsWith('srv-')) || isUuid(s.id))
                    .filter(s => !isServerLeft(s.id, s.code));
                }
              }
            } catch {}
          }

          const memberServerIds = (remoteMembers || []).map((r: any) => r.server_id).filter(Boolean);
          const createdServerIds = (createdRooms || []).map((r: any) => r.id).filter(Boolean);
          const localServerIds = localSaved.map(s => s.id).filter(Boolean);
          const localServerCodes = localSaved.map(s => s.code).filter(Boolean);

          const allRawIds = Array.from(new Set([...memberServerIds, ...createdServerIds, ...localServerIds]));
          const validUuids = allRawIds.filter(id => isUuid(id));
          const codeCandidates = Array.from(new Set([
            ...allRawIds.filter(id => !isUuid(id)),
            ...localServerCodes,
            ...(remoteMembers || []).map((r: any) => (!isUuid(r.server_id) ? r.server_id : null)).filter(Boolean)
          ])).map(c => String(c).toUpperCase());

          let fetchedRooms: any[] = [...createdRooms];

          if (validUuids.length > 0) {
            const { data: uuidRooms, error: uErr } = await supabase
              .from('rooms')
              .select('id, code, name, icon_url, created_by, is_server')
              .in('id', validUuids);
            if (uuidRooms && !uErr) fetchedRooms.push(...uuidRooms);
          }

          if (codeCandidates.length > 0) {
            const { data: codeRooms, error: cErr } = await supabase
              .from('rooms')
              .select('id, code, name, icon_url, created_by, is_server')
              .in('code', codeCandidates);
            if (codeRooms && !cErr) fetchedRooms.push(...codeRooms);
          }

          // Filtra exclusivamente registros que são servidores válidos e que NÃO foram abandonados/saídos
          const memberServerIdSet = new Set((remoteMembers || []).map((r: any) => r.server_id).filter(Boolean));
          fetchedRooms = (fetchedRooms || []).filter((s: any) => {
            if (isServerLeft(s.id, s.code)) return false;
            if (s.id && memberServerIdSet.has(s.id)) return true;
            if (s.code && memberServerIdSet.has(s.code)) return true;
            if (s.is_server === true) return true;
            if (s.code && s.code.toUpperCase().startsWith('SRV-')) return true;
            return false;
          });

          const serverMap = new Map<string, SavedServer>();

          for (const s of fetchedRooms) {
            if (isServerLeft(s.id, s.code)) continue;
            let role = 'member';
            if (s.created_by === user.id) {
              role = 'owner';
            } else {
              const mem = remoteMembers?.find((r: any) => r.server_id === s.id);
              if (mem?.role) role = mem.role;
              else {
                const loc = localSaved.find(l => l.id === s.id || (l.code && l.code === s.code));
                if (loc?.role) role = loc.role;
              }
            }
            const key = s.id || s.code;
            serverMap.set(key, {
              id: s.id,
              code: s.code || '',
              name: s.name,
              icon_url: s.icon_url || null,
              role,
              joined_at: new Date().toISOString(),
            });
          }

          // Preserva servidores locais já salvos para nunca perder dados do usuário (exceto se saídos)
          for (const loc of localSaved) {
            if (isServerLeft(loc.id, loc.code)) continue;
            const key = loc.id || loc.code;
            const alreadyInMap = serverMap.has(key) || Array.from(serverMap.values()).some(v => (v.id && loc.id && v.id === loc.id) || (v.code && loc.code && v.code === loc.code));
            if (!alreadyInMap) {
              serverMap.set(key, loc);
            }
          }

          const syncedList = Array.from(serverMap.values()).filter(s => !isServerLeft(s.id, s.code));
          localStorage.setItem(MY_SERVERS_KEY, JSON.stringify(syncedList));
          savePrefsToElectron({ [MY_SERVERS_KEY]: JSON.stringify(syncedList) });
          return syncedList;
        }
      } catch (syncErr) {
        console.warn('Sync MyServers Supabase warning:', syncErr);
      }
    }

    // Retorna do localStorage, mas atualiza os metadados (nome/logo) buscando do Supabase
    let localList = getSavedServersSync();
    if (localList.length === 0 && isElectron && (window as any).electron?.loadPreferences) {
      try {
        const prefs = await (window as any).electron.loadPreferences();
        if (prefs && prefs[MY_SERVERS_KEY]) {
          const parsed = JSON.parse(prefs[MY_SERVERS_KEY]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localList = parsed
              .filter(s => (s.code && s.code.toUpperCase().startsWith('SRV-')) || (s.id && s.id.toLowerCase().startsWith('srv-')) || isUuid(s.id))
              .filter(s => !isServerLeft(s.id, s.code));
            localStorage.setItem(MY_SERVERS_KEY, JSON.stringify(localList));
          }
        }
      } catch (e) {}
    }

    if (localList.length > 0 && supabaseUrl && supabaseAnonKey) {
      try {
        const validUuids = localList.map(s => s.id).filter(id => isUuid(id));
        const validCodes = Array.from(new Set(
          localList
            .map(s => s.code || (!isUuid(s.id) ? s.id : ''))
            .filter(Boolean)
        ));

        let query = supabase.from('rooms').select('id, name, icon_url, code');
        if (validUuids.length > 0 && validCodes.length > 0) {
          query = query.or(`id.in.(${validUuids.join(',')}),code.in.(${validCodes.map(c => `"${c}"`).join(',')})`);
        } else if (validUuids.length > 0) {
          query = query.in('id', validUuids);
        } else if (validCodes.length > 0) {
          query = query.in('code', validCodes);
        } else {
          return localList.filter(s => !isServerLeft(s.id, s.code));
        }

        let { data: remoteRooms, error: remoteErr } = await query;
        if (remoteErr && (remoteErr.code === 'PGRST204' || remoteErr.message?.includes('icon_url'))) {
          let fbQuery = supabase.from('rooms').select('id, name, code');
          if (validUuids.length > 0 && validCodes.length > 0) {
            fbQuery = fbQuery.or(`id.in.(${validUuids.join(',')}),code.in.(${validCodes.map(c => `"${c}"`).join(',')})`);
          } else if (validUuids.length > 0) {
            fbQuery = fbQuery.in('id', validUuids);
          } else if (validCodes.length > 0) {
            fbQuery = fbQuery.in('code', validCodes);
          }
          const fbRes = await fbQuery;
          remoteRooms = (fbRes.data || []).map((r: any) => ({ ...r, icon_url: null }));
          remoteErr = fbRes.error;
        }
          
        if (!remoteErr && remoteRooms && remoteRooms.length > 0) {
          localList = localList.map(localServer => {
            const remoteServer = remoteRooms.find(r => 
              (localServer.id && r.id === localServer.id) || 
              (localServer.code && r.code?.toUpperCase() === localServer.code.toUpperCase()) ||
              (localServer.id && r.code?.toUpperCase() === localServer.id.toUpperCase())
            );
            if (remoteServer) {
              return {
                ...localServer,
                id: remoteServer.id || localServer.id,
                name: remoteServer.name,
                icon_url: remoteServer.icon_url !== undefined ? remoteServer.icon_url : localServer.icon_url,
                code: remoteServer.code || localServer.code
              };
            }
            return localServer;
          });
          const filteredLocal = localList.filter(s => !isServerLeft(s.id, s.code));
          localStorage.setItem(MY_SERVERS_KEY, JSON.stringify(filteredLocal));
          savePrefsToElectron({ [MY_SERVERS_KEY]: JSON.stringify(filteredLocal) });
          return filteredLocal;
        }
      } catch (err) {
        console.warn('Erro ao atualizar metadados locais:', err);
      }
    }
    
    return localList.filter(s => !isServerLeft(s.id, s.code));
  } catch (fatalErr) {
    console.warn('getMyServers fatal warning:', fatalErr);
    return getSavedServersSync();
  }
}

export function removeMyServer(serverId: string): void {
  try {
    markServerAsLeft(serverId);
    const raw = localStorage.getItem(MY_SERVERS_KEY);
    if (!raw) return;
    let list: SavedServer[] = JSON.parse(raw);
    list = list.filter(s => s.id !== serverId && s.code !== serverId);
    localStorage.setItem(MY_SERVERS_KEY, JSON.stringify(list));
    savePrefsToElectron({ [MY_SERVERS_KEY]: JSON.stringify(list) });
  } catch (err) {
    console.warn('Erro ao remover servidor salvo:', err);
  }
}

// ==========================================
// CANAIS DO SERVIDOR
// ==========================================

export async function fetchServerChannels(serverId: string): Promise<DbChannel[]> {
  if (!supabaseUrl || !supabaseAnonKey || !serverId) {
    return [{ id: 'ch-geral', server_id: serverId, name: 'Geral', created_at: new Date().toISOString() }];
  }

  try {
    let actualServerId = serverId;
    if (!isUuid(serverId)) {
      const dbRoom = await findRoomInSupabase(serverId);
      if (dbRoom?.id && isUuid(dbRoom.id)) {
        actualServerId = dbRoom.id;
      } else {
        return [{ id: 'ch-geral', server_id: serverId, name: 'Geral', created_at: new Date().toISOString() }];
      }
    }

    const { data, error } = await supabase
      .from('server_channels')
      .select('*')
      .eq('server_id', actualServerId)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      return [{ id: 'ch-geral', server_id: serverId, name: 'Geral', created_at: new Date().toISOString() }];
    }

    return data as DbChannel[];
  } catch {
    return [{ id: 'ch-geral', server_id: serverId, name: 'Geral', created_at: new Date().toISOString() }];
  }
}

export async function createChannelInSupabase(serverId: string, channelName: string): Promise<DbChannel | null> {
  const cleanName = channelName.trim().replace(/\s+/g, '-');
  if (!cleanName) return null;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: `local-ch-${Date.now()}`,
      server_id: serverId,
      name: cleanName,
      created_at: new Date().toISOString(),
    };
  }

  try {
    let actualServerId = serverId;
    if (!isUuid(serverId)) {
      const dbRoom = await findRoomInSupabase(serverId);
      if (dbRoom?.id && isUuid(dbRoom.id)) {
        actualServerId = dbRoom.id;
      }
    }

    if (!isUuid(actualServerId)) {
      return {
        id: `local-ch-${Date.now()}`,
        server_id: serverId,
        name: cleanName,
        created_at: new Date().toISOString(),
      };
    }

    const { data, error } = await supabase
      .from('server_channels')
      .insert({
        server_id: actualServerId,
        name: cleanName,
      })
      .select()
      .single();

    if (error) {
      return {
        id: `local-ch-${Date.now()}`,
        server_id: serverId,
        name: cleanName,
        created_at: new Date().toISOString(),
      };
    }

    return data as DbChannel;
  } catch {
    return {
      id: `local-ch-${Date.now()}`,
      server_id: serverId,
      name: cleanName,
      created_at: new Date().toISOString(),
    };
  }
}

export async function updateChannelNameInSupabase(serverId: string, channelId: string, newName: string): Promise<boolean> {
  const cleanName = newName.trim().replace(/\s+/g, '-');
  if (!cleanName) return false;
  if (!supabaseUrl || !supabaseAnonKey) return true;

  try {
    const { error } = await supabase
      .from('server_channels')
      .update({ name: cleanName })
      .eq('server_id', serverId)
      .eq('id', channelId);

    return !error;
  } catch (err) {
    console.warn('[Supabase] Erro ao atualizar nome do canal:', err);
    return false;
  }
}

export async function deleteChannelInSupabase(serverId: string, channelId: string): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) return true;

  try {
    const { error } = await supabase
      .from('server_channels')
      .delete()
      .eq('server_id', serverId)
      .eq('id', channelId);

    if (error) {
      console.warn('[Supabase] Erro ao deletar canal:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Exceção ao deletar canal:', err);
    return false;
  }
}

// ==========================================
// MEMBROS DO SERVIDOR (Offline, Online, Na Call)
// ==========================================

export async function updateMemberRoleInSupabase(serverId: string, username: string, role: string): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) return true;

  try {
    const { error } = await supabase
      .from('server_members')
      .update({ role })
      .eq('server_id', serverId)
      .ilike('username', username);

    return !error;
  } catch (err) {
    console.warn('[Supabase] Erro ao atualizar cargo:', err);
    return false;
  }
}

function getServerMembersCacheKey(serverId: string): string {
  return `concord_server_members_${serverId.trim().toLowerCase()}`;
}

export function getLocalServerMembers(serverId: string): DbMember[] {
  if (!serverId) return [];
  try {
    const raw = localStorage.getItem(getServerMembersCacheKey(serverId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function saveLocalServerMember(serverId: string, member: Partial<DbMember> & { username: string }): void {
  if (!serverId || !member.username) return;
  try {
    const key = getServerMembersCacheKey(serverId);
    const raw = localStorage.getItem(key);
    let list: DbMember[] = raw ? JSON.parse(raw) : [];
    const cleanUser = member.username.trim();
    const idx = list.findIndex(m => m.username.trim().toLowerCase() === cleanUser.toLowerCase());
    const memberObj: DbMember = {
      id: member.id || member.user_id || `local-mem-${cleanUser.toLowerCase()}`,
      server_id: serverId,
      user_id: member.user_id || null,
      username: cleanUser,
      avatar_url: member.avatar_url || null,
      role: member.role || 'member',
      joined_at: member.joined_at || new Date().toISOString(),
    };
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        ...memberObj,
        avatar_url: memberObj.avatar_url || list[idx].avatar_url,
        role: member.role || list[idx].role || 'member',
      };
    } else {
      list.push(memberObj);
    }
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

export function removeLocalServerMember(serverId: string, username: string): void {
  if (!serverId || !username) return;
  try {
    const key = getServerMembersCacheKey(serverId);
    const raw = localStorage.getItem(key);
    if (raw) {
      let list: DbMember[] = JSON.parse(raw);
      list = list.filter(m => m.username.trim().toLowerCase() !== username.trim().toLowerCase());
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch {}
}

export async function registerServerMember(
  serverId: string, 
  username: string, 
  userId?: string | null, 
  role: string = 'member',
  serverInfo?: { name?: string; code?: string; icon_url?: string | null }
): Promise<void> {
  // Salva no histórico de "Meus Servidores" com nome e código completos
  saveMyServer({ 
    id: serverId, 
    role,
    name: serverInfo?.name,
    code: serverInfo?.code,
    icon_url: serverInfo?.icon_url
  });

  if (!serverId || !username) return;

  // Salvar imediatamente no cache local do servidor
  const localAvatar = localStorage.getItem('concord_avatar_url') || null;
  saveLocalServerMember(serverId, {
    username,
    user_id: userId,
    role,
    avatar_url: localAvatar,
  });

  if (!supabaseUrl || !supabaseAnonKey) return;

  try {
    let actualServerId = serverId;
    if (!isUuid(serverId)) {
      const dbRoom = await findRoomInSupabase(serverId);
      if (dbRoom?.id && isUuid(dbRoom.id)) {
        actualServerId = dbRoom.id;
        saveLocalServerMember(actualServerId, {
          username,
          user_id: userId,
          role,
          avatar_url: localAvatar,
        });
      } else {
        return; // Não é UUID e não está no Supabase
      }
    }

    let uid = userId;
    if (!uid) {
      const { data: { user } } = await supabase.auth.getUser();
      uid = user?.id || null;
    }

    if (!uid) {
      // Tentar associar a perfil existente com o mesmo username se houver
      const { data: prof } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', username)
        .maybeSingle();
      if (prof?.id) uid = prof.id;
    }

    if (uid) {
      await supabase
        .from('server_members')
        .upsert({
          server_id: actualServerId,
          user_id: uid,
          username,
          role,
          joined_at: new Date().toISOString(),
        }, { onConflict: 'server_id,user_id' });
    } else {
      // Para visitante/anônimo sem id de perfil
      const { data: existing } = await supabase
        .from('server_members')
        .select('id')
        .eq('server_id', actualServerId)
        .ilike('username', username)
        .maybeSingle();

      if (!existing) {
        await supabase
          .from('server_members')
          .insert({
            server_id: actualServerId,
            username,
            role,
            joined_at: new Date().toISOString(),
          });
      }
    }
  } catch {
    // Ignora silenciosamente caso tabela server_members ainda não exista no projeto Supabase
  }
}

/**
 * Remove a filiação do usuário ao servidor.
 * O servidor permanece ativo permanentemente para que os membros (e convidados futuros)
 * possam retornar utilizando o código ou link de convite.
 */
export async function leaveServerFromSupabase(
  serverId: string,
  username: string,
  userId?: string | null,
  serverCode?: string | null
): Promise<{ success: boolean; serverDeleted: boolean }> {
  // 1. Marca imediatamente como saído e remove dos caches locais
  markServerAsLeft(serverId, serverCode || undefined);
  removeMyServer(serverId);
  if (serverCode) removeMyServer(serverCode);
  removeLocalServerMember(serverId, username);
  if (serverCode) removeLocalServerMember(serverCode, username);

  if (!serverId && !serverCode) {
    return { success: true, serverDeleted: false };
  }

  try {
    let actualServerId = serverId;
    let actualCode = serverCode || '';

    // Buscar a sala no Supabase para obter com certeza tanto o UUID quanto o código
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const dbRoom = await findRoomInSupabase(serverId || actualCode);
        if (dbRoom) {
          if (dbRoom.id && isUuid(dbRoom.id)) actualServerId = dbRoom.id;
          if (dbRoom.code) actualCode = dbRoom.code;
        }
      } catch {}
    }

    // Marca ambos UUID e código como saídos para máxima garantia
    markServerAsLeft(actualServerId, actualCode);
    removeMyServer(actualServerId);
    if (actualCode) removeMyServer(actualCode);
    removeLocalServerMember(actualServerId, username);
    if (actualCode) removeLocalServerMember(actualCode, username);

    if (!supabaseUrl || !supabaseAnonKey) {
      return { success: true, serverDeleted: false };
    }

    let uid = userId;
    if (!uid) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        uid = user?.id || null;
      } catch {}
    }

    const targetServerIds = Array.from(new Set([actualServerId, serverId, actualCode].filter(Boolean)));

    // 2. Se o usuário for o criador (rooms.created_by), desvincula o created_by para não ressurgir
    if (uid && isUuid(actualServerId)) {
      try {
        await supabase
          .from('rooms')
          .update({ created_by: null })
          .eq('id', actualServerId)
          .eq('created_by', uid);
      } catch {}
    }

    // 3. Deletar registro do membro em server_members e user_servers por user_id
    if (uid) {
      for (const sId of targetServerIds) {
        try {
          await supabase
            .from('server_members')
            .delete()
            .eq('server_id', sId)
            .eq('user_id', uid);
        } catch {}
        try {
          await supabase
            .from('user_servers')
            .delete()
            .eq('server_id', sId)
            .eq('user_id', uid);
        } catch {}
      }
    }

    // 4. Deletar também por username e variações
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const authName = currentUser ? resolveAuthDisplayName(currentUser) : '';
      const storeName = useAppStore.getState().myName;
      const localName = localStorage.getItem('concord_username');
      const nameVariations = Array.from(new Set([username, authName, storeName, localName].filter(Boolean))) as string[];

      for (const name of nameVariations) {
        if (name && name.length >= 2) {
          for (const sId of targetServerIds) {
            try {
              await supabase
                .from('server_members')
                .delete()
                .eq('server_id', sId)
                .ilike('username', name);
            } catch {}
          }
        }
      }
    } catch {}

    window.dispatchEvent(new CustomEvent('concord:servers-updated'));
    return { success: true, serverDeleted: false };
  } catch {
    return { success: true, serverDeleted: false };
  }
}

export async function fetchServerMembers(serverId: string): Promise<DbMember[]> {
  if (!serverId) return [];

  // Obter membros conhecidos do cache local
  const localMap = new Map<string, DbMember>();
  for (const m of getLocalServerMembers(serverId)) {
    localMap.set(m.username.trim().toLowerCase(), m);
  }

  let actualServerId = serverId;
  if (!isUuid(serverId)) {
    try {
      const dbRoom = await findRoomInSupabase(serverId);
      if (dbRoom?.id && isUuid(dbRoom.id)) {
        actualServerId = dbRoom.id;
        for (const m of getLocalServerMembers(actualServerId)) {
          localMap.set(m.username.trim().toLowerCase(), m);
        }
      }
    } catch {}
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return Array.from(localMap.values());
  }

  try {
    if (!isUuid(actualServerId)) {
      return Array.from(localMap.values());
    }

    const { data, error } = await supabase
      .from('server_members')
      .select('*, profiles(avatar_url)')
      .eq('server_id', actualServerId)
      .order('joined_at', { ascending: true });

    if (error || !data) {
      return Array.from(localMap.values());
    }

    const remoteMembers = data.map((m: any) => ({
      ...m,
      avatar_url: m.profiles?.avatar_url || m.avatar_url || null,
    })) as DbMember[];

    // Mesclar resultados remotos no mapa
    for (const rm of remoteMembers) {
      localMap.set(rm.username.trim().toLowerCase(), rm);
    }

    const merged = Array.from(localMap.values());
    // Atualizar cache local com dados mesclados
    try {
      localStorage.setItem(getServerMembersCacheKey(serverId), JSON.stringify(merged));
      if (actualServerId !== serverId) {
        localStorage.setItem(getServerMembersCacheKey(actualServerId), JSON.stringify(merged));
      }
    } catch {}

    return merged;
  } catch {
    return Array.from(localMap.values());
  }
}

// ==========================================
// HISTÓRICO DE MENSAGENS E BUSCA COM CACHE PERSISTENTE
// ==========================================

function getLocalMessageCacheKey(roomId: string, channelId?: string | null): string {
  return `concord_msgs_${roomId}_${channelId || 'all'}`;
}

export async function fetchChannelMessages(roomId: string, channelId?: string | null): Promise<DbMessage[]> {
  const cacheKey = getLocalMessageCacheKey(roomId, channelId);
  let cached: DbMessage[] = [];
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch {}

  if (!supabaseUrl || !supabaseAnonKey) return cached;

  try {
    // Resolver quarto/servidor para obter o ID canônico
    const dbRoom = await findRoomInSupabase(roomId);
    
    // Postgres falhará se passarmos strings comuns (ex: 'CONCORD') para uma coluna UUID
    const isValidUUID = (id: string) => isUuid(id);
    const rawIds = [roomId, dbRoom?.id].filter(Boolean) as string[];
    const roomIdsToMatch = Array.from(new Set(rawIds.filter(isValidUUID)));

    if (roomIdsToMatch.length === 0) {
      return cached;
    }

    let query = supabase
      .from('messages')
      .select('*')
      .in('room_id', roomIdsToMatch);

    if (channelId && isUuid(channelId)) {
      query = query.eq('channel_id', channelId);
    } else {
      query = query.is('channel_id', null);
    }

    const { data, error } = await query.order('created_at', { ascending: true }).limit(300);

    if (error || !data || data.length === 0) {
      return cached;
    }

    // Salva no cache local
    localStorage.setItem(cacheKey, JSON.stringify(data));
    return data as DbMessage[];
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar histórico de mensagens:', err);
    return cached;
  }
}

export async function saveMessageToSupabase(
  roomId: string,
  senderName: string,
  content: string,
  channelId?: string | null,
  msgType: 'text' | 'image' | 'giphy' | 'file' = 'text',
  fileUrl?: string,
  fileName?: string
): Promise<DbMessage | null> {
  // Tentar encontrar ID canônico se for por código
  let canonicalRoomId = roomId;
  try {
    const dbRoom = await findRoomInSupabase(roomId);
    if (dbRoom?.id) canonicalRoomId = dbRoom.id;
  } catch {}

  const newMsg: DbMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    room_id: canonicalRoomId,
    channel_id: (channelId && isUuid(channelId)) ? channelId : null,
    user_id: null,
    sender_name: senderName,
    content,
    msg_type: msgType,
    file_url: fileUrl || null,
    file_name: fileName || null,
    created_at: new Date().toISOString(),
  };

  // Salva no cache local imediatamente
  try {
    const cacheKey = getLocalMessageCacheKey(roomId, channelId);
    const raw = localStorage.getItem(cacheKey);
    const list: DbMessage[] = raw ? JSON.parse(raw) : [];
    list.push(newMsg);
    localStorage.setItem(cacheKey, JSON.stringify(list.slice(-300)));
  } catch {}

  if (!supabaseUrl || !supabaseAnonKey) return newMsg;

  if (!isUuid(canonicalRoomId)) {
    return newMsg;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('messages')
      .insert({
        room_id: canonicalRoomId,
        channel_id: (channelId && isUuid(channelId)) ? channelId : null,
        user_id: user?.id || null,
        sender_name: senderName,
        content,
        msg_type: msgType,
        file_url: fileUrl || null,
        file_name: fileName || null,
      })
      .select()
      .maybeSingle();

    if (error) {
      console.warn('[Supabase] Erro ao salvar mensagem no DB:', error.message);
      return newMsg;
    }

    return (data as DbMessage) || newMsg;
  } catch (err) {
    console.warn('[Supabase] Exceção ao salvar mensagem:', err);
    return newMsg;
  }
}
