/* ================================================
   CONCORD — Supabase Client & Realtime Configuration
   Handles Authentication, Profile Sync, Resilient Presence
   and Safe Channel Management for the Website Portal
   ================================================ */

const SUPABASE_URL = 'https://zryjdjvqprdrhunmvhbj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyeWpkanZxcHJkcmh1bm12aGJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzUwOTAsImV4cCI6MjEwMzE1MTA5MH0.YTdvlUu3TivaghK9eDqkupXyup8GVRmyT0dKB31lGrQ';

// Safe Client Initialization with persistent session and auto-refresh
let supabaseClient = null;
try {
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
            realtime: {
                params: {
                    eventsPerSecond: 10,
                },
            },
        });
    } else {
        console.warn('[Concord Website Supabase] Biblioteca @supabase/supabase-js não detectada no escopo global.');
    }
} catch (err) {
    console.error('[Concord Website Supabase] Erro ao inicializar cliente Supabase:', err);
}

/**
 * Remove um canal Realtime com segurança evitando duplicações ou erros de ciclo de vida
 */
function safeRemoveChannel(channelOrTopic) {
    if (!supabaseClient || !channelOrTopic) return Promise.resolve();
    try {
        if (typeof channelOrTopic === 'string') {
            const topic = channelOrTopic.trim();
            const channels = supabaseClient.getChannels ? supabaseClient.getChannels() : [];
            const matches = channels.filter(c => c.topic === topic || c.topic === `realtime:${topic}`);
            const promises = matches.map(c => {
                try {
                    return supabaseClient.removeChannel(c);
                } catch (e) {
                    return Promise.resolve();
                }
            });
            return Promise.all(promises);
        } else if (channelOrTopic && typeof channelOrTopic.unsubscribe === 'function') {
            return supabaseClient.removeChannel(channelOrTopic);
        }
    } catch (err) {
        console.warn('[Website Supabase] Aviso ao remover canal:', err);
    }
    return Promise.resolve();
}

/**
 * Cria ou recupera canal garantindo limpeza prévia de instâncias anteriores
 */
function getOrCreateRealtimeChannel(topicName, opts) {
    if (!supabaseClient) return null;
    const cleanTopic = (topicName || '').trim();
    try {
        const channels = supabaseClient.getChannels ? supabaseClient.getChannels() : [];
        channels
            .filter(c => c.topic === cleanTopic || c.topic === `realtime:${cleanTopic}`)
            .forEach(dup => {
                try {
                    supabaseClient.removeChannel(dup);
                } catch (e) {}
            });
    } catch (e) {}
    return supabaseClient.channel(cleanTopic, opts);
}

/**
 * Subscrição resiliente de presença no Website Portal
 */
function subscribeUserPresence(channelName, userData, onSync, onJoin, onLeave) {
    if (!supabaseClient) return null;
    const topic = channelName || 'concord-global-social-v1';
    const channel = getOrCreateRealtimeChannel(topic, {
        config: {
            presence: {
                key: userData?.id || userData?.userId || 'web-user',
            },
        },
    });

    if (!channel) return null;

    channel
        .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState();
            if (typeof onSync === 'function') onSync(state);
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            if (typeof onJoin === 'function') onJoin(key, newPresences);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            if (typeof onLeave === 'function') onLeave(key, leftPresences);
        });

    channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && userData) {
            try {
                await channel.track({
                    userId: userData.id || userData.userId,
                    userName: userData.username || userData.name || 'Usuário Web',
                    avatarUrl: userData.avatar_url || userData.avatarUrl || null,
                    onlineAt: new Date().toISOString(),
                });
            } catch (trackErr) {
                console.warn('[Website Supabase] Erro ao rastrear presença:', trackErr);
            }
        }
    });

    return {
        channel,
        untrack: async () => {
            try {
                await channel.untrack();
            } catch (e) {}
        },
        unsubscribe: () => safeRemoveChannel(channel),
    };
}

/**
 * Upsert consistente de perfil com sincronização de metadados de autenticação
 */
