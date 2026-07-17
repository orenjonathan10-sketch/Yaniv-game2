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

// פרטי ICE (STUN+TURN) זמניים — הלקוח מושך אותם לפני כל התחברות.
// מוגבל למקורות של המשחק בלבד, כדי שאיש לא ינצל את מכסת הממסר.
const ALLOWED_ORIGINS = [
  'https://yaniv.orenteam.com',
  'https://orenjonathan10-sketch.github.io',
];

app.get('/turn', async (req, res) => {
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (req.query.check) return res.json({ configured: !!(keyId && token) });
  const origin = req.get('origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'forbidden' });
  res.set('Access-Control-Allow-Origin', origin);
  if (!keyId || !token) return res.status(503).json({ error: 'not-configured' });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 43200 }), // תוקף 12 שעות
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: 'turn-upstream' });
  }
});

server.listen(port, '0.0.0.0', () => console.log('PeerJS signaling server on :' + port + '/ps'));
