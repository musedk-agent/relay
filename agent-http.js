// Runs on the VM. Uses plain HTTPS (works through the egress proxy).
// Pushes screenshots via POST /push-shot, long-polls GET /poll-events for input.
const { exec } = require('child_process');

const BASE = process.env.RELAY_BASE;
if (!BASE) { console.error('Set RELAY_BASE'); process.exit(1); }

const DISPLAY_ENV = 'DISPLAY=:1';

function shell(cmd, cb) {
  exec(DISPLAY_ENV + ' ' + cmd, { maxBuffer: 12 * 1024 * 1024 }, cb || (() => {}));
}

async function pushShot(b64) {
  try {
    const r = await fetch(BASE + '/push-shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'shot', data: b64 }),
    });
    if (!r.ok) console.log('push-shot status', r.status);
  } catch (e) {
    console.log('push-shot err', e.message);
  }
}

function shoot() {
  shell('xwd -root -silent | xwdtopnm 2>/dev/null | pnmtojpeg -quality 55 2>/dev/null | base64 -w0',
    (err, out) => {
      if (err || !out) return;
      const b64 = out.toString().trim();
      if (b64.length < 100) return;
      pushShot(b64);
    });
}

function handleEvent(m) {
  if (m.type === 'move') {
    shell(`xdotool mousemove ${m.x | 0} ${m.y | 0}`);
  } else if (m.type === 'click') {
    shell(`xdotool mousemove ${m.x | 0} ${m.y | 0} click ${m.button === 3 ? 3 : 1}`);
  } else if (m.type === 'key') {
    shell(`xdotool key ${m.key}`);
  } else if (m.type === 'type') {
    const safe = String(m.text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    shell(`xdotool type --delay 5 -- "${safe}"`);
  }
}

async function pollLoop() {
  while (true) {
    try {
      const r = await fetch(BASE + '/poll-events');
      if (r.ok) {
        const evs = await r.json();
        for (const ev of evs) handleEvent(ev);
      } else {
        console.log('poll status', r.status);
      }
    } catch (e) {
      // network hiccup — just loop
    }
    await new Promise((res) => setTimeout(res, 500));
  }
}

console.log('agent-http starting, base', BASE);
setInterval(shoot, 700);
shoot();
pollLoop();
