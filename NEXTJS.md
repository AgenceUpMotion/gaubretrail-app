# Application Next.js — documentation mise à jour

L’application utilise Next.js avec l’App Router, une API Node.js et un annuaire React. Consultez [README.md](README.md) et [docs/architecture.md](docs/architecture.md).

## Développement

```bash
npm install
npm run dev
```

## Production

```bash
npm run build
```

Le build serveur est produit dans `.next/`. Démarrez-le avec `npm start`. `out/` n’est plus utilisé. Le script de build synchronise uniquement les ressources publiques nécessaires.

Les routes de `app/api/` remplacent PHP. Les anciens fichiers `api/*.php` sont conservés pour faciliter la transition et ne doivent pas être publiés par le serveur Node.js. Voir [DEPLOIEMENT.md](DEPLOIEMENT.md) pour la reprise des données et la configuration.
