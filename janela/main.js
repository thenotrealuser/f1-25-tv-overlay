// Janela transparente, sem borda, sempre no topo e "click-through" (nao rouba mouse/teclado).
// Mostra http://127.0.0.1:8080/ (o servidor precisa estar rodando).
// O jogo precisa estar em "Janela (Tela Cheia)" para o overlay aparecer por cima.
const { app, BrowserWindow, screen, globalShortcut } = require('electron');
const http = require('http');

const overlayUrl = process.env.OVERLAY_URL || 'http://127.0.0.1:8080/';
const apiUrl = new URL('/api/ui', overlayUrl);

let setEditMode = () => {};
function send(action) {
  const body = JSON.stringify(action);
  const req = http.request(apiUrl, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
  } }, res => res.resume());
  req.on('error', err => console.error('Atalho sem servidor:', err.message));
  req.end(body);
}

// Modo de edicao: a janela deixa de ser click-through (mouse e foco) enquanto ui.edit estiver ligado.
// Consulta o servidor, assim o botao da pagina /control tambem liga o modo.
function pollUi() {
  http.get(apiUrl, res => {
    let body = '';
    res.on('data', c => { body += c; });
    res.on('end', () => { try { setEditMode(!!JSON.parse(body).edit); } catch (_) {} });
  }).on('error', () => {});
}

app.whenReady().then(() => {
  const { bounds } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  let editing = false;
  setEditMode = (on) => {
    if (on === editing) return;
    editing = on;
    win.setIgnoreMouseEvents(!on);
    win.setFocusable(on);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (on) win.focus(); else win.blur();
    console.log('Modo de edicao:', on ? 'LIGADO (mouse ativo)' : 'desligado (click-through)');
  };
  setInterval(pollUi, 400);
  win.loadURL(overlayUrl);
  win.once('ready-to-show', () => win.showInactive());
  // Cada acao tem mais de um atalho: se um estiver ocupado por outro programa, o outro funciona.
  const registered = [], failed = [];
  for (const [shortcuts, action] of [
    [['Control+Alt+H', 'Control+Shift+H', 'Control+Alt+F10'], { toggle: 'all' }],
    [['Control+Alt+T'], { toggle: 'tower' }],
    [['Control+Alt+F'], { toggle: 'flags' }],
    [['Control+Alt+V'], { toggle: 'fastest' }],
    [['Control+Alt+L'], { toggle: 'lap' }],
    [['Control+Alt+O'], { toggle: 'onboard' }],
    [['Control+Alt+G'], { toggle: 'halo' }],
    [['Control+Alt+M'], { cycleMode: true }],
    [['Control+Alt+K'], { toggle: 'cards' }],
    [['Control+Alt+E', 'Control+Shift+E'], { toggle: 'edit' }],
  ]) {
    for (const shortcut of shortcuts) {
      let ok = false;
      try { ok = globalShortcut.register(shortcut, () => { console.log('Atalho', shortcut); send(action); }); } catch (_) {}
      (ok ? registered : failed).push(shortcut);
    }
  }
  console.log('Atalhos registrados:', registered.join(', '));
  if (failed.length) console.warn('Atalhos indisponiveis (usados por outro programa):', failed.join(', '));
  // Aviso na tela por alguns segundos, para saber se os atalhos pegaram.
  setTimeout(() => send({ toast: failed.length
    ? 'ATALHO OCUPADO: ' + failed.join(' ') + ' | HUD: Ctrl+Shift+H'
    : 'ATALHOS OK | HUD: Ctrl+Alt+H ou Ctrl+Shift+H' }), 2500);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
