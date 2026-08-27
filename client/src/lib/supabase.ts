import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

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
}

// ==========================================
// SALAS (Temporárias de 14h)
// ==========================================
export async function createRoomInSupabase(name: string, code: string): Promise<DbRoom | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: `local-${Date.now()}`,
      code,
      name,
      is_server: false,
      created_at: new Date().toISOString(),
    };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('rooms')
      .insert({
        code: code.toUpperCase(),
        name,
        is_server: false,
        created_by: user?.id || null,
      })
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
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: codeOrId,
      code: codeOrId.toUpperCase(),
      name: `Sala ${codeOrId}`,
      is_server: false,
      created_at: new Date().toISOString(),
    };
  }

  try {
    const clean = codeOrId.trim();
    // Tenta primeiro por código, depois por ID
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .or(`code.eq.${clean.toUpperCase()},id.eq.${clean}`)
      .maybeSingle();

    if (error) {
      console.warn('[Supabase] Erro ao buscar sala/servidor:', error.message);
      return null;
    }

    return data as DbRoom | null;
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
export async function checkServerNameAvailable(serverName: string, excludeServerId?: string): Promise<{ available: boolean; message?: string }> {
  const trimmed = serverName.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 40) {
    return { available: false, message: 'O nome do servidor deve ter entre 2 e 40 caracteres.' };
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return { available: true };
  }

  try {
    let query = supabase
      .from('rooms')
      .select('id, name')
      .eq('is_server', true)
      .ilike('name', trimmed);

    if (excludeServerId) {
      query = query.neq('id', excludeServerId);
    }

    const { data: existing, error } = await query.maybeSingle();

    if (error) {
      console.warn('[Supabase] Aviso ao verificar nome de servidor:', error);
      return { available: true };
    }

    if (existing) {
      return { 
        available: false, 
        message: 'Um servidor com este nome já existe. Por favor, escolha outro nome para o seu servidor.' 
      };
    }

    return { available: true };
  } catch (err) {
    console.warn('[Supabase] Falha de checagem:', err);
    return { available: true };
  }
}

/**
 * Cria um novo servidor permanente no Supabase com canal padrão '#Geral'
 */
export async function createServerInSupabase(serverName: string, code: string): Promise<DbRoom | null> {
  const trimmed = serverName.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    const mock = {
      id: `local-srv-${Date.now()}`,
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

    // 1. Inserir Servidor na tabela rooms (is_server = true)
    const { data: serverData, error: serverErr } = await supabase
      .from('rooms')
      .insert({
        code: code.toUpperCase(),
        name: trimmed,
        is_server: true,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (serverErr) {
      console.error('[Supabase] Erro ao criar servidor:', serverErr.message);
      return null;
    }

    const createdServer = serverData as DbRoom;

    // 2. Criar canal padrão '#Geral'
    try {
      await supabase
        .from('server_channels')
        .insert({
          server_id: createdServer.id,
          name: 'Geral',
        });
    } catch (chErr) {
      console.warn('[Supabase] Falha ao criar canal Geral:', chErr);
    }

    // 3. Registrar o criador como membro Dono
    const username = user?.user_metadata?.username || user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Admin';
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
        console.warn('[Supabase] Falha ao registrar dono do servidor:', memErr);
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
 * Atualiza o nome do servidor (apenas para o dono)
 */
export async function updateServerNameInSupabase(serverId: string, newName: string): Promise<{ success: boolean; message?: string }> {
  const check = await checkServerNameAvailable(newName, serverId);
  if (!check.available) {
    return { success: false, message: check.message };
  }

  const trimmed = newName.trim();
  saveMyServer({ id: serverId, name: trimmed, code: '' });

  if (!supabaseUrl || !supabaseAnonKey) {
    return { success: true };
  }

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ name: trimmed })
      .eq('id', serverId);

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
  saveMyServer({ id: serverId, icon_url: iconUrl, name: '', code: '' });

  if (!supabaseUrl || !supabaseAnonKey) {
    return true;
  }

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ icon_url: iconUrl })
      .eq('id', serverId);

    return !error;
  } catch (err) {
    console.warn('[Supabase] Falha ao atualizar logo:', err);
    return false;
  }
}

// ==========================================
// HISTÓRICO: MEUS SERVIDORES
// ==========================================

const MY_SERVERS_KEY = 'concord_my_servers_list';

export function saveMyServer(server: Partial<SavedServer> & { id: string }): void {
  try {
    const raw = localStorage.getItem(MY_SERVERS_KEY);
    let list: SavedServer[] = raw ? JSON.parse(raw) : [];

    const existingIndex = list.findIndex(s => s.id === server.id);
    if (existingIndex >= 0) {
      list[existingIndex] = {
        ...list[existingIndex],
        ...server,
        joined_at: new Date().toISOString(),
      };
    } else {
      list.unshift({
        id: server.id,
        code: server.code || '',
        name: server.name || 'Servidor Concord',
        icon_url: server.icon_url || null,
        role: server.role || 'member',
        joined_at: new Date().toISOString(),
      });
    }

    localStorage.setItem(MY_SERVERS_KEY, JSON.stringify(list.slice(0, 50)));
  } catch (err) {
    console.warn('Erro ao salvar servidor local:', err);
  }
}

