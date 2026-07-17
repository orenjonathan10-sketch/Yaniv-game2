// שרת איתות PeerJS למשחק — רץ על Render או כל מארח Node אחר.
// הלקוח מתחבר ל-/ps (ראו peerOpts ב-game.js).
const { PeerServer } = require('peer');

const port = Number(process.env.PORT) || 9000;

PeerServer({
  host: '0.0.0.0',
  port,
  path: '/ps',
  proxied: true, // מאחורי ה-proxy של Render
  allow_discovery: false,
  corsOptions: { origin: true },
});

console.log('PeerJS signaling server on :' + port + '/ps');
