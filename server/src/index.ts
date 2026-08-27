import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './types';
import { registerHub, createRoom, getRoom, toRoomInfo } from './hub';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

const app = express();
const httpServer = createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 3001;

let rawServerUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
if (rawServerUrl && !rawServerUrl.startsWith('http://') && !rawServerUrl.startsWith('https://')) {
  rawServerUrl = `https://${rawServerUrl}`;
}
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = (rawServerUrl && supabaseKey) ? createClient(rawServerUrl, supabaseKey) : null;

// ─── MIDDLEWARE ────────────────────────────────────────────────────
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// Serve static files from public folder
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// ─── SOCKET.IO ────────────────────────────────────────────────────
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: {
      origin: CLIENT_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  }
);

registerHub(io, supabase);

// ─── TURN/STUN CREDENTIALS ────────────────────────────────────────
app.get('/api/turn/credentials', async (_req, res) => {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const meteredApiKey = process.env.METERED_API_KEY;
  const meteredDomain = process.env.METERED_DOMAIN; // e.g. "yourapp.metered.live"

  if (meteredApiKey && meteredDomain) {
    try {
      const meteredRes = await fetch(
        `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${meteredApiKey}`
      );
      const meteredServers = await meteredRes.json();
      if (Array.isArray(meteredServers)) {
        iceServers.push(...meteredServers);
      }
    } catch (e) {
      console.error('Failed to fetch Metered TURN servers:', e);
    }
  } else {
    // Fallback: manual TURN config
    const turnKeyId = process.env.TURN_KEY_ID;
    const turnApiToken = process.env.TURN_API_TOKEN;
    const turnUrl = process.env.TURN_URL;
    if (turnKeyId && turnApiToken && turnUrl) {
      iceServers.push({ urls: turnUrl, username: turnKeyId, credential: turnApiToken });
    }
  }

  res.json({ iceServers });
});

// ─── IMAGE UPLOAD ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  
  // Return the public URL path
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});


// ─── HEALTH CHECK ─────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── ROOM REST ENDPOINTS ──────────────────────────────────────────
// POST /api/rooms — Create a new room (returns room info)
app.post('/api/rooms', async (req, res) => {
  const { persistentId, code, id, isServer, name } = req.body;
  const room = createRoom(persistentId, code, id, isServer, name);
  const info = toRoomInfo(room);

  // Asynchronously persist room to Supabase DB if server environment variables are set
  if (supabase) {
    try {
      const { error } = await supabase.from('rooms').insert({
        code: info.code,
        name: name || (isServer ? 'Servidor Concord' : 'Sala Concord'),
        is_server: !!isServer,
      });
      if (error) console.error('[Server Supabase] Room insert error:', error.message);
    } catch (err: any) {
      console.error('[Server Supabase] Room insert exception:', err);
    }
  }

  res.json(info);
});

// GET /api/rooms/:idOrCode — Check if room exists and is valid
app.get('/api/rooms/:idOrCode', (req, res) => {
  const room = getRoom(req.params.idOrCode);
  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada ou expirada' });
  }
  res.json(toRoomInfo(room));
});

// ─── ROOM REDIRECT (For Desktop Invite Links) ─────────────────────
app.get('/room/:roomId', (req, res) => {
  const code = req.query.code;
  const redirectUrl = `${CLIENT_URL}/room/${req.params.roomId}${code ? `?code=${code}` : ''}`;
  res.redirect(redirectUrl);
});

// ─── START ────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Concord Server running on http://localhost:${PORT}`);
  console.log(`   Accepting connections from: ${CLIENT_URL}\n`);
});
