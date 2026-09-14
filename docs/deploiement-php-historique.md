# Déploiement sur le serveur Contao

L’application reste autonome : elle peut être déposée dans un sous-dossier du site Contao. Le backend PHP stocke les données partagées dans MariaDB. Le navigateur ne sert plus de base de données lorsque l’API est configurée.

1. Envoyer tout le dossier `carte-3d` sur le serveur.
2. Copier `api/config.example.php` vers `api/config.php`.
3. Renseigner dans `api/config.php` l’hôte MariaDB (`127.0.0.1` lorsque la base et Contao sont sur le même VPS), le port, la base, l’utilisateur et le mot de passe.
4. Générer un hash pour le mot de passe de connexion à l’application avec `password_hash`, puis le renseigner dans `admin_password_hash`. Utiliser un mot de passe différent de celui de MariaDB.
5. Vérifier que PHP possède l’extension `pdo_mysql` et que l’utilisateur MariaDB peut créer et modifier la table `gaubretrail_state`.
6. Vérifier que les règles `.htaccess` et `mod_rewrite` sont autorisées.
7. Ouvrir `/?admin=1`, puis se connecter avec l’identifiant configuré.

L’API conserve un numéro de révision et refuse d’écraser une modification plus récente. Les données publiques sont filtrées côté serveur : coordonnées privées, propriétaires et notes internes ne sont jamais renvoyés aux visiteurs.

La table `gaubretrail_state` est créée automatiquement au premier accès. Le moteur InnoDB et une transaction avec verrou de ligne empêchent deux organisateurs d’écraser simultanément leurs modifications. Pour revenir temporairement au stockage JSON, utilisez `storage => json` dans la configuration.

Si l’hébergement interdit la création automatique de tables, importer une fois `api/database.sql` depuis phpMyAdmin.


J'aimerais pousser mon application pour facilier le travaille de gestion des benevoles.
J'aimerais rajouter Dans Parcours et Terrain -> Parcours :
- Sur chaque parcours mettre l'heure de départ
- Sur chaque parcours mettre le temps qu'a mis le 1er concurrent à faire le parcours
- Mettre le temps du dernier participant
En fonction de ça, j'aimerais que l'app calcule automatiquement les horaires de présences des bénévoles sur le leur point sur le parcours.
Temps de début estimatif calculé :
Temps de fin estimatif calculé:
Tu penses que c'est faisable ? Je n'aurais plus ça a faire à la main
