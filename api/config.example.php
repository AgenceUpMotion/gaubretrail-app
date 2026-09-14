<?php
// Copier ce fichier vers config.php sur le serveur, hors gestion de versions.
// Générer le hash avec : php -r "echo password_hash('VOTRE_MOT_DE_PASSE', PASSWORD_DEFAULT), PHP_EOL;"
return [
    'admin_username' => 'organisation',
    'admin_name' => 'Organisation GaubreTrail',
    'admin_password_hash' => '$2y$10$REMPLACER_PAR_UN_HASH_PASSWORD_HASH',
    'storage' => 'mariadb',
    'database' => [
        // Sur le même VPS que Contao, la valeur est généralement 127.0.0.1.
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'NOM_DE_LA_BASE',
        'username' => 'UTILISATEUR_DE_LA_BASE',
        'password' => 'MOT_DE_PASSE_DE_LA_BASE',
        'table' => 'gaubretrail_state',
    ],
];
