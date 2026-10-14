// Testa o aprendizado de curvas com uma pista sintetica (4000 m, 5 curvas).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTurnTracker } = require('./curvas');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curvas-'));
const corners = [[500, 650, 0.4], [1200, 1300, -0.5], [1320, 1420, 0.5], [2400, 2700, -0.3], [3300, 3420, 0.6]];
const steer = d => { for (const [a, b, v] of corners) if (d >= a && d <= b) return v; return 0.01; };
const t = createTurnTracker(dir);
t.setTrack(7, 4000);
for (let lap = 1; lap <= 3; lap++) for (let d = 0; d < 4000; d += 5) {
  const st = t.sample(lap, d, steer(d), 0);
  if (lap === 1) assert.strictEqual(st.status, 'learning');
  if (lap === 3 && d === 1250) assert.strictEqual(st.n, 2);
  if (lap === 3 && d === 1400) assert.strictEqual(st.n, 3);
  if (lap === 3 && d === 3000) assert.strictEqual(st.n, 4);
}
assert.strictEqual(t.state.status, 'ready');
assert.strictEqual(t.state.total, 5);
const saved = JSON.parse(fs.readFileSync(path.join(dir, '7.json'), 'utf8'));
assert.strictEqual(saved.corners.length, 5);
// volta com pit nao ensina
const t2 = createTurnTracker(fs.mkdtempSync(path.join(os.tmpdir(), 'curvas-')));
t2.setTrack(9, 4000);
for (let lap = 1; lap <= 2; lap++) for (let d = 0; d < 4000; d += 5) t2.sample(lap, d, steer(d), d < 100 ? 1 : 0);
assert.strictEqual(t2.state.status, 'learning');
// novo tracker le o arquivo salvo
const t3 = createTurnTracker(dir); t3.setTrack(7, 4000);
assert.strictEqual(t3.state.status, 'ready');
console.log('Curvas: aprende 5 curvas na 1a volta limpa, ignora volta com pit, recarrega do arquivo.');
