-- ==========================================
-- CONCORD UNIFIED SUPABASE DATABASE SCHEMA
-- Execute this script in your Supabase SQL Editor
-- ==========================================

-- 1. PROFILES TABLE (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure profile columns exist and secure sensitive data
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS encrypted_password;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS custom_tag TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'online';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;

-- Enforce unique usernames (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles (LOWER(username));

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone."
    ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile."
    ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile."
    ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Trigger to automatically create a profile record when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, email, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        NEW.email,
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        username = COALESCE(EXCLUDED.username, public.profiles.username);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill email for existing profiles if missing
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 2. ROOMS & SERVERS TABLE (Shared rooms and permanent servers)
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    icon_url TEXT,
    is_server BOOLEAN DEFAULT false,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_private BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure columns exist if table was created previously
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS is_server BOOLEAN DEFAULT false;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- Allow multiple servers or rooms with the same readable name (uniqueness is strictly on code/id)
DROP INDEX IF EXISTS public.idx_rooms_server_name_unique;
DROP INDEX IF EXISTS idx_rooms_server_name_unique;

-- Enable RLS on rooms
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view rooms by code or list public rooms."
    ON public.rooms FOR SELECT USING (true);

CREATE POLICY "Anyone can create a room or server."
    ON public.rooms FOR INSERT WITH CHECK (true);

CREATE POLICY "Room creators can update their rooms."
    ON public.rooms FOR UPDATE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Anyone can delete rooms." ON public.rooms;
CREATE POLICY "Authorized users can delete rooms or servers."
    ON public.rooms FOR DELETE
    USING (
        -- 1. Fallback compatível para salas temporárias (14h) ou sem criador atribuído
        (is_server = false OR is_server IS NULL OR created_by IS NULL)
        OR
        -- 2. Criador autenticado da sala/servidor
        (auth.uid() IS NOT NULL AND auth.uid() = created_by)
        OR
        -- 3. Membro owner ou admin no servidor
        (
            auth.uid() IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.server_members sm
                WHERE sm.server_id = public.rooms.id
                AND sm.user_id = auth.uid()
                AND sm.role IN ('owner', 'admin')
            )
        )
    );


-- 3. SERVER CHANNELS TABLE (Multiple text channels per server)
CREATE TABLE IF NOT EXISTS public.server_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.server_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view server channels."
    ON public.server_channels FOR SELECT USING (true);

CREATE POLICY "Anyone can create server channels."
    ON public.server_channels FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete server channels." ON public.server_channels;
CREATE POLICY "Authorized users can delete server channels."
    ON public.server_channels FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.rooms r
            WHERE r.id = public.server_channels.server_id
            AND (
                -- 1. Servidor sem criador registrado (fallback de migração)
                (r.created_by IS NULL)
                OR
                -- 2. Criador original do servidor
                (auth.uid() IS NOT NULL AND auth.uid() = r.created_by)
                OR
                -- 3. Membro owner ou admin no servidor correspondente
                (
                    auth.uid() IS NOT NULL AND EXISTS (
                        SELECT 1 FROM public.server_members sm
                        WHERE sm.server_id = r.id
                        AND sm.user_id = auth.uid()
                        AND sm.role IN ('owner', 'admin')
                    )
                )
            )
        )
    );


-- 4. SERVER MEMBERS TABLE (Track offline, online and permanent server members)
CREATE TABLE IF NOT EXISTS public.server_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(server_id, user_id)
);

ALTER TABLE public.server_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view server members."
    ON public.server_members FOR SELECT USING (true);

CREATE POLICY "Anyone can join or register as server member."
    ON public.server_members FOR INSERT WITH CHECK (true);

CREATE POLICY "Members can update their membership status."
    ON public.server_members FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete server members."
    ON public.server_members FOR DELETE USING (true);


-- 5. ROOM PARTICIPANTS TABLE (Active or historical call members)
CREATE TABLE IF NOT EXISTS public.rooms_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    socket_id TEXT,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.rooms_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view room participants."
    ON public.rooms_participants FOR SELECT USING (true);

