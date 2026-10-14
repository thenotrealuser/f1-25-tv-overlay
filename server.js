// F1 25 TV Overlay - servidor de telemetria (zero dependencias, so Node 18+)
//
// Fluxo: F1 25 --UDP--> este servidor --SSE (HTTP)--> overlay.html
//
// Uso:
//   node server.js            escuta a telemetria do jogo (UDP 20777)
//   node server.js --demo     dados falsos, para testar o visual sem o jogo
//   node server.js --debug    mostra no terminal o tamanho dos pacotes recebidos
//
// Layout 2026 conferido com os dumps reais; 2025 conserva o layout anterior.

'use strict';

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createTurnTracker } = require('./curvas');
const turns = createTurnTracker(path.join(__dirname, 'curvas'));

const UDP_PORT = Number(process.env.UDP_PORT || 20777);
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const DEMO = process.argv.includes('--demo');
const QUALI = process.argv.includes('--quali');   // so com --demo: simula uma qualy
const DEBUG = process.argv.includes('--debug');
const NO_OPEN = process.argv.includes('--no-open') || process.env.NO_OPEN === '1';
const DUMP = process.argv.includes('--dump');     // salva 1 pacote de cada tipo em ./dump
const RECORD = process.argv.includes('--record'); // amostra dados do jogador em ./dump

const MAX_CARS = 24;
const HEADER = 29;
const MAX_BODY = 2048;
const UI_KEYS = ['all', 'tower', 'lap', 'onboard', 'halo', 'cards', 'flags', 'fastest', 'edit'];
const HALO_FILE = path.join(__dirname, 'halo-layouts.json');
const HUD_SCALE_FILE = path.join(__dirname, 'hud-scales.json');
const HUD_OFFSET_FILE = path.join(__dirname, 'hud-offsets.json');
const hudOffsets = {};   // deslocamento de cada HUD em % da tela: { tower: { dx, dy } }
try {
  const saved = JSON.parse(fs.readFileSync(HUD_OFFSET_FILE, 'utf8'));
  for (const key of ['tower', 'onboard', 'lap', 'cards', 'flags', 'fastest']) {
    const o = saved[key];
    if (o && Number.isFinite(o.dx) && Number.isFinite(o.dy)) hudOffsets[key] = { dx: o.dx, dy: o.dy };
  }
} catch (_) { /* primeira execucao */ }
let haloLayouts = { default: { x: 58, y: 58, scale: 1 } };
try {
  const saved = JSON.parse(fs.readFileSync(HALO_FILE, 'utf8'));
  if (saved && typeof saved === 'object' && saved.default) haloLayouts = saved;
} catch (_) { /* primeira execucao */ }
const hudScales = { tower: 1, onboard: 1, halo: 1, lap: 1, cards: 1, flags: 1, fastest: 1 };
try {
  const saved = JSON.parse(fs.readFileSync(HUD_SCALE_FILE, 'utf8'));
  for (const key of Object.keys(hudScales)) {
    if (Number.isFinite(saved[key]) && saved[key] >= 0.3 && saved[key] <= 3) hudScales[key] = saved[key];
  }
} catch (_) { /* primeira execucao */ }

// ---------------------------------------------------------------- estado ---

const state = {
  connected: false,
  lastPacketAt: 0,
  format: 0,
  sessionUid: '',
  player: 0,
  viewCar: 0,
  spectating: false,
  sessionType: 0,
  isSprintRace: false,
  weekendSessions: [],
  totalLaps: 0,
  safetyCar: 0,     // 0 nenhum, 1 safety car, 2 VSC, 3 volta de formacao
  safetyDelta: { seconds: null, available: false, updatedAt: 0, lastNonZeroAt: 0 },
  redFlag: false,
  fastestLap: null, // anuncio temporario do evento FTLP, separado do recorde em state.best
  yellowZones: 0,   // quantos setores de fiscal estao com bandeira amarela
  gamePaused: false,
  sessionTimeLeft: 0,
  numActive: 0,
  dbg: { counts: {}, sizes: {}, parsed: {} },   // diagnostico: quantos pacotes de cada id chegaram
  ui: { all: true, tower: true, lap: true, onboard: false, halo: false, flags: true, fastest: true,
    mode: 'auto', cards: true, edit: false, toast: '', toastUntil: 0 },
  turn: turns.state,
  haloLayouts,
  hudScales,
  hudOffsets,
  visible: false,   // ja chegou dado do jogo (a HUD fica na tela mesmo com o jogo em pausa)
  paused: false,    // sem pacotes ha mais de 3 s: dados congelados
  best: { lap: 0, s1: 0, s2: 0, s3: 0 },
  car: { speed: 0, gear: 0, rpm: 0, maxRpm: 13000, throttle: 0, brake: 0, drs: 0,
    aeroMode: null, aeroAvailable: null, aeroActivationDistance: 0,
    overtakeAvailable: null, overtakeActive: null, overtakeActivationDistance: 0,
    regulations2026: null },
  ers: { store: 0, mode: 0 },
  cars: Array.from({ length: MAX_CARS }, (_, i) => ({
    idx: i, pos: 0, name: '', code: 'C' + String(i + 1).padStart(2, '0'),
    team: 255, color: '', num: 0, ai: 1,
    lastLap: 0, curLap: 0, bestLap: 0, bestFromHistory: false, lastSectors: [0, 0, 0], completedLapNum: 0,
    gapFront: 0, gapLeader: 0,
    lap: 0, pit: 0, sector: 0, s1: 0, s2: 0, bs1: 0, bs2: 0, bs3: 0,
    status: 0, result: 0, invalid: 0, penalties: 0,
    tyre: 0, tyreAge: 0,
  })),
};

