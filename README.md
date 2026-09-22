# Gaubre’Trail

Application d’organisation du trail : bénévoles, affectations, parcours, terrain et matériel.

## Démarrer

Node.js 24.15 ou supérieur dans la branche 24.x, puis :

```sh
npm ci
npm run setup
npm run dev
```

`setup` crée `.env.local`, génère un mot de passe organisateur et l’affiche une seule fois. Conservez-le dans votre gestionnaire de mots de passe. Le script refuse d’écraser une configuration existante.

Accès public : `http://localhost:3000/`. Connexion organisateur : `http://localhost:3000/?admin=1`.

Le développement utilise la même API Node.js que la production. Une panne du serveur ne donne jamais accès à une administration locale de remplacement. Les anciennes données du navigateur ne sont pas effacées : exportez-les depuis l’ancienne version avant de les restaurer dans la nouvelle.

## Vérifier

```sh
npm test
npm run build
npm run test:http
npm start
```

## Supabase

L’application peut utiliser Supabase sans changer son API ni exposer la base au navigateur. Créez un projet Supabase, exécutez la migration `supabase/migrations/20260921000000_gaubretrail_state.sql` dans le SQL Editor, puis ajoutez les variables suivantes dans `.env.local` et sur l’hébergeur :

```sh
GAUBRE_STORAGE_DRIVER=supabase
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_SECRET_KEY=votre-cle-secret
```

Au premier démarrage, l’état initial de `data/organization.json` est inséré sans écraser une base déjà initialisée. Pour migrer une sauvegarde existante, configurez Supabase puis lancez `npm run import:state -- chemin/vers/sauvegarde-privee.json`. La clé `SUPABASE_SECRET_KEY` est strictement serveur : ne la placez jamais dans une variable `NEXT_PUBLIC_*` ni dans un fichier versionné. L’ancien nom `SUPABASE_SERVICE_ROLE_KEY` reste accepté temporairement pour les projets utilisant les clés historiques.

Si le mot de passe organisateur est perdu, exécutez `npm run reset:password`. La commande remplace uniquement son hash dans `.env.local`, invalide les sessions existantes et affiche le nouveau mot de passe une seule fois.

Pour corriger des caractères mal encodés après un ancien import (par exemple `PrÃ©sence`), exécutez `npm run repair:encoding`. La commande ne modifie que les textes concernés et conserve l’état précédent avant sauvegarde.

## Architecture

Pour Render, utiliser le Blueprint [render.yaml](render.yaml) et suivre [docs/render.md](docs/render.md). Le stockage SQLite nécessite un service avec disque persistant.

Voir [docs/architecture.md](docs/architecture.md) pour les frontières entre React, règles métier, stockage et code historique, et [DEPLOIEMENT.md](DEPLOIEMENT.md) pour l’hébergement Node.js et la reprise des données.

Cette étape remplace le backend PHP et migre l’annuaire des bénévoles. L’accueil, les autres écrans d’administration et la carte restent fonctionnels via un adaptateur temporaire ; leur conversion React n’est pas encore terminée.
