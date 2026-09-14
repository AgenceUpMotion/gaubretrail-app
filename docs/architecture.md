# Architecture et migration React

## Décision

React gère l’interface ; Next.js fournit l’exécution Node.js et les routes HTTP. Le backend PHP n’est plus appelé. SQLite conserve le document métier v3 afin de reprendre les exports existants sans modifier simultanément tout le modèle de données.

Cette version cible une instance Next.js sur un serveur disposant d’un disque persistant. Elle ne cible pas un système serverless à disque éphémère ni plusieurs serveurs avec chacun leur base locale. Si ce besoin apparaît, remplacer l’adaptateur de stockage par une base partagée avant de multiplier les instances.

## Organisation

| Répertoire / module | Responsabilité |
| --- | --- |
| `app/` | Routes et composition Next.js ; `app/api/[...path]/route.js` est uniquement l’entrée HTTP |
| `features/volunteers/` | Annuaire React, formulaire, import/export et sélecteurs métier du premier écran migré |
| `components/ui/` | Composants React partagés : fenêtre modale, icônes d’action |
| `lib/repository.mjs` | Accès HTTP du navigateur, révision et session |
| `lib/state-store.mjs` | Snapshot observable partagé entre React et les écrans historiques |
| `server/api.mjs` | Autorisation, contrats des routes, erreurs JSON et limites de requêtes |
| `server/state-storage.mjs` | Transactions SQLite, état précédent, sessions et limite de connexion |
| `server/passwords.mjs` | Hachage et vérification des mots de passe |
| `server/public-state.mjs` | Projection publique respectant les autorisations de publication de l’ancienne API PHP |
| `domain.js`, `contacts.js` | Règles métier et conversion de données réutilisées ; pas de DOM |
| `organization.js`, `management.js`, `portal.js` | Interface historique restant à migrer |
| `app.js`, `map-host.js`, `landscape.js` | Carte et intégration MapLibre / Three.js |
| `tests/` | Tests des invariants et des frontières de migration |

`repository.js` à la racine est uniquement une réexportation de compatibilité. Toute nouvelle fonctionnalité importe les modules de `lib/` directement.

## Circulation des données

1. Le repository charge la session et le snapshot de l’API.
2. Les composants lisent le snapshot avec `useSyncExternalStore`.
3. Une modification construit un nouveau document sans modifier le snapshot existant.
4. Le repository transmet le document et sa révision dans `If-Match`.
5. Le serveur valide les mêmes règles métier et sauvegarde dans une transaction SQLite.
6. Le snapshot est publié après succès. Le raccord temporaire actualise aussi les vues historiques et la carte.

Une erreur de sauvegarde conserve le dernier snapshot confirmé. Deux écritures locales simultanées sont refusées. Deux organisateurs sur une même révision ne peuvent pas s’écraser : le second reçoit une erreur 409 et doit recharger. Les formulaires et aperçus d’import React refusent aussi d’appliquer un brouillon construit sur un snapshot devenu obsolète.

## Frontière React / historique

`mount.jsx` est un adaptateur temporaire. Le code historique possède le conteneur `orgContent` ; React possède exclusivement ses enfants lorsque l’annuaire est actif. Avant d’afficher une autre vue, le code historique démonte cette racine React. Un changement d’édition recrée le composant pour réinitialiser ses filtres et fermer les brouillons de l’édition précédente.

Le bootstrap principal appelle maintenant `startPortal` explicitement. Il ne dépend plus d’un effet de bord lors de l’import ni d’un indicateur global `window`. Un démarrage est partagé par conteneur lors du rejeu des effets de Strict Mode.

La durée de vie complète de la carte et des autres écrans historiques n’est pas encore gérée par React. Tant que cette migration reste ouverte, conserver une seule route applicative et éviter de remonter l’ensemble du shell à chaque navigation. Le démontage complet des listeners et objets de carte appartient à la prochaine étape de l’adaptateur cartographique.

## Contrat API conservé

| Route | Accès / résultat |
| --- | --- |
| `GET /api/session` | Disponibilité, état de connexion, configuration, capacités |
| `POST /api/login` | Identifiant + mot de passe ; cookie HttpOnly, SameSite=Strict, Secure en production |
| `POST /api/logout` | Révocation de la session |
| `GET /api/public` | Projection publique, sans coordonnées privées, notes, propriétaires ou conversations |
| `GET /api/state` | Document complet et révision ; connexion obligatoire |
| `PUT /api/state` | Validation et sauvegarde ; connexion, origine autorisée et révision obligatoires |

Le serveur expose uniquement la capacité `state`, comme l’ancienne API PHP. La gestion de plusieurs comptes, les candidatures et la messagerie ne sont pas implémentées par cette étape et restent masquées. Les sessions durent 12 heures ; changer le hash ou l’identifiant configuré les invalide.

La publication exige un bénévole actif ayant autorisé la visibilité de ses missions et un poste public. Le formulaire React rend cette autorisation explicite. Les fichiers privés d’initialisation ne sont plus copiés dans `public/`.

## Prochaines migrations

1. Affectations et postes : déplacer leurs sélecteurs hors de `organization.js`, conserver calculs de couverture, chevauchements et horaires.
2. Accueil / connexion et navigation : remplacer la lecture de `index.html` et le shell historique par la composition React.
3. Parcours, logistique et propriétaires : composants par fonctionnalité, formulaires réutilisables et même repository.
4. Carte : composant à référence de conteneur, initialisation explicite, `map.remove()` et nettoyage des événements au démontage.
5. Retirer les fonctions historiques devenues inutiles et les CSS associés, après vérification des usages depuis les autres écrans.

Pour chaque écran, conserver les fonctionnalités existantes, tester les relations métier et le passage vers les écrans voisins, puis retirer son ancien rendu. Ne pas créer un second stockage ni faire manipuler les enfants d’un composant React par `innerHTML`.