// -------------------------------------------------------------- parsers ---

// Aceita apenas as combinacoes documentadas; tamanho divisivel sozinho nao valida um layout.
function layoutOf(len, trailing, known) {
  for (const [count, stride] of known) {
    if (HEADER + trailing + count * stride === len) return { count, stride };
  }
  return null;
}

const seenPackets = new Set();
function note(id, len, layout) {
  state.dbg.parsed[id] = layout !== null;
  if (!DEBUG || seenPackets.has(id) || layout === 0) return;
  seenPackets.add(id);
  console.log(`[debug] id=${id} tamanho=${len} layout=${layout ? `${layout.count} carros x ${layout.stride}` : 'NAO BATE'}`);
}

function msPlusMin(buf, off) {
  return buf.readUInt16LE(off) + buf.readUInt8(off + 2) * 60000;
}

function recomputeBest() {
  for (const [field, key] of [['bestLap', 'lap'], ['bs1', 's1'], ['bs2', 's2'], ['bs3', 's3']]) {
    const vals = state.cars.map(c => c[field]).filter(v => v > 0 && v < 600000);
    state.best[key] = vals.length ? Math.min(...vals) : 0;
  }
}

function parseLapData(buf) { // id 2
  const layout = layoutOf(buf.length, 2, [[24, 57], [22, 57]]);
  note(2, buf.length, layout);
  if (!layout) return;
  for (let i = 0; i < layout.count; i++) {
    const o = HEADER + i * layout.stride;
    const c = state.cars[i];
    const lastLap = buf.readUInt32LE(o);
    const lapNum = buf.readUInt8(o + 33);
    if (lapNum > c.lap && c.lap > 0 && c.s1 > 0 && c.s2 > 0 && lastLap > 0) {
      const s3 = lastLap - c.s1 - c.s2;
      if (s3 > 0 && s3 < 600000) {
        c.lastSectors = [c.s1, c.s2, s3];
        c.completedLapNum = c.lap;
      }
    } else if (lapNum < c.lap) {
      c.lastSectors = [0, 0, 0];
      c.completedLapNum = 0;
    }
    c.lastLap = lastLap;
    if (!c.bestFromHistory && c.lastLap > 0 && c.lastLap < 600000) {
      c.bestLap = c.bestLap ? Math.min(c.bestLap, c.lastLap) : c.lastLap;
    }
    c.curLap = buf.readUInt32LE(o + 4);
    c.s1 = msPlusMin(buf, o + 8);
    c.s2 = msPlusMin(buf, o + 11);
    c.gapFront = msPlusMin(buf, o + 14);
    c.gapLeader = msPlusMin(buf, o + 17);
    c.pos = buf.readUInt8(o + 32);
    c.lap = lapNum;
    c.pit = buf.readUInt8(o + 34);
    c.sector = buf.readUInt8(o + 36);
    c.invalid = buf.readUInt8(o + 37);
    c.penalties = buf.readUInt8(o + 38);
    c.status = buf.readUInt8(o + 44);
    c.result = buf.readUInt8(o + 45);
    if (i === state.viewCar) {
      state.car.lapDistance = buf.readFloatLE(o + 20);
      state.car.lapNum = c.lap;
      state.car.inPit = c.pit;
      // O jogo fornece segundos de delta, mas nao um bit de "delta ativo".
      // Zero durante SC pode significar que o delta deixou de ser exigido.
      const delta = buf.readFloatLE(o + 28);
      if ((state.safetyCar === 1 || state.safetyCar === 2) && Number.isFinite(delta) && Math.abs(delta) < 300) {
        state.safetyDelta.seconds = delta;
        state.safetyDelta.updatedAt = Date.now();
        if (Math.abs(delta) >= 0.005) state.safetyDelta.lastNonZeroAt = Date.now();
      }
    }
  }
  recomputeBest();
}

