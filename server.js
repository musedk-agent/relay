const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8080;
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
    // Agent long-polls for input events
    lastAgentHttp = Date.now();
    if (pendingEvents.length > 0) {
      const evs = pendingEvents.splice(0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(evs));
    } else {
      // hold up to 25s
      const to = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }, 25000);
      pendingPolls.push({ res, to });
      req.on('close', () => {
        clearTimeout(to);
        const i = pendingPolls.findIndex((p) => p.res === res);
        if (i >= 0) pendingPolls.splice(i, 1);
      });
    }
  } else {
    res.writeHead(404); res.end('nope');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
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
