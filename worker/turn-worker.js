// Cloudflare Worker — מנפיק פרטי TURN זמניים למשחק.
// להדביק ב-dash.cloudflare.com → Workers & Pages → Create Worker,
// ולהגדיר שני Secrets בהגדרות ה-Worker: CF_TURN_KEY_ID, CF_TURN_API_TOKEN.
const ALLOWED = [
  'https://yaniv.orenteam.com',
  'https://orenjonathan10-sketch.github.io',
];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/turn') return new Response('ok');
    if (url.searchParams.get('check')) {
      return Response.json({ configured: !!(env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) });
    }
    const origin = req.headers.get('Origin') || '';
    if (!ALLOWED.includes(origin)) return Response.json({ error: 'forbidden' }, { status: 403 });
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 43200 }),
      }
    );
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin },
    });
  },
};