function parseParticipants(buf) { // id 4
  const layout = layoutOf(buf.length, 1, [[24, 60], [22, 57]]);
  note(4, buf.length, layout);
  if (!layout) return;
  state.numActive = Math.min(layout.count, buf.readUInt8(HEADER));
  for (let i = 0; i < layout.count; i++) {
    const o = HEADER + 1 + i * layout.stride;
    const c = state.cars[i];
    const newer = layout.stride === 60;
    c.ai = buf.readUInt8(o);
    c.team = buf.readUInt8(o + (newer ? 5 : 3));
    c.num = buf.readUInt8(o + (newer ? 8 : 5));
    const nameStart = o + (newer ? 10 : 7);
    let raw = buf.toString('utf8', nameStart, nameStart + 32);
    const z = raw.indexOf('\0');
    if (z >= 0) raw = raw.slice(0, z);
    c.name = raw.trim();
    const parts = c.name.split(/\s+/).filter(Boolean);
    const base = parts.length ? parts[parts.length - 1] : '';
    c.code = base ? base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 3).toUpperCase() : 'C' + String(i + 1).padStart(2, '0');
    const colorOffset = o + (newer ? 48 : 45);
    c.color = buf.readUInt8(o + (newer ? 47 : 44)) > 0
      ? '#' + buf.subarray(colorOffset, colorOffset + 3).toString('hex') : '';
  }
  for (let i = layout.count; i < MAX_CARS; i++) state.cars[i].pos = 0;
}

function parseCarTelemetry(buf, player) { // id 6
  const layout = layoutOf(buf.length, 3, [[24, 59], [22, 60]]);
  note(6, buf.length, layout);
  if (!layout || player >= layout.count) return;
  const o = HEADER + player * layout.stride;
  const car = state.car;
  car.speed = buf.readUInt16LE(o);
  car.throttle = buf.readFloatLE(o + 2);
  car.steer = buf.readFloatLE(o + 6);
  car.brake = buf.readFloatLE(o + 10);
  car.gear = buf.readInt8(o + 15);
  car.rpm = buf.readUInt16LE(o + 16);
  car.drs = state.format === 2026 ? 0 : buf.readUInt8(o + 18);
  turns.sample(car.lapNum, car.lapDistance, car.steer, car.inPit || 0);
}

function parseCarStatus(buf, player) { // id 7
  const layout = layoutOf(buf.length, 0, [[24, 59], [22, 55]]);
  note(7, buf.length, layout);
  if (!layout) return;
  for (let i = 0; i < layout.count; i++) {
    const o = HEADER + i * layout.stride;
    const c = state.cars[i];
    c.tyre = buf.readUInt8(o + 26);      // visual tyre compound
    c.tyreAge = buf.readUInt8(o + 27);
  }
  if (player < layout.count) {
    const o = HEADER + player * layout.stride;
    const m = buf.readUInt16LE(o + 17);
    if (m > 0) state.car.maxRpm = m;
    state.ers.store = buf.readFloatLE(o + 37);   // joules (experimental p/ 2026)
    state.ers.mode = buf.readUInt8(o + 41);
    state.car.fiaFlag = buf.readInt8(o + 28);   // bandeira mostrada ao jogador: 3 = amarela
    state.car.drsAllowed = state.format === 2026 ? 0 : buf.readUInt8(o + 22);
  }
}

function parseCarTelemetry2(buf, player) { // id 16: aero ativo e modo ultrapassagem do 2026
  const layout = layoutOf(buf.length, 0, [[24, 10]]);
  note(16, buf.length, layout);
  if (!layout || player >= layout.count) return;
  const o = HEADER + player * layout.stride;
  const car = state.car;
  car.aeroMode = buf.readUInt8(o);
  car.aeroAvailable = buf.readUInt8(o + 1);
  car.aeroActivationDistance = buf.readUInt16LE(o + 2);
  car.overtakeAvailable = buf.readUInt8(o + 4);
  car.overtakeActive = buf.readUInt8(o + 5);
  car.overtakeActivationDistance = buf.readUInt16LE(o + 6);
  car.regulations2026 = buf.readUInt8(o + 8);
}

