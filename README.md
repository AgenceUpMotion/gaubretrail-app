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

## Architecture

Pour Render, utiliser le Blueprint [render.yaml](render.yaml) et suivre [docs/render.md](docs/render.md). Le stockage SQLite nécessite un service avec disque persistant.

Voir [docs/architecture.md](docs/architecture.md) pour les frontières entre React, règles métier, stockage et code historique, et [DEPLOIEMENT.md](DEPLOIEMENT.md) pour l’hébergement Node.js et la reprise des données.

Cette étape remplace le backend PHP et migre l’annuaire des bénévoles. L’accueil, les autres écrans d’administration et la carte restent fonctionnels via un adaptateur temporaire ; leur conversion React n’est pas encore terminée.
