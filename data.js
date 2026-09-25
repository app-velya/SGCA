/**
 * Cloudflare Pages Function — API données Académie SGCA
 * Binding KV requis : SGCA_KV (créer dans le dashboard Cloudflare)
 *
 * Actions POST JSON : { action, ... }
 * - register | login | getUser | unlock | setUnlocks | saveProfile
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

function genCode(email) {
  const base = (email.split('@')[0] || 'SGCA').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'SGCA-' + base + rnd;
}

async function getUser(kv, email) {
  const raw = await kv.get('user:' + email);
  return raw ? JSON.parse(raw) : null;
}

async function putUser(kv, user) {
  await kv.put('user:' + user.email, JSON.stringify(user));
  if (user.commercialCode) {
    await kv.put('code:' + user.commercialCode.toUpperCase(), user.email);
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  const kv = env.SGCA_KV;
  if (!kv) {
    return json({
      ok: false,
      error: 'KV non configuré. Créez un namespace KV nommé SGCA_KV et liez-le au projet Pages (Settings → Functions → KV bindings).',
    }, 503);
  }

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      if (!email) return json({ ok: false, error: 'email requis' }, 400);
      const user = await getUser(kv, email);
      if (!user) return json({ ok: false, error: 'Utilisateur introuvable' }, 404);
      const { pass, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Méthode non autorisée' }, 405);
    }

    const body = await request.json();
    const action = body.action;

    // —— REGISTER ——
    if (action === 'register') {
      const email = (body.email || '').toLowerCase().trim();
      const name = (body.name || '').trim();
      const pass = body.pass || '';
      const refCode = (body.refCode || '').toUpperCase().trim();

      if (!email || !pass || !name) return json({ ok: false, error: 'Nom, email et mot de passe requis' }, 400);
      if (pass.length < 6) return json({ ok: false, error: 'Mot de passe trop court (min. 6)' }, 400);

      const existing = await getUser(kv, email);
      if (existing) return json({ ok: false, error: 'Cet email est déjà inscrit' }, 409);

      let referredBy = null;
      if (refCode) {
        const sponsorEmail = await kv.get('code:' + refCode);
        if (sponsorEmail) referredBy = sponsorEmail;
      }

      const commercialCode = genCode(email);
      const user = {
        name,
        email,
        pass,
        unlocks: [],
        isAdmin: email === 'admin@sgca.tg',
        commercialCode,
        referredBy,
        earnings: 0,
        referrals: [],
        createdAt: new Date().toISOString(),
      };

      await putUser(kv, user);

      if (referredBy) {
        const sponsor = await getUser(kv, referredBy);
        if (sponsor) {
          sponsor.referrals = sponsor.referrals || [];
          if (!sponsor.referrals.includes(email)) sponsor.referrals.push(email);
          await putUser(kv, sponsor);
        }
      }

      const { pass: _, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    // —— LOGIN ——
    if (action === 'login') {
      const email = (body.email || '').toLowerCase().trim();
      const pass = body.pass || '';

      // Seed admin if missing
      if (email === 'admin@sgca.tg') {
        let admin = await getUser(kv, email);
        if (!admin) {
          admin = {
            name: 'Admin SGCA',
            email: 'admin@sgca.tg',
            pass: 'admin123',
            unlocks: [1, 2, 3],
            isAdmin: true,
            commercialCode: 'SGCA-ADMIN',
            referredBy: null,
            earnings: 0,
            referrals: [],
            createdAt: new Date().toISOString(),
          };
          await putUser(kv, admin);
        }
      }

      const user = await getUser(kv, email);
      if (!user || user.pass !== pass) return json({ ok: false, error: 'Email ou mot de passe incorrect' }, 401);

      if (!user.commercialCode) {
        user.commercialCode = genCode(email);
        user.earnings = user.earnings || 0;
        user.referrals = user.referrals || [];
        await putUser(kv, user);
      }

      const { pass: _, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    // —— GET USER ——
    if (action === 'getUser') {
      const email = (body.email || '').toLowerCase().trim();
      if (!email) return json({ ok: false, error: 'email requis' }, 400);
      const user = await getUser(kv, email);
      if (!user) return json({ ok: false, error: 'Introuvable' }, 404);
      const { pass: _, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    // —— UNLOCK (admin) ——
    if (action === 'unlock') {
      const adminEmail = (body.adminEmail || '').toLowerCase().trim();
      const adminPass = body.adminPass || '';
      const targetEmail = (body.email || '').toLowerCase().trim();
      const modules = Array.isArray(body.modules) ? body.modules.map(Number) : [];

      const admin = await getUser(kv, adminEmail);
      if (!admin || !admin.isAdmin || admin.pass !== adminPass) {
        return json({ ok: false, error: 'Admin non autorisé' }, 403);
      }

      const user = await getUser(kv, targetEmail);
      if (!user) return json({ ok: false, error: 'Apprenant introuvable' }, 404);

      const prev = user.unlocks || [];
      const isFirstPurchase = prev.length === 0 && modules.length > 0;
      user.unlocks = [...new Set([...prev, ...modules])];

      let commission = null;
      if (isFirstPurchase && user.referredBy) {
        const sponsor = await getUser(kv, user.referredBy);
        if (sponsor) {
          sponsor.earnings = (sponsor.earnings || 0) + 5;
          await putUser(kv, sponsor);
          commission = { email: sponsor.email, earnings: sponsor.earnings, amount: 5 };
        }
      }

      await putUser(kv, user);
      const { pass: _, ...safe } = user;
      return json({ ok: true, user: safe, commission });
    }

    // —— SAVE PROFILE (earnings sync etc.) ——
    if (action === 'saveProfile') {
      const email = (body.email || '').toLowerCase().trim();
      const user = await getUser(kv, email);
      if (!user) return json({ ok: false, error: 'Introuvable' }, 404);
      if (body.unlocks) user.unlocks = body.unlocks;
      if (typeof body.earnings === 'number') user.earnings = body.earnings;
      if (body.referrals) user.referrals = body.referrals;
      await putUser(kv, user);
      const { pass: _, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    return json({ ok: false, error: 'Action inconnue: ' + action }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}