function parseSession(buf) { // id 1: so o tipo de sessao (treino / qualy / corrida...)
  note(1, buf.length, buf.length >= 43 ? 0 : null);
  if (buf.length >= 43) {
    state.totalLaps = buf.readUInt8(32);
    state.sessionType = buf.readUInt8(35);
    state.trackLength = buf.readUInt16LE(33);
    state.trackId = buf.readInt8(36);
    turns.setTrack(state.trackId, state.trackLength);
    state.sessionTimeLeft = buf.readUInt16LE(38);
    state.spectating = buf.readUInt8(44) === 1;
    state.gamePaused = buf.readUInt8(43) === 1;
    if (buf.length >= 154) {
      const safetyCar = buf.readUInt8(153);
      if (safetyCar !== state.safetyCar) state.safetyDelta = { seconds: null, available: false, updatedAt: 0, lastNonZeroAt: 0 };
      state.safetyCar = safetyCar;
      const zones = Math.min(21, buf.readUInt8(47));
      let yellow = 0;
      for (let z = 0; z < zones; z++) if (buf.readInt8(52 + z * 5) === 3) yellow++;
      state.yellowZones = yellow;
    }
    const viewed = buf.readUInt8(45);
    state.viewCar = state.spectating && viewed < MAX_CARS ? viewed : state.player;
    // O id 15 e usado tanto para corrida normal quanto Sprint. Num fim de
    // semana Sprint, a estrutura inclui tambem a corrida 16 (Race 2).
    if (buf.length >= 745) {
      const count = Math.min(12, buf.readUInt8(732));
      state.weekendSessions = [...buf.subarray(733, 733 + count)];
      state.isSprintRace = state.sessionType === 15 && state.weekendSessions.includes(16);
    } else {
      state.weekendSessions = [];
      state.isSprintRace = false;
    }
  }
}

// id 11: historico de voltas de UM carro por pacote (o jogo vai rodando pelos carros).
// A melhor volta valida e indicada por "bestLapTimeLapNum" (1-based; 0 = ainda sem volta).
function parseSessionHistory(buf) {
  note(11, buf.length, buf.length >= 50 ? 0 : null);
  if (buf.length < 50) return;
  const idx = buf.readUInt8(HEADER);
  const bestNum = buf.readUInt8(HEADER + 3);
  if (idx >= MAX_CARS) return;
  const numLaps = buf.readUInt8(HEADER + 1);
  const c = state.cars[idx];
  const o = 36 + (bestNum - 1) * 14;
  if (bestNum > 0 && bestNum <= numLaps && o + 4 <= buf.length) {
    c.bestLap = buf.readUInt32LE(o);
    c.bestFromHistory = true;
  }
  if (bestNum > 0 && bestNum <= numLaps) {
    for (const [field, sectorOffset] of [['bl1', 4], ['bl2', 7], ['bl3', 10]]) {
      const at = 36 + (bestNum - 1) * 14 + sectorOffset;
      c[field] = at + 3 <= buf.length ? msPlusMin(buf, at) : 0;
    }
  }
  for (const [field, offset, sectorOffset] of [['bs1', 4, 4], ['bs2', 5, 7], ['bs3', 6, 10]]) {
    const lapNum = buf.readUInt8(HEADER + offset);
    const at = 36 + (lapNum - 1) * 14 + sectorOffset;
    c[field] = lapNum > 0 && lapNum <= numLaps && at + 3 <= buf.length ? msPlusMin(buf, at) : 0;
  }
  recomputeBest();
}

const seenIds = new Set();
const dumpedIds = new Set();
const lastRecorded = {};
let lastFastestKey = '';

