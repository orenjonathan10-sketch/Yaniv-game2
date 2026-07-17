// שרת איתות PeerJS + הנפקת פרטי TURN זמניים של Cloudflare Realtime.
// המפתח הסודי של Cloudflare נשאר כאן בצד השרת (משתני סביבה ב-Render).
const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');

const port = Number(process.env.PORT) || 9000;
const app = express();
const server = http.createServer(app);

app.use('/ps', ExpressPeerServer(server, {
  proxied: true, // מאחורי ה-proxy של Render
  allow_discovery: false,
  corsOptions: { origin: true },
}));

app.get('/', (req, res) => res.send('ok'));

// פרטי ICE (STUN+TURN) זמניים — הלקוח מושך אותם לפני כל התחברות
app.get('/turn', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !token) return res.status(503).json({ error: 'not-configured' });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: 'turn-upstream' });
  }
});

server.listen(port, '0.0.0.0', () => console.log('PeerJS signaling server on :' + port + '/ps'));
