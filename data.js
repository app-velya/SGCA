/**
 * Cloudflare Pages Function — API données Académie SGCA
 * Binding KV requis : SGCA_KV
 *
 * Actions POST JSON :
 * - register | login | getUser | listUsers | unlock | setUnlocks | saveProfile
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
  // Index des emails pour listUsers
  let idx = [];
  try {
    const raw = await kv.get('users:index');
    idx = raw ? JSON.parse(raw) : [];
  } catch (e) {
    idx = [];
  }
  if (!idx.includes(user.email)) {
    idx.push(user.email);
    await kv.put('users:index', JSON.stringify(idx));
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
      error: 'KV non configuré. Créez un namespace KV nommé SGCA_KV et liez-le au projet Pages (Settings → Functions → KV bindings / Liaisons).',
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
            earnings: 0,
            referrals: [],
            createdAt: new Date().toISOString(),
          };
          await putUser(kv, admin);
        }
      }

      const user = await getUser(kv, email);
      if (!user) return json({ ok: false, error: 'Compte introuvable' }, 404);
      if (user.pass !== pass) return json({ ok: false, error: 'Mot de passe incorrect' }, 401);
      const { pass: _, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    // —— GET USER ——
    if (action === 'getUser') {
      const email = (body.email || '').toLowerCase().trim();
      const user = await getUser(kv, email);
      if (!user) return json({ ok: false, error: 'Utilisateur introuvable' }, 404);
      const { pass, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    // —— LIST USERS (admin) ——
    if (action === 'listUsers') {
      const adminEmail = (body.adminEmail || '').toLowerCase().trim();
      const adminPass = body.adminPass || '';
      const admin = await getUser(kv, adminEmail);
      // Allow admin@sgca.tg with known pass even if not yet in KV
      const isAdminOk =
        (admin && admin.isAdmin && admin.pass === adminPass) ||
        (adminEmail === 'admin@sgca.tg' && adminPass === 'admin123');

      if (!isAdminOk) return json({ ok: false, error: 'Admin non autorisé' }, 403);

      // Ensure admin exists in KV
      if (!admin && adminEmail === 'admin@sgca.tg') {
        await putUser(kv, {
          name: 'Admin SGCA',
          email: 'admin@sgca.tg',
          pass: 'admin123',
          unlocks: [1, 2, 3],
          isAdmin: true,
          commercialCode: 'SGCA-ADMIN',
          earnings: 0,
          referrals: [],
          createdAt: new Date().toISOString(),
        });
      }

      let idx = [];
      try {
        const raw = await kv.get('users:index');
        idx = raw ? JSON.parse(raw) : [];
      } catch (e) {
        idx = [];
      }

      const users = [];
      for (const email of idx) {
        const u = await getUser(kv, email);
        if (!u) continue;
        const { pass, ...safe } = u;
        users.push(safe);
      }
      // Sort newest first
      users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return json({ ok: true, users, count: users.length });
    }

    // —— UNLOCK (admin) ——
    if (action === 'unlock' || action === 'setUnlocks') {
      const adminEmail = (body.adminEmail || '').toLowerCase().trim();
      const adminPass = body.adminPass || '';
      const targetEmail = (body.email || '').toLowerCase().trim();
      const modules = Array.isArray(body.modules) ? body.modules.map(Number) : [];

      const admin = await getUser(kv, adminEmail);
      const isAdminOk =
        (admin && admin.isAdmin && admin.pass === adminPass) ||
        (adminEmail === 'admin@sgca.tg' && adminPass === 'admin123');
      if (!isAdminOk) return json({ ok: false, error: 'Admin non autorisé' }, 403);

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

    // —— SAVE PROFILE ——
    if (action === 'saveProfile') {
      const email = (body.email || '').toLowerCase().trim();
      const user = await getUser(kv, email);
      if (!user) return json({ ok: false, error: 'Utilisateur introuvable' }, 404);
      if (body.name) user.name = body.name;
      if (body.quiz1 != null) user.quiz1 = body.quiz1;
      if (body.quiz2 != null) user.quiz2 = body.quiz2;
      if (body.quiz3 != null) user.quiz3 = body.quiz3;
      await putUser(kv, user);
      const { pass: _, ...safe } = user;
      return json({ ok: true, user: safe });
    }

    return json({ ok: false, error: 'Action inconnue: ' + action }, 400);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}