function parseEvent(buf) { // id 3: eventos pontuais da transmissao
  note(3, buf.length, buf.length >= 33 ? 0 : null);
  if (buf.length < 33) return;
  const code = buf.toString('ascii', HEADER, HEADER + 4);
  if (code === 'FTLP' && buf.length >= 38) {
    const idx = buf.readUInt8(33), seconds = buf.readFloatLE(34);
    if (idx >= MAX_CARS || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600) return;
    const lapMs = Math.round(seconds * 1000);
    const key = state.sessionUid + ':' + idx + ':' + lapMs;
    if (key !== lastFastestKey) {
      lastFastestKey = key;
      state.fastestLap = { idx, lapMs, expiresAt: Date.now() + 8000 };
    }
  } else if (code === 'RDFL') {
    state.redFlag = true;
    state.safetyDelta = { seconds: null, available: false, updatedAt: 0, lastNonZeroAt: 0 };
  } else if (code === 'SSTA' || code === 'LGOT' || code === 'SEND') {
    state.redFlag = false;
  } else if (code === 'FLBK') {
    state.redFlag = false;
    state.fastestLap = null;
    lastFastestKey = '';
  } else if (code === 'SCAR' && buf.length >= 35) {
    const type = buf.readUInt8(33), eventType = buf.readUInt8(34);
    if (eventType === 0 && type <= 3) state.safetyCar = type;
    if (eventType === 2 || eventType === 3) {
      state.safetyCar = 0;
      state.safetyDelta = { seconds: null, available: false, updatedAt: 0, lastNonZeroAt: 0 };
      if (eventType === 3) state.redFlag = false;
    }
  }
}

function handlePacket(buf) {
  if (buf.length < HEADER) return;
  const id = buf.readUInt8(6);
  const player = buf.readUInt8(27);
  const format = buf.readUInt16LE(0);
  if (format !== 2025 && format !== 2026) return;
  const uid = buf.subarray(7, 15).toString('hex');
  if (state.sessionUid && state.sessionUid !== uid) {
    for (const c of state.cars) {
      c.lastLap = c.curLap = c.bestLap = c.bs1 = c.bs2 = c.bs3 = c.bl1 = c.bl2 = c.bl3 = 0;
      c.bestFromHistory = false;
      c.lastSectors = [0, 0, 0]; c.completedLapNum = 0;
    }
    state.best = { lap: 0, s1: 0, s2: 0, s3: 0 };
    state.redFlag = false;
    state.fastestLap = null;
    state.safetyDelta = { seconds: null, available: false, updatedAt: 0, lastNonZeroAt: 0 };
    lastFastestKey = '';
  }
  state.sessionUid = uid;
  state.connected = true;
  state.lastPacketAt = Date.now();
  state.format = format;
  state.player = player;
  if (!state.spectating) state.viewCar = player;
  state.dbg.counts[id] = (state.dbg.counts[id] || 0) + 1;
  state.dbg.sizes[id] = buf.length;
  if (DEBUG && !seenIds.has(id)) {
    seenIds.add(id);
    console.log(`[debug] chegou pacote id=${id} tamanho=${buf.length} (formato ${state.format}, jogador=${player})`);
  }
  if (DUMP && !dumpedIds.has(id)) {
    dumpedIds.add(id);
    const dir = path.join(__dirname, 'dump');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `id${id}-tam${buf.length}.bin`), buf);
  }
  if (RECORD && [2, 6, 7].includes(id) && player < MAX_CARS && Date.now() - (lastRecorded[id] || 0) >= 500) {
    const layouts = { 2: layoutOf(buf.length, 2, [[24, 57], [22, 57]]),
      6: layoutOf(buf.length, 3, [[24, 59], [22, 60]]), 7: layoutOf(buf.length, 0, [[24, 59], [22, 55]]) };
    const layout = layouts[id];
    if (layout && player < layout.count) {
      lastRecorded[id] = Date.now();
      fs.mkdirSync(path.join(__dirname, 'dump'), { recursive: true });
      const entry = { at: new Date().toISOString(), format, id, player,
        bytes: buf.subarray(HEADER + player * layout.stride, HEADER + (player + 1) * layout.stride).toString('hex') };
      fs.appendFileSync(path.join(__dirname, 'dump', 'player-samples.jsonl'), JSON.stringify(entry) + '\n');
    }
  }
  try {
    if (id === 1) parseSession(buf);
    else if (id === 3) parseEvent(buf);
    else if (id === 11) parseSessionHistory(buf);
    else if (id === 2) parseLapData(buf);
    else if (id === 4) parseParticipants(buf);
    else if (id === 6) parseCarTelemetry(buf, state.viewCar);
    else if (id === 7) parseCarStatus(buf, state.viewCar);
    else if (id === 16) parseCarTelemetry2(buf, state.viewCar);
  } catch (err) {
    if (DEBUG) console.log('[debug] erro ao ler pacote', id, err.message);
  }
}

// ----------------------------------------------------------------- demo ---

