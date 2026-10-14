// Verifica a inicializacao do main.js sem abrir uma janela na tela.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const shortcuts = [];
let loadedUrl = '';
class Window {
  setAlwaysOnTop() {}
  setIgnoreMouseEvents() {}
  setFocusable() {}
  focus() {}
  blur() {}
  loadURL(url) { loadedUrl = url; }
  once(_event, callback) { callback(); }
  showInactive() {}
}
const electron = {
  app: { whenReady: () => ({ then: callback => callback() }), on() {} },
  BrowserWindow: Window,
  screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  globalShortcut: { register: key => { shortcuts.push(key); return true; }, unregisterAll() {} },
};
const source = fs.readFileSync(path.join(__dirname, 'janela', 'main.js'), 'utf8');
vm.runInNewContext(source, { require: name => name === 'electron' ? electron : require(name),
  process, Buffer, console, URL, setTimeout: () => 0, setInterval: () => 0 });
assert.strictEqual(loadedUrl, 'http://127.0.0.1:8080/');
assert(shortcuts.length >= 9 && shortcuts.includes('Control+Alt+H') && shortcuts.includes('Control+Shift+H') && shortcuts.includes('Control+Alt+E'));
console.log('Janela inicializa e registra os atalhos (HUD inteiro tem 3 alternativas).');
