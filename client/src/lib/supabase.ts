import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Concord Supabase] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configuradas no .env. Algumas funcionalidades persistentes usarão modo local fallback.'
  );
}

// Global Supabase client instance
export const supabase = createClient(
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

// Helper type definitions
export interface DbRoom {
  id: string;
  code: string;
  name: string;
  created_by?: string | null;
  is_private?: boolean;
  created_at: string;
}

export interface DbProfile {
  id: string;
  username: string;
  avatar_url?: string | null;
  created_at: string;
}

// Room Service Helper Functions
export async function createRoomInSupabase(name: string, code: string): Promise<DbRoom | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      id: `local-${Date.now()}`,
      code,
      name,
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
