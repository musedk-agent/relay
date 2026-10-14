// Runs on the VM. Bridges the desktop (screenshots out, xdotool in)
// to the relay's /agent WebSocket.
const WebSocket = require('ws');
const { exec } = require('child_process');

const RELAY = process.env.RELAY_URL;
if (!RELAY) { console.error('Set RELAY_URL'); process.exit(1); }

const DISPLAY_ENV = 'DISPLAY=:1';
let ws = null;
let shotTimer = null;

function shell(cmd, cb) {
  exec(DISPLAY_ENV + ' ' + cmd, { maxBuffer: 12 * 1024 * 1024 }, cb || (() => {}));
}

function connect() {
  console.log('connecting to', RELAY);
  ws = new WebSocket(RELAY);

  ws.on('open', () => {
    console.log('agent linked');
    // screenshot loop ~2fps
    if (shotTimer) clearInterval(shotTimer);
    shotTimer = setInterval(shoot, 500);
    shoot();
  });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'move') {
      shell(`xdotool mousemove ${m.x|0} ${m.y|0}`);
    } else if (m.type === 'click') {
      shell(`xdotool mousemove ${m.x|0} ${m.y|0} click ${m.button === 3 ? 3 : 1}`);
    } else if (m.type === 'key') {
      shell(`xdotool key ${m.key}`);
    } else if (m.type === 'type') {
      const safe = String(m.text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      shell(`xdotool type --delay 5 -- "${safe}"`);
    }
  });

  ws.on('close', () => {
    console.log('relay lost, retrying in 3s');
    if (shotTimer) { clearInterval(shotTimer); shotTimer = null; }
    setTimeout(connect, 3000);
  });
  ws.on('error', () => { try { ws.close(); } catch (e) {} });
}

function shoot() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  shell('xwd -root -silent | xwdtopnm 2>/dev/null | pnmtojpeg -quality 55 2>/dev/null | base64 -w0',
    (err, out) => {
      if (err || !out) return;
      const b64 = out.toString().trim();
      if (b64.length < 100) return;
      try { ws.send(JSON.stringify({ type: 'shot', data: b64 })); } catch (e) {}
    });
}

connect();
