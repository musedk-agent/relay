const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8080;
const PASSWORD = process.env.RELAY_PASSWORD || '';
if (!PASSWORD) console.log('WARNING: no RELAY_PASSWORD set, relay is open');

function authed(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const creds = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const pw = creds.includes(':') ? creds.split(':').slice(1).join(':') : creds;
  return pw === PASSWORD;
}

function deny(res) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="desktop"' });
  res.end('auth required');
}

let agent = null;
let viewer = null;
let lastAgentHttp = 0;
const pendingEvents = [];
const pendingPolls = [];

function pushEvent(ev) {
  if (agent && agent.readyState === WebSocket.OPEN) {
    agent.send(JSON.stringify(ev));
    return;
  }
  pendingEvents.push(ev);
  // wake one long-poller
  const p = pendingPolls.shift();
  if (p) {
    clearTimeout(p.to);
    const evs = pendingEvents.splice(0);
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(evs));
  }
}

const server = http.createServer((req, res) => {
  if (!authed(req)) { deny(res); return; }
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'viewer.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      agent: !!agent,
      agentHttp: Date.now() - lastAgentHttp < 10000,
      viewer: !!viewer,
      time: new Date().toISOString()
    }));
  } else if (req.url === '/push-shot' && req.method === 'POST') {
    // Agent pushes screenshot via plain HTTPS POST (no WebSocket needed)
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 15 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      lastAgentHttp = Date.now();
      try {
        const m = JSON.parse(body);
        if (m.type === 'shot' && viewer && viewer.readyState === WebSocket.OPEN) {
          viewer.send(JSON.stringify({ type: 'shot', data: m.data }));
        }
      } catch (e) {}
      res.writeHead(200); res.end('ok');
    });
  } else if (req.url === '/poll-events' && req.method === 'GET') {
    // Agent polls for input events (short-poll, GitHub relay dislikes long holds)
    lastAgentHttp = Date.now();
    const evs = pendingEvents.splice(0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(evs));
  } else {
    res.writeHead(404); res.end('nope');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  if (!authed(req)) { ws.close(4401, 'auth required'); return; }
  const p = (req.url || '').split('?')[0];
  if (p === '/agent') {
    if (agent) agent.close();
    agent = ws;
    console.log('agent connected');
    ws.on('message', (d) => {
      if (viewer && viewer.readyState === WebSocket.OPEN) viewer.send(d);
    });
    ws.on('close', () => { console.log('agent gone'); if (agent === ws) agent = null; });
    ws.on('error', () => {});
  } else if (p === '/viewer') {
    if (viewer) viewer.close();
    viewer = ws;
    console.log('viewer connected');
    ws.on('message', (d) => {
      try { pushEvent(JSON.parse(d)); } catch (e) {}
    });
    ws.on('close', () => { console.log('viewer gone'); if (viewer === ws) viewer = null; });
    ws.on('error', () => {});
  } else {
    ws.close();
  }
});

server.listen(PORT, () => console.log('relay up on ' + PORT));
