// Numero da curva (TURN): o jogo nao envia isso na telemetria UDP, entao o overlay APRENDE a pista.
// Na primeira volta completa e sem pit em uma pista, detecta onde o volante esta esterçado (steer x
// distancia da volta) e numera as curvas em ordem. Salva em curvas/<trackId>.json (pode ser editado:
// ajuste start/end/n, ou apague o arquivo para reaprender). A numeracao aprendida pode divergir da
// oficial (curvas em reta muito rapidas nao sao detectadas; chicanes contam como duas).
'use strict';
const fs = require('fs');
const path = require('path');

const ENTER = 0.10, EXIT = 0.05, MIN_PEAK = 0.15, MIN_LEN = 20, MERGE_GAP = 40, LEAD = 20;

function detectCorners(samples) { // samples: [[dist, steer]] ordenado por dist
  const segs = [];
  let cur = null;
  for (const [d, s] of samples) {
    const a = Math.abs(s);
    if (!cur) {
      if (a > ENTER) cur = { start: d, end: d, peak: a, sign: Math.sign(s) };
    } else if (a < EXIT || (a > ENTER && Math.sign(s) !== cur.sign)) {
      segs.push(cur);
      cur = a > ENTER ? { start: d, end: d, peak: a, sign: Math.sign(s) } : null;
    } else { cur.end = d; cur.peak = Math.max(cur.peak, a); }
  }
  if (cur) segs.push(cur);
  const merged = [];
  for (const g of segs) {
    const last = merged[merged.length - 1];
    if (last && last.sign === g.sign && g.start - last.end < MERGE_GAP) {
      last.end = g.end; last.peak = Math.max(last.peak, g.peak);
    } else merged.push({ ...g });
  }
  return merged.filter(g => g.peak >= MIN_PEAK && g.end - g.start >= MIN_LEN)
    .map((g, i) => ({ n: i + 1, start: Math.round(g.start), end: Math.round(g.end) }));
}

function createTurnTracker(dir) {
  let trackId = null, length = 0, corners = null, learning = [], lapNum = -1, dirty = false;
  const file = id => path.join(dir, `${id}.json`);
  const out = { n: null, total: 0, status: 'unknown' };

  function setTrack(id, len) {
    if (id === trackId && len === length) return;
    trackId = id; length = len; corners = null; learning = []; lapNum = -1; dirty = false;
    try {
      const data = JSON.parse(fs.readFileSync(file(id), 'utf8'));
      if (Array.isArray(data.corners) && data.corners.length) corners = data.corners;
    } catch (_) {}
    out.status = corners ? 'ready' : 'learning';
    out.total = corners ? corners.length : 0;
    out.n = null;
  }

  function finishLap() {
    if (corners || !learning.length || dirty || !length) return;
    learning.sort((a, b) => a[0] - b[0]);
    let gap = 0;
    for (let i = 1; i < learning.length; i++) gap = Math.max(gap, learning[i][0] - learning[i - 1][0]);
    const covered = learning[learning.length - 1][0] - learning[0][0];
    if (covered < length * 0.95 || gap > 100) return;
    const found = detectCorners(learning);
    if (found.length < 4 || found.length > 40) return;
    corners = found; out.status = 'ready'; out.total = found.length;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file(trackId), JSON.stringify({ trackId, trackLength: length, learned: true, corners }, null, 2));
    } catch (_) {}
  }

  function sample(lap, dist, steer, pit) {
    if (trackId === null || !Number.isFinite(dist) || !Number.isFinite(steer)) return out;
    if (lap !== lapNum) { finishLap(); learning = []; dirty = pit !== 0 || dist > 300; lapNum = lap; }
    if (pit) dirty = true;
    if (!corners) { if (dist >= 0) learning.push([dist, steer]); out.n = null; return out; }
    let n = corners[corners.length - 1].n;
    for (const c of corners) if (c.start - LEAD <= dist) n = c.n;
    if (dist < corners[0].start - LEAD) n = corners[corners.length - 1].n;
    out.n = n;
    return out;
  }
  return { setTrack, sample, state: out, detectCorners };
}

module.exports = { createTurnTracker, detectCorners };