function startDemo() {
  const names = ['Alves', 'Brandt', 'Castro', 'Duarte', 'Eriksen', 'Ferrer', 'Giraud', 'Hoshino',
    'Ivanov', 'Jansen', 'Keller', 'Lopes', 'Marin', 'Novak', 'Okafor', 'Prado', 'Quinn',
    'Rossi', 'Sato', 'Tavares'];
  const base = names.map((_, i) => 80 + ((i * 7) % 11) * 0.6);
  const dist = names.map((_, i) => -i * 40);
  const LAP = 5200;
  names.forEach((n, i) => {
    const c = state.cars[i];
    c.name = n; c.code = n.slice(0, 3).toUpperCase(); c.team = Math.floor(i / 2) % 10;
    c.num = i + 1; c.ai = i === 0 ? 0 : 1; c.tyre = [16, 17, 18][i % 3]; c.tyreAge = 3 + (i % 5);
  });
  state.player = 0;
  state.connected = true;
  state.numActive = names.length;
  state.sessionType = QUALI ? 6 : 15;   // 6 = Q2, 15 = corrida
  state.weekendSessions = QUALI ? [5, 6, 7, 15] : [5, 6, 7, 15];
  state.isSprintRace = false;
  state.totalLaps = 57;
  state.format = 2026;
  state.sessionTimeLeft = QUALI ? 720 : 0;
  if (QUALI) {
    // melhores voltas falsas; os 3 ultimos ainda sem tempo
    names.forEach((_, i) => {
      const c = state.cars[i];
      c.bestLap = i < names.length - 3 ? 88000 + ((i * 7) % 17) * 190 + 340 : 0;
      c.bl1 = c.bestLap ? Math.round(c.bestLap * 0.31) : 0; c.bl2 = c.bestLap ? Math.round(c.bestLap * 0.34) : 0;
      c.bl3 = c.bestLap ? c.bestLap - c.bl1 - c.bl2 : 0;
    });
  }
  let t = 0, fastestCycle = -1;
  setInterval(() => {
    const dt = 0.05; t += dt;
    names.forEach((_, i) => { dist[i] += (base[i] + Math.sin(t / 3 + i) * 3) * dt; });
    if (QUALI) state.sessionTimeLeft = Math.max(0, 720 - Math.floor(t));
    const order = names.map((_, i) => i).sort((a, b) => dist[b] - dist[a]);
    order.forEach((idx, p) => {
      const c = state.cars[idx];
      c.pos = p + 1;
      const v = base[idx];
      c.gapFront = p === 0 ? 0 : Math.round(((dist[order[p - 1]] - dist[idx]) / v) * 1000);
      c.gapLeader = p === 0 ? 0 : Math.round(((dist[order[0]] - dist[idx]) / v) * 1000);
      const demoLap = Math.max(1, Math.floor(dist[idx] / LAP) + 1);
      if (!QUALI && demoLap > c.lap && c.lap > 0) {
        c.lastSectors = [c.s1, c.s2, 91234 + idx * 137 - c.s1 - c.s2];
        c.completedLapNum = c.lap;
      }
      c.lap = demoLap;
      c.curLap = Math.round(((dist[idx] % LAP + LAP) % LAP) / v * 1000);
      c.lastLap = 91234 + idx * 137;
      c.pit = idx === 7 && Math.floor(t / 6) % 4 === 3 ? 1 : 0;
      c.status = c.pit ? 0 : QUALI ? 1 : 4;
      c.result = 2;
      c.s1 = c.curLap > 28000 ? 28000 + idx * 19 : 0;
      c.s2 = c.curLap > 58000 ? 30000 + idx * 13 : 0;
      c.bs1 = 27500 + idx * 19; c.bs2 = 29500 + idx * 13; c.bs3 = 31000 + idx * 17;
      c.sector = c.curLap < 28000 ? 0 : c.curLap < 58000 ? 1 : 2;
      if (QUALI) { c.s1 = c.sector > 0 ? 27000 + ((idx * 37) % 1800) : 0; c.s2 = c.sector > 1 ? 29000 + ((idx * 53) % 1800) : 0; }
    });
    state.cars.slice(names.length).forEach((c) => { c.pos = 0; });
    if (QUALI) {
      // na qualy a posicao vem do melhor tempo; todos "nos boxes"
      const byBest = names.map((_, i) => i).sort((a, b) => (state.cars[a].bestLap || 1e9) - (state.cars[b].bestLap || 1e9));
      byBest.forEach((idx, p) => { state.cars[idx].pos = p + 1; state.cars[idx].pit = 0;
        state.cars[idx].status = Math.floor(t / 12 + idx / 3) % 3 === 0 ? 0 : 1; });
    }
    const k = (Math.sin(t / 2.2) + 1) / 2;
    const car = state.car;
    car.speed = Math.round(70 + k * 250);
    car.gear = Math.max(1, Math.min(8, 1 + Math.floor(car.speed / 42)));
    car.maxRpm = 13000;
    car.rpm = Math.round(7500 + ((car.speed % 42) / 42) * 5200);
    car.throttle = Math.max(0, Math.cos(t / 2.2));
    car.brake = Math.max(0, -Math.cos(t / 2.2) * 0.9);
    car.drs = k > 0.85 ? 1 : 0;
    car.aeroMode = k > 0.6 ? 1 : 0;
    car.aeroAvailable = 1;
    car.aeroActivationDistance = car.aeroMode ? 0 : Math.round((0.6 - k) * 200);
    car.overtakeAvailable = k > 0.55 ? 1 : 0;
    car.overtakeActive = k > 0.85 ? 1 : 0;
    car.overtakeActivationDistance = car.overtakeAvailable ? 0 : Math.round((0.55 - k) * 220);
    car.regulations2026 = 1;
    state.ers.store = Math.round(2_000_000 + Math.sin(t / 5) * 1_800_000);
    state.ers.mode = k > 0.78 ? 3 : 1;
    // Demo das situacoes de pista: VSC, SC com delta, SC sem delta e bandeira vermelha.
    const phase = Math.floor(t / 8) % 6;
    state.safetyCar = phase === 2 ? 2 : phase === 3 || phase === 4 ? 1 : 0;
    state.yellowZones = phase === 1 ? 2 : 0;
    state.redFlag = phase === 5;
    const withDelta = phase === 2 || phase === 3;
    state.safetyDelta = withDelta ? { seconds: Math.sin(t * 0.8) * 1.8 + 0.35,
      available: true, updatedAt: Date.now(), lastNonZeroAt: Date.now() }
      : { seconds: null, available: false, updatedAt: 0, lastNonZeroAt: 0 };
    const cycle = Math.floor(t / 36);
    if (cycle !== fastestCycle) {
      fastestCycle = cycle;
      state.fastestLap = { idx: cycle % names.length, lapMs: 76213 + cycle * 77, expiresAt: Date.now() + 8000 };
    }
    car.steer = Math.sin(t / 1.3) * 0.5;
    state.turn.status = 'ready'; state.turn.total = 19; state.turn.n = 1 + Math.floor(((t / 6) % 1) * 19);
    const demoLaps = state.cars.slice(0, names.length).map(c => c.bestLap).filter(Boolean);
    state.best = { lap: demoLaps.length ? Math.min(...demoLaps) : 0,
      s1: 27500, s2: 29500, s3: 31000 };
    state.lastPacketAt = Date.now();
  }, 50);
}

