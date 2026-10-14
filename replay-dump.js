// Reproduz os pacotes salvos em ./dump no servidor local, sem abrir o jogo.
'use strict';
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'dump');
const files = fs.readdirSync(dir).filter(x => /^id\d+-tam\d+\.bin$/.test(x));
if (!files.length) { console.error('Nenhum arquivo .bin em dump/'); process.exit(1); }
const packets = files.map(file => fs.readFileSync(path.join(dir, file)))
  .filter(buf => buf.length >= 29);
const udp = dgram.createSocket('udp4');
const port = Number(process.env.UDP_PORT || 20777);
function send() { for (const packet of packets) udp.send(packet, port, '127.0.0.1'); }
send();
const timer = setInterval(send, 500);
console.log(`Reproduzindo ${packets.length} pacotes em UDP ${port}. Ctrl+C para parar.`);
process.on('SIGINT', () => { clearInterval(timer); udp.close(); });
