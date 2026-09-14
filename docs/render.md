# Hébergement sur Render

Le fichier `render.yaml` configure un **Web Service Node.js**, plan Starter, en région Frankfurt, avec un disque persistant de 1 Go à `/var/data`. Cette configuration est payante ; aucun service n’est créé par le simple ajout du fichier au dépôt.

SQLite nécessite ce disque : sans lui, les données sont perdues après redéploiement ou redémarrage. Ne pas choisir Static Site ni une instance gratuite pour cette configuration. Voir les [disques persistants Render](https://render.com/docs/disks).

## Depuis GitHub ou GitLab

1. Pousser ce dépôt vers GitHub/GitLab, idéalement privé.
2. Dans Render, créer un Blueprint depuis ce dépôt et vérifier les ressources et coûts annoncés.
3. Renseigner les deux valeurs demandées :
   - `GAUBRE_ADMIN_PASSWORD_HASH` : copier uniquement la valeur de cette variable depuis le fichier local `.env.local`. Le mot de passe correspondant est celui généré par `npm run setup`. Ne jamais committer ce fichier ni le mot de passe.
   - `GAUBRE_APP_ORIGIN` : l’origine HTTPS exacte du service, sans slash final, par exemple `https://gaubretrail-xxxx.onrender.com`. Si Render ne donne l’adresse définitive qu’après création, corriger cette variable dans Environment avant de se connecter. Une valeur incorrecte bloque les requêtes de connexion et d’écriture.
4. Déployer. La construction lance `npm ci --include=dev`, les tests, puis le build. Le service démarre avec `npm start -- --hostname 0.0.0.0` ; Next.js utilise le port fourni par Render.
5. Ouvrir `/?admin=1` et se connecter avec l’identifiant `organisation` et le mot de passe correspondant au hash configuré.
6. Restaurer l’export **privé** de l’ancienne application depuis Sauvegardes. Les données locales, fichiers Excel, imports et bases existantes ne sont pas envoyés dans Git.

Ne pas exécuter `npm run setup` sur Render : les variables sont configurées dans le service. Le disque n’est accessible qu’à l’exécution, pas pendant la construction. La base est initialisée au premier accès API, puis conservée sur le disque.

Avec un domaine personnalisé, mettre à jour `GAUBRE_APP_ORIGIN` pour utiliser exclusivement l’origine choisie. Conserver une seule instance applicative avec SQLite. Les sauvegardes métier restent nécessaires ; voir [la procédure de déploiement](../DEPLOIEMENT.md).

Les ressources générées de `public/` sont recréées au build et ne sont pas versionnées. Le dossier `data/` contient les ressources nécessaires aux parcours et le jeu initial ; toute reprise de données privées se fait séparément.