CREATE POLICY "Anyone can join a room."
    ON public.rooms_participants FOR INSERT WITH CHECK (true);

CREATE POLICY "Participants can update their room status."
    ON public.rooms_participants FOR UPDATE USING (true);


-- 6. MESSAGES TABLE (Chat messages within rooms and channels)
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES public.server_channels(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    file_url TEXT,
    file_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure additional columns exist if table was created previously
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.server_channels(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS msg_type TEXT DEFAULT 'text';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view room messages."
    ON public.messages FOR SELECT USING (true);

CREATE POLICY "Anyone can insert room messages."
    ON public.messages FOR INSERT WITH CHECK (true);


-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_server_channels_server_id ON public.server_channels(server_id);
CREATE INDEX IF NOT EXISTS idx_server_members_server_id ON public.server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON public.messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON public.messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_participants_room_id ON public.rooms_participants(room_id);


-- 7. FRIENDSHIPS TABLE (Social Friend System: pending, accepted, blocked)
CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    friend_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
    requester_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, friend_id)
);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own friendships."
    ON public.friendships FOR SELECT
    USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can send friendship requests."
    ON public.friendships FOR INSERT
    WITH CHECK (auth.uid() = user_id OR auth.uid() = requester_id);

CREATE POLICY "Users can update their friendship status."
    ON public.friendships FOR UPDATE
    USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can remove friendships."
    ON public.friendships FOR DELETE
    USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON public.friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON public.friendships(friend_id);


-- 8. DIRECT CHATS TABLE (1:1 Private DM Channels)
CREATE TABLE IF NOT EXISTS public.direct_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    user2_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user1_id, user2_id)
);

ALTER TABLE public.direct_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own direct chats."
    ON public.direct_chats FOR SELECT
    USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can create direct chats."
    ON public.direct_chats FOR INSERT
    WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can update their direct chats."
    ON public.direct_chats FOR UPDATE
    USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE INDEX IF NOT EXISTS idx_direct_chats_user1 ON public.direct_chats(user1_id);
CREATE INDEX IF NOT EXISTS idx_direct_chats_user2 ON public.direct_chats(user2_id);


-- 9. DIRECT MESSAGES TABLE (Private 1:1 Messages)
CREATE TABLE IF NOT EXISTS public.direct_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID REFERENCES public.direct_chats(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    file_url TEXT,
    file_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view direct messages of their chats."
    ON public.direct_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.direct_chats dc
            WHERE dc.id = direct_messages.chat_id
            AND (dc.user1_id = auth.uid() OR dc.user2_id = auth.uid())
        )
    );

CREATE POLICY "Users can send direct messages."
    ON public.direct_messages FOR INSERT
    WITH CHECK (auth.uid() = sender_id);

CREATE INDEX IF NOT EXISTS idx_direct_messages_chat_id ON public.direct_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_sender_id ON public.direct_messages(sender_id);


-- 10. USER RECENT ROOMS TABLE (Cloud-persisted 14h temporary rooms for multi-device sync)
CREATE TABLE IF NOT EXISTS public.user_recent_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, room_id)
);

ALTER TABLE public.user_recent_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their cloud recent rooms."
    ON public.user_recent_rooms FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their cloud recent rooms."
    ON public.user_recent_rooms FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their cloud recent rooms."
    ON public.user_recent_rooms FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can remove their cloud recent rooms."
    ON public.user_recent_rooms FOR DELETE
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_recent_rooms_user ON public.user_recent_rooms(user_id);
CREATE INDEX IF NOT EXISTS idx_user_recent_rooms_expires ON public.user_recent_rooms(expires_at);


-- 11. SUPABASE REALTIME REPLICATION (Enable real-time change events)
-- Tables participating in Supabase Realtime subscriptions (postgres_changes)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.server_members;
EXCEPTION WHEN OTHERS THEN
    -- Ignore if already in publication or permission restricted
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
EXCEPTION WHEN OTHERS THEN
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
EXCEPTION WHEN OTHERS THEN
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN OTHERS THEN
END $$;