// ----------------------------------------------------------------- http ---

const clients = new Set();

function updateUi(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false;
  const ui = state.ui;
  let label = '';
  if (UI_KEYS.includes(action.toggle)) {
    ui[action.toggle] = !ui[action.toggle];
    label = `${action.toggle.toUpperCase()}: ${ui[action.toggle] ? 'LIGADO' : 'DESLIGADO'}`;
  } else if (typeof action.toast === 'string') {
    label = action.toast.slice(0, 90);
  } else if (action.cycleMode === true) {
    ui.mode = { auto: 'quali', quali: 'race', race: 'auto' }[ui.mode];
    label = `MODO: ${ui.mode.toUpperCase()}`;
  } else if (['auto', 'quali', 'race'].includes(action.mode)) {
    ui.mode = action.mode;
    label = `MODO: ${ui.mode.toUpperCase()}`;
  } else return false;
  ui.toast = label;
  ui.toastUntil = Date.now() + (typeof action.toast === 'string' ? 6000 : 1800);
  if (require.main === module) console.log('[ui] ' + label);
  return true;
}

function updateHaloLayout(action) {
  if (!action || typeof action !== 'object') return false;
  const team = action.team === 'default' ? 'default'
    : action.team === 'current' ? String(state.cars[state.viewCar]?.team ?? 255) : '';
  const profile = team === '255' ? 'default' : team;
  if (!profile || !['x', 'y', 'scale'].some(k => action[k] !== undefined)) return false;
  const base = haloLayouts[profile] || haloLayouts.default;
  const next = { ...base };
  for (const [field, min, max] of [['x', 10, 90], ['y', 10, 85], ['scale', 0.5, 2]]) {
    if (action[field] === undefined) continue;
    const value = Number(action[field]);
    if (!Number.isFinite(value) || value < min || value > max) return false;
    next[field] = value;
  }
  haloLayouts[profile] = next;
  fs.writeFileSync(HALO_FILE, JSON.stringify(haloLayouts, null, 2) + '\n');
  return true;
}

