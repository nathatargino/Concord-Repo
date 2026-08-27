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

// ==========================================
// ROOMS (Temporárias)
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
        code,
        name,
        is_server: false,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Erro ao criar sala:', error.message);
      return null;
    }

    return data as DbRoom;
  } catch (err) {
    console.error('[Supabase] Exceção ao criar sala:', err);
    return null;
  }
}

export async function findRoomInSupabase(code: string): Promise<DbRoom | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: `local-${code}`,
      code,
      name: `Sala ${code}`,
      is_server: false,
      created_at: new Date().toISOString(),
    };
  }

  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code.toUpperCase())
      .maybeSingle();

    if (error) {
      console.error('[Supabase] Erro ao buscar sala por código:', error.message);
      return null;
    }

    return data as DbRoom | null;
  } catch (err) {
    console.error('[Supabase] Exceção ao buscar sala:', err);
    return null;
  }
}

// ==========================================
// SERVIDORES PERMANENTES
// ==========================================

/**
 * Verifica se já existe um servidor com este nome (case-insensitive)
 */
export async function checkServerNameAvailable(serverName: string): Promise<{ available: boolean; message?: string }> {
  const trimmed = serverName.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 40) {
    return { available: false, message: 'O nome do servidor deve ter entre 2 e 40 caracteres.' };
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return { available: true };
  }

  try {
    const { data: existing, error } = await supabase
      .from('rooms')
      .select('id, name')
      .eq('is_server', true)
      .ilike('name', trimmed)
      .maybeSingle();

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
 * Cria um novo servidor permanente no Supabase com canal padrão '# geral'
 */
export async function createServerInSupabase(serverName: string, code: string): Promise<DbRoom | null> {
  const trimmed = serverName.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: `local-srv-${Date.now()}`,
      code,
      name: trimmed,
      is_server: true,
      created_at: new Date().toISOString(),
    };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Inserir Servidor na tabela rooms (is_server = true)
    const { data: serverData, error: serverErr } = await supabase
      .from('rooms')
      .insert({
        code,
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

    // 2. Criar canal padrão '# geral'
    try {
      await supabase
        .from('server_channels')
        .insert({
          server_id: createdServer.id,
          name: 'geral',
        });
    } catch (chErr) {
      console.warn('[Supabase] Falha ao criar canal geral:', chErr);
    }

    // 3. Registrar o criador como membro Dono
    if (user?.id) {
      const username = user.user_metadata?.username || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Admin';
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

    return createdServer;
  } catch (err) {
    console.error('[Supabase] Exceção ao criar servidor:', err);
    return null;
  }
}

// ==========================================
// CANAIS DO SERVIDOR
// ==========================================

export async function fetchServerChannels(serverId: string): Promise<DbChannel[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return [{ id: 'local-ch-1', server_id: serverId, name: 'geral', created_at: new Date().toISOString() }];
  }

  try {
    const { data, error } = await supabase
      .from('server_channels')
      .select('*')
      .eq('server_id', serverId)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      // Se não houver canais, garante pelo menos o '# geral'
      return [{ id: 'ch-geral', server_id: serverId, name: 'geral', created_at: new Date().toISOString() }];
    }

    return data as DbChannel[];
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar canais do servidor:', err);
    return [{ id: 'ch-geral', server_id: serverId, name: 'geral', created_at: new Date().toISOString() }];
  }
}

export async function createChannelInSupabase(serverId: string, channelName: string): Promise<DbChannel | null> {
  const cleanName = channelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
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

export async function registerServerMember(serverId: string, username: string, userId?: string | null): Promise<void> {
  if (!supabaseUrl || !supabaseAnonKey) return;

  try {
    // Se tiver usuário autenticado, vincula
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

    if (channelId) {
      query = query.eq('channel_id', channelId);
    }

    const { data, error } = await query.order('created_at', { ascending: true }).limit(200);

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
        channel_id: channelId || null,
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
