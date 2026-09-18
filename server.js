import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory room game states for multi-room isolation
const roomStates = {};

function getOrCreateRoomState(roomId) {
  const id = roomId || '123456';
  if (!roomStates[id]) {
    roomStates[id] = {
      wheelType: 'normal',
      wheelVisible: true,
      currentRotation: 0,
      isSpinning: false,
      spinState: {
        duration: 10,
        startRotation: 0,
        targetRotation: 0,
        startTime: 0
      },
      pointers: {
        red: 'off',
        yellow: 'off',
        blue: 'off',
        zoom: 'out'
      },
      items: {},
      specialWedges: [],
      specialValueVisible: false,
      scores: {
        red: { round: 0, total: 0, cards: [false, false, false, false] },
        yellow: { round: 0, total: 0, cards: [false, false, false, false] },
        blue: { round: 0, total: 0, cards: [false, false, false, false] }
      }
    };
  }
  return roomStates[id];
}

function updateAppState(event, payload, roomId) {
  const id = roomId || (payload && payload.roomId) || '123456';
  const appState = getOrCreateRoomState(id);
  if (!payload) return;
  switch (event) {
    case 'spin':
      appState.isSpinning = true;
      appState.spinState = {
        duration: payload.duration || 10,
        startRotation: payload.startRotation || 0,
        targetRotation: payload.targetRotation || 0,
        startTime: payload.startTime || Date.now()
      };
      appState.currentRotation = payload.targetRotation || 0;
      break;
    case 'reset_rotation':
      appState.currentRotation = 0;
      appState.isSpinning = false;
      appState.spinState = { duration: 0, startRotation: 0, targetRotation: 0, startTime: 0 };
      break;
    case 'toggle_wheel':
      appState.wheelType = payload.type || 'normal';
      appState.wheelVisible = payload.show !== undefined ? payload.show : true;
      break;
    case 'pointer_status':
      if (payload.color && appState.pointers) {
        appState.pointers[payload.color] = payload.status;
      }
      break;
    case 'zoom_pointer':
      if (payload.dir && appState.pointers) {
        appState.pointers.zoom = payload.dir;
      }
      break;
    case 'toggle_item':
      if (payload.name) {
        appState.items[payload.name] = payload.show;
      }
      break;
    case 'shuffle_special':
      if (payload.wedges) appState.specialWedges = payload.wedges;
      break;
    case 'show_value':
      appState.specialValueVisible = true;
      break;
    case 'hide_value':
      appState.specialValueVisible = false;
      break;
    case 'find_highest':
      appState.isSpinning = true;
      appState.spinState = {
        duration: 1.5,
        startRotation: payload.startRotation || 0,
        targetRotation: payload.targetRotation || 0,
        startTime: payload.startTime || Date.now()
      };
      appState.currentRotation = payload.targetRotation || 0;
      break;
    case 'sync_scores':
      if (payload) appState.scores = payload;
      break;
    case 'toggle_player_card':
      if (payload && payload.color && appState.scores[payload.color]) {
        if (!appState.scores[payload.color].cards) appState.scores[payload.color].cards = [false, false, false, false];
        appState.scores[payload.color].cards[payload.cardIdx] = payload.isActive;
      }
      break;
    case 'full_sync_state':
      if (payload) roomStates[id] = { ...appState, ...payload };
      break;
  }
}

// In-memory clients list for Server-Sent Events (SSE)
let sseClients = [];

app.get('/api/state', (req, res) => {
  const roomId = req.query.roomid || '123456';
  res.json(getOrCreateRoomState(roomId));
});

app.get('/api/events', (req, res) => {
  const roomId = req.query.roomid || '123456';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.roomId = roomId;
  sseClients.push(res);

  // Send full current state immediately to new client for its room
  const state = getOrCreateRoomState(roomId);
  res.write(`data: ${JSON.stringify({ event: 'full_sync_state', payload: state, roomId })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

app.post('/api/broadcast', (req, res) => {
  const data = req.body || {};
  const roomId = data.roomId || (data.payload && data.payload.roomId) || '123456';
  if (data && data.event) {
    updateAppState(data.event, data.payload, roomId);
  }
  sseClients.forEach(client => {
    if (client.roomId === roomId) {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  });
  res.json({ ok: true });
});

// Serve static assets from project root
app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[5th Wheel] App is running on http://0.0.0.0:${PORT}`);
});