function updateHudScale(action) {
  if (!action || !Object.hasOwn(hudScales, action.component)) return false;
  const value = Number(action.scale);
  if (!Number.isFinite(value) || value < 0.3 || value > 3) return false;
  hudScales[action.component] = value;
  fs.writeFileSync(HUD_SCALE_FILE, JSON.stringify(hudScales, null, 2) + '\n');
  return true;
}

function updateHudOffset(action) {
  if (!action || !['tower', 'onboard', 'lap', 'cards', 'flags', 'fastest'].includes(action.component)) return false;
  if (action.reset === true) delete hudOffsets[action.component];
  else {
    const dx = Number(action.dx), dy = Number(action.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 100 || Math.abs(dy) > 100) return false;
    hudOffsets[action.component] = { dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 };
  }
  fs.writeFileSync(HUD_OFFSET_FILE, JSON.stringify(hudOffsets, null, 2) + '\n');
  return true;
}

function refreshLink() {
  const idle = Date.now() - state.lastPacketAt;
  state.connected = idle < 3000;
  state.paused = state.lastPacketAt > 0 && idle >= 3000;
  // fica visivel (congelada) por ate 15 min sem pacotes: pausa longa nao some com a HUD
  state.visible = state.lastPacketAt > 0 && idle < 15 * 60 * 1000;
  const delta = state.safetyDelta;
  delta.available = (state.safetyCar === 1 || state.safetyCar === 2)
    && Date.now() - delta.updatedAt < 1000 && Date.now() - delta.lastNonZeroAt < 1000;
}

// Abre o painel de controle no navegador padrao (so um endereco fixo local; ignora falhas).
function openControlPanel(url) {
  try {
    const { spawn } = require('child_process');
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch (_) { /* sem navegador: abra o endereco manualmente */ }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && (url === '/api/ui' || url === '/api/halo-layout' || url === '/api/scale' || url === '/api/offset')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      let action;
      try { action = JSON.parse(body); } catch (_) {}
      const ok = url === '/api/ui' ? updateUi(action)
        : url === '/api/halo-layout' ? updateHaloLayout(action)
        : url === '/api/offset' ? updateHudOffset(action) : updateHudScale(action);
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(ok ? (url === '/api/ui' ? state.ui
        : url === '/api/halo-layout' ? state.haloLayouts
        : url === '/api/offset' ? state.hudOffsets : state.hudScales) : { error: 'acao invalida' }));
    });
  } else if (req.method === 'GET' && (url === '/' || url === '/overlay.html' || url === '/control')) {
    fs.readFile(path.join(__dirname, url === '/control' ? 'control.html' : 'overlay.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('overlay.html nao encontrado'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } else if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  } else if (req.method === 'GET' && url === '/api/ui') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(state.ui));
  } else if (url === '/state') {
    refreshLink();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
  } else {
    res.writeHead(404); res.end('nao encontrado');
  }
});

if (require.main === module) {
  setInterval(() => {
    if (!clients.size) return;
    refreshLink();
    const msg = `data: ${JSON.stringify(state)}\n\n`;
    for (const c of clients) c.write(msg);
  }, 50);

  server.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`Overlay:  http://127.0.0.1:${HTTP_PORT}/   (use como Browser Source no OBS)`);
    console.log(`Painel de controle: http://127.0.0.1:${HTTP_PORT}/control`);
    if (!NO_OPEN) openControlPanel(`http://127.0.0.1:${HTTP_PORT}/control`);
  });

  if (DEMO) {
    console.log('Modo DEMO: dados falsos, sem ler o jogo.');
    startDemo();
  } else {
    const udp = dgram.createSocket('udp4');
    udp.on('message', handlePacket);
    udp.on('error', (e) => { console.error('Erro UDP:', e.message); process.exit(1); });
    udp.bind(UDP_PORT, '0.0.0.0', () => {
      console.log(`Ouvindo telemetria UDP na porta ${UDP_PORT}. No jogo: IP 127.0.0.1, porta ${UDP_PORT}.`);
    });
  }
}

module.exports = { state, handlePacket, updateUi, updateHaloLayout, updateHudScale, updateHudOffset };
