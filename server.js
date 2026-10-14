const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8080;
let agent = null;
let viewer = null;

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
      viewer: !!viewer,
      time: new Date().toISOString()
    }));
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
      if (agent && agent.readyState === WebSocket.OPEN) agent.send(d);
    });
    ws.on('close', () => { console.log('viewer gone'); if (viewer === ws) viewer = null; });
    ws.on('error', () => {});
  } else {
    ws.close();
  }
});

server.listen(PORT, () => console.log('relay up on ' + PORT));
