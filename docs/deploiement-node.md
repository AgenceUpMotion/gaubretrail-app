# Déployer sur Node.js

## Cible

Une instance de l’application sur un serveur Node.js 24.15+ (branche 24.x), avec HTTPS et un disque persistant. PHP et Contao ne sont plus nécessaires à l’exécution de cette application. Contao peut rester sur son hébergement indépendamment.

Cette version utilise SQLite. Ne pas la déployer sur un disque éphémère ni lancer plusieurs serveurs avec des bases locales différentes. Une migration de l’adaptateur vers une base partagée serait nécessaire pour ce type d’hébergement.

## Configuration

1. Installer le projet et exécuter `npm ci`.
2. Exécuter `npm run setup` une seule fois. Conserver le mot de passe affiché dans un gestionnaire de mots de passe. Le script crée `.env.local` sans écraser une configuration existante.
3. Renseigner `GAUBRE_APP_ORIGIN` avec l’origine HTTPS exacte, sans slash final, par exemple `https://benevoles.exemple.fr`.
4. Renseigner `GAUBRE_DATABASE_PATH` avec le chemin du volume persistant, par exemple `/var/lib/gaubretrail/gaubretrail.sqlite`. Le processus Node doit pouvoir écrire dans son dossier. Ne jamais placer cette base sous `public/`.
5. Exécuter `npm test`, puis `npm run build`.
6. Démarrer `npm start` sous un gestionnaire de processus, derrière un reverse proxy HTTPS. Le proxy doit limiter la taille des requêtes et ne transmettre que le trafic destiné à cette application. Le service Node ne doit pas être exposé directement à Internet.

Le build est dans `.next/`, les ressources publiques dans `public/`. Le dossier `data/organization.json` reste une source privée d’initialisation requise par le serveur ; il ne doit pas être servi comme fichier public. Le projet peut être installé sur le serveur par un checkout et `npm ci`, puis construit sur place.

Le serveur web relaie toutes les requêtes applicatives à Next.js. Il ne doit pas servir la racine du dépôt comme un répertoire statique. Ne pas publier `.env.local`, `.storage/`, `api/config.php`, `api/storage/`, `imports/` ni les fichiers Excel. L’ancien dossier `out/` n’est plus un livrable de cette application.

## Reprendre les données existantes

La nouvelle application n’accède pas automatiquement à l’ancienne base MariaDB ni au stockage des navigateurs. Conserver l’ancienne application jusqu’à la validation de la reprise.

Si la nouvelle application est ouverte dans le même navigateur à la même adresse que l’ancienne version locale, la vue Sauvegardes propose « Exporter les anciennes données de ce navigateur ». Ce bouton télécharge une copie sans effacer le stockage ni modifier le serveur. Restaurer ensuite explicitement ce fichier. Le navigateur ne peut pas accéder aux données d’une autre adresse ou d’un autre profil.

1. Depuis l’ancienne administration, exporter les **données privées d’organisation** dans Sauvegardes. Cet export contient les éditions, bénévoles, affectations, traces importées et opérations terrain. Ne pas utiliser un export public, qui a déjà supprimé les données privées.
2. Copier ce fichier dans un dossier privé du nouveau serveur.
3. Sur une base nouvelle, importer avec :

```sh
npm run import:state -- /chemin/prive/gaubretrail-prive.json
```

Le script accepte l’export v3, les anciennes sauvegardes v1/v2 et un document `{revision, state}`. Il valide les relations et refuse de remplacer une base déjà modifiée. Il ne modifie pas le fichier source. Si la base a déjà servi, utiliser la restauration depuis l’administration : elle télécharge une sauvegarde avant remplacement.

4. Se connecter à `/?admin=1` avec le nouveau compte. Les anciens mots de passe PHP et cookies ne sont pas repris.
5. Comparer les nombres de bénévoles, postes et affectations, les éditions, les traces et le balisage avec l’ancienne application. Vérifier les missions publiques, en particulier l’autorisation de publication des bénévoles conservée depuis PHP.
6. Effectuer une modification puis recharger ; vérifier également depuis un second navigateur. Basculer l’adresse publique seulement après ces contrôles.

## Sauvegardes et retour arrière

SQLite conserve une copie du document métier précédent dans `previous_state` à chaque sauvegarde réussie. Ce mécanisme ne remplace pas les sauvegardes externes. Exporter régulièrement les données privées depuis l’administration et sauvegarder la configuration séparément.

Pour une sauvegarde du fichier SQLite, arrêter l’application avant de copier le dossier de stockage, ou utiliser un outil de sauvegarde SQLite compatible WAL. Ne pas copier uniquement le fichier principal pendant que le serveur écrit : le journal WAL peut contenir des modifications récentes.

Pour revenir à PHP, conserver l’ancienne installation et sa base. Les exports métier v3 restent compatibles, mais arrêter d’abord les écritures sur l’application active et restaurer explicitement le dernier export privé dans l’application choisie. Ne jamais laisser deux applications écrire dans deux bases en supposant qu’elles se synchronisent.

Les anciennes instructions PHP sont archivées dans `docs/deploiement-php-historique.md`.
