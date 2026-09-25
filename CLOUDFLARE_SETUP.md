# Académie SGCA — Sauvegarde Cloudflare (données en ligne)

## Fichiers à uploader sur GitHub / Cloudflare Pages

```
index.html
gestion_crypto_actifs_module_1_complet_illustre.html
gestion_crypto_actifs_module_2_complet_illustre.html
gestion_crypto_actifs_module_3_complet_illustre.html
functions/api/data.js
```

## Étape 1 — Créer un namespace KV

1. [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Workers & Pages** → **KV**
3. **Create a namespace**
4. Nom : `SGCA_KV` (exactement)
5. Create

## Étape 2 — Lier le KV au projet Pages

1. Ouvrez votre projet **Pages** (celui qui héberge l’académie)
2. **Settings** → **Functions** → **KV namespace bindings**
3. **Add binding** :
   - Variable name : `SGCA_KV`
   - KV namespace : `SGCA_KV`
4. **Save**
5. **Redeploy** le site (Deployments → Retry deployment, ou un nouveau push GitHub)

## Étape 3 — Vérifier

1. Ouvrez le site en production
2. Inscrivez un compte test
3. Sur un **autre navigateur / téléphone**, connectez-vous avec le même email
4. Si le compte existe → la sauvegarde Cloudflare fonctionne

## Ce qui est sauvegardé en ligne

- Inscription / connexion
- Modules débloqués (admin)
- Code commercial
- Invités (referrals)
- Commission 5 $ au premier achat de l’invité

## Admin

- Email : `admin@sgca.tg`
- Mot de passe : `admin123`
- Menu Administration → Débloquer des cours  
  (le mot de passe admin est redemandé pour écrire dans le KV)

## Sans KV

Le site fonctionne quand même en **localStorage** (un seul appareil).  
Dès que le KV est lié, les données passent en multi-appareils automatiquement.