export async function getMyServers(): Promise<SavedServer[]> {
  try {
    const raw = localStorage.getItem(MY_SERVERS_KEY);
    let localList: SavedServer[] = raw ? JSON.parse(raw) : [];

    // Se estiver conectado ao Supabase, tenta sincronizar dados mais recentes
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: remoteMembers } = await supabase
            .from('server_members')
            .select('server_id, role, rooms (id, code, name, icon_url)')
            .eq('user_id', user.id);

          if (remoteMembers && remoteMembers.length > 0) {
            remoteMembers.forEach((rm: any) => {
              if (rm.rooms) {
                const s = rm.rooms;
                const idx = localList.findIndex(l => l.id === s.id);
                if (idx >= 0) {
                  localList[idx] = { ...localList[idx], name: s.name, code: s.code, icon_url: s.icon_url, role: rm.role };
                } else {
                  localList.unshift({ id: s.id, code: s.code, name: s.name, icon_url: s.icon_url, role: rm.role });
                }
              }
            });
          }
        }
      } catch (syncErr) {
        console.warn('Sync MyServers Supabase warning:', syncErr);
      }
    }

    return localList;
  } catch {
    return [];
  }
}

export function removeMyServer(serverId: string): void {
  try {
    const raw = localStorage.getItem(MY_SERVERS_KEY);
    if (!raw) return;
    let list: SavedServer[] = JSON.parse(raw);
    list = list.filter(s => s.id !== serverId);
    localStorage.setItem(MY_SERVERS_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Erro ao remover servidor salvo:', err);
  }
}

// ==========================================
// CANAIS DO SERVIDOR
// ==========================================

export async function fetchServerChannels(serverId: string): Promise<DbChannel[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return [{ id: 'ch-geral', server_id: serverId, name: 'Geral', created_at: new Date().toISOString() }];
  }

  try {
    const { data, error } = await supabase
      .from('server_channels')
      .select('*')
      .eq('server_id', serverId)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      return [{ id: 'ch-geral', server_id: serverId, name: 'Geral', created_at: new Date().toISOString() }];
    }

    return data as DbChannel[];
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar canais do servidor:', err);
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
    const { data, error } = await supabase
      .from('server_channels')
      .insert({
        server_id: serverId,
        name: cleanName,
      })
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Erro ao criar canal:', error.message);
      return null;
    }

    return data as DbChannel;
  } catch (err) {
    console.error('[Supabase] Exceção ao criar canal:', err);
    return null;
  }
}

// ==========================================
// MEMBROS DO SERVIDOR (Offline, Online, Na Call)
// ==========================================

export async function registerServerMember(serverId: string, username: string, userId?: string | null, role: string = 'member'): Promise<void> {
  // Salva no histórico de "Meus Servidores"
  saveMyServer({ id: serverId, role });

  if (!supabaseUrl || !supabaseAnonKey) return;

  try {
    let uid = userId;
    if (!uid) {
      const { data: { user } } = await supabase.auth.getUser();
      uid = user?.id || null;
    }

    if (uid) {
      await supabase
        .from('server_members')
        .upsert({
          server_id: serverId,
          user_id: uid,
          username,
          role,
          joined_at: new Date().toISOString(),
        }, { onConflict: 'server_id,user_id' });
    }
  } catch (err) {
    console.warn('[Supabase] Falha ao registrar membro:', err);
  }
}

export async function fetchServerMembers(serverId: string): Promise<DbMember[]> {
  if (!supabaseUrl || !supabaseAnonKey) return [];

  try {
    const { data, error } = await supabase
      .from('server_members')
      .select('*')
      .eq('server_id', serverId)
      .order('joined_at', { ascending: true });

    if (error || !data) return [];
    return data as DbMember[];
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar membros:', err);
    return [];
  }
}

// ==========================================
// HISTÓRICO DE MENSAGENS E BUSCA
// ==========================================

export async function fetchChannelMessages(serverId: string, channelId?: string | null): Promise<DbMessage[]> {
  if (!supabaseUrl || !supabaseAnonKey) return [];

  try {
    let query = supabase
      .from('messages')
      .select('*')
      .eq('room_id', serverId);

    if (channelId && channelId !== 'ch-geral') {
      query = query.eq('channel_id', channelId);
    }

    const { data, error } = await query.order('created_at', { ascending: true }).limit(300);

    if (error || !data) return [];
    return data as DbMessage[];
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar histórico de mensagens:', err);
    return [];
  }
}

export async function saveMessageToSupabase(
  serverId: string,
  senderName: string,
  content: string,
  channelId?: string | null,
  msgType: 'text' | 'image' | 'giphy' | 'file' = 'text',
  fileUrl?: string,
  fileName?: string
): Promise<DbMessage | null> {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('messages')
      .insert({
        room_id: serverId,
        channel_id: (channelId && channelId !== 'ch-geral') ? channelId : null,
        user_id: user?.id || null,
        sender_name: senderName,
        content,
        msg_type: msgType,
        file_url: fileUrl || null,
        file_name: fileName || null,
      })
      .select()
      .single();

    if (error) {
      console.warn('[Supabase] Erro ao salvar mensagem:', error.message);
      return null;
    }

    return data as DbMessage;
  } catch (err) {
    console.warn('[Supabase] Exceção ao salvar mensagem:', err);
    return null;
  }
}