async function upsertProfile(userId, { username, avatar_url, display_name, email }) {
    if (!supabaseClient || !userId) return { error: 'Supabase client ou userId não disponível' };
    try {
        const payload = {
            id: userId,
            updated_at: new Date().toISOString(),
        };
        if (username !== undefined) payload.username = username.trim();
        if (display_name !== undefined) payload.display_name = display_name.trim();
        if (avatar_url !== undefined) payload.avatar_url = avatar_url;
        if (email !== undefined) payload.email = email.trim();

        const { data, error } = await supabaseClient
            .from('profiles')
            .upsert(payload)
            .select()
            .maybeSingle();

        if (error) {
            console.warn('[Website Supabase] Erro no upsert de perfil:', error);
        }

        // Sincronizar auth user_metadata
        try {
            const authUpdates = {};
            if (username !== undefined) authUpdates.username = username.trim();
            if (display_name !== undefined) authUpdates.display_name = display_name.trim();
            if (avatar_url !== undefined) authUpdates.avatar_url = avatar_url;
            if (Object.keys(authUpdates).length > 0) {
                await supabaseClient.auth.updateUser({ data: authUpdates });
            }
        } catch (authErr) {
            console.warn('[Website Supabase] Aviso ao atualizar user_metadata:', authErr);
        }

        if (avatar_url) {
            try {
                localStorage.setItem('concord_avatar_url', avatar_url);
            } catch (e) {}
        }
        if (username) {
            try {
                localStorage.setItem('concord_username', username);
            } catch (e) {}
        }

        return { data, error };
    } catch (err) {
        console.error('[Website Supabase] Exceção em upsertProfile:', err);
        return { error: err.message || err };
    }
}

/**
 * Busca perfil do usuário pelo ID ou username
 */
async function fetchProfile(userIdOrUsername) {
    if (!supabaseClient || !userIdOrUsername) return null;
    try {
        const clean = String(userIdOrUsername).trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
        let query = supabaseClient.from('profiles').select('*');
        if (isUuid) {
            query = query.eq('id', clean);
        } else {
            query = query.ilike('username', clean);
        }
        const { data, error } = await query.maybeSingle();
        if (error || !data) return null;
        return data;
    } catch (err) {
        console.warn('[Website Supabase] Erro ao buscar perfil:', err);
        return null;
    }
}

/**
 * Atualiza e sincroniza avatar_url do usuário
 */
async function syncAvatar(userId, avatarUrl) {
    return upsertProfile(userId, { avatar_url: avatarUrl });
}

/**
 * Envia e-mail de recuperação de senha com redirecionamento para reset-password.html
 */
async function sendPasswordResetEmail(email) {
    if (!supabaseClient) return { error: { message: 'Supabase client não inicializado' } };
    const cleanEmail = (email || '').trim();
    if (!cleanEmail) return { error: { message: 'Por favor, informe um e-mail válido.' } };

    try {
        const redirectTarget = window.location.origin + '/reset-password.html';
        return await supabaseClient.auth.resetPasswordForEmail(cleanEmail, {
            redirectTo: redirectTarget,
        });
    } catch (err) {
        console.error('[Website Supabase] Erro ao enviar redefinição de senha:', err);
        return { error: err };
    }
}

// Vincula métodos utilitários ao cliente e exporta para escopo global
if (supabaseClient) {
    supabaseClient.safeRemoveChannel = safeRemoveChannel;
    supabaseClient.getOrCreateRealtimeChannel = getOrCreateRealtimeChannel;
    supabaseClient.subscribeUserPresence = subscribeUserPresence;
    supabaseClient.upsertProfile = upsertProfile;
    supabaseClient.fetchProfile = fetchProfile;
    supabaseClient.syncAvatar = syncAvatar;
    supabaseClient.sendPasswordResetEmail = sendPasswordResetEmail;
}

window.supabaseClient = supabaseClient;
window.concordSupabase = {
    client: supabaseClient,
    safeRemoveChannel,
    getOrCreateRealtimeChannel,
    subscribeUserPresence,
    upsertProfile,
    fetchProfile,
    syncAvatar,
    sendPasswordResetEmail,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
};
