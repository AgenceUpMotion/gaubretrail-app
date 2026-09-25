<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header("Referrer-Policy: same-origin");

session_name('gaubretrail_admin');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

function output_json(int $status, array $data): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body_json(): array {
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > 12 * 1024 * 1024) output_json(413, ['error' => 'Données trop volumineuses.']);
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data)) output_json(400, ['error' => 'Corps JSON invalide.']);
    return $data;
}

function require_admin(): void {
    if (empty($_SESSION['gaubretrail_admin'])) output_json(401, ['error' => 'Connexion administrateur nécessaire.']);
}

function verify_admin_password(string $password, string $stored): bool {
    if (strpos($stored, 'pbkdf2_sha256$') === 0) {
        $parts = explode('$', $stored);
        if (count($parts) !== 4 || !ctype_digit($parts[1])) return false;
        $salt = ctype_xdigit($parts[2]) && strlen($parts[2]) % 2 === 0 ? hex2bin($parts[2]) : false;
        if ($salt === false) return false;
        $calculated = hash_pbkdf2('sha256', $password, $salt, (int)$parts[1], 64, false);
        return hash_equals($parts[3], $calculated);
    }
    return password_verify($password, $stored);
}

function data_path(string $name): string {
    $directory = __DIR__ . DIRECTORY_SEPARATOR . 'storage';
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
        output_json(500, ['error' => 'Le dossier de stockage ne peut pas être créé.']);
    }
    return $directory . DIRECTORY_SEPARATOR . $name . '.json';
}

function uses_mariadb(): bool {
    global $config;
    return ($config['storage'] ?? 'json') === 'mariadb';
}

function seed_state(): array {
    $seedPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'organization.json';
    $seed = json_decode((string)file_get_contents($seedPath), true);
    if (!is_array($seed)) output_json(500, ['error' => 'Données initiales invalides.']);
    return $seed;
}

function database_table(): string {
    global $config;
    $table = (string)($config['database']['table'] ?? 'gaubretrail_state');
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) output_json(500, ['error' => 'Nom de table MariaDB invalide.']);
    return '`' . $table . '`';
}

function database(): PDO {
    global $config;
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $db = $config['database'] ?? [];
    try {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'] ?? '127.0.0.1', (int)($db['port'] ?? 3306), $db['name'] ?? '');
        $pdo = new PDO($dsn, (string)($db['username'] ?? ''), (string)($db['password'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec('CREATE TABLE IF NOT EXISTS ' . database_table() . ' (id TINYINT UNSIGNED NOT NULL PRIMARY KEY, revision BIGINT UNSIGNED NOT NULL, payload LONGTEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        return $pdo;
    } catch (Throwable $error) {
        error_log('GaubreTrail MariaDB: ' . $error->getMessage());
        output_json(500, ['error' => 'Connexion au stockage MariaDB impossible. Vérifiez api/config.php et l’extension PDO MySQL.']);
    }
}

function read_document(): array {
    if (uses_mariadb()) {
        $pdo = database();
        $row = $pdo->query('SELECT revision, payload FROM ' . database_table() . ' WHERE id = 1')->fetch();
        if (!$row) {
            $insert = $pdo->prepare('INSERT IGNORE INTO ' . database_table() . ' (id, revision, payload) VALUES (1, 1, ?)');
            $insert->execute([json_encode(seed_state(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
            $row = $pdo->query('SELECT revision, payload FROM ' . database_table() . ' WHERE id = 1')->fetch();
        }
        $state = json_decode((string)($row['payload'] ?? ''), true);
        if (!is_array($state)) output_json(500, ['error' => 'Données MariaDB invalides.']);
        return ['revision' => (int)$row['revision'], 'state' => $state];
    }
    $path = data_path('state');
    if (!is_file($path)) {
        write_document(['revision' => 1, 'state' => seed_state()]);
    }
    $handle = fopen($path, 'rb');
    if (!$handle) output_json(500, ['error' => 'Lecture des données impossible.']);
    flock($handle, LOCK_SH);
    $data = json_decode((string)stream_get_contents($handle), true);
    flock($handle, LOCK_UN);
    fclose($handle);
    if (!is_array($data) || !isset($data['revision'], $data['state'])) output_json(500, ['error' => 'Stockage serveur invalide.']);
    return $data;
}

function write_document(array $document): void {
    if (uses_mariadb()) {
        $statement = database()->prepare('INSERT INTO ' . database_table() . ' (id, revision, payload) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE revision = VALUES(revision), payload = VALUES(payload)');
        $statement->execute([(int)$document['revision'], json_encode($document['state'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        return;
    }
    $path = data_path('state');
    $temporary = $path . '.tmp-' . bin2hex(random_bytes(6));
    $json = json_encode($document, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($temporary, $json, LOCK_EX) === false || !rename($temporary, $path)) {
        @unlink($temporary);
        output_json(500, ['error' => 'Enregistrement serveur impossible.']);
    }
}

function update_document(int $expectedRevision, array $state): array {
    if (uses_mariadb()) {
        $pdo = database();
        try {
            $pdo->beginTransaction();
            $row = $pdo->query('SELECT revision FROM ' . database_table() . ' WHERE id = 1 FOR UPDATE')->fetch();
            if (!$row) {
                $insert = $pdo->prepare('INSERT INTO ' . database_table() . ' (id, revision, payload) VALUES (1, 1, ?)');
                $insert->execute([json_encode(seed_state(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
                $row = ['revision' => 1];
            }
            if ($expectedRevision !== (int)$row['revision']) {
                $pdo->rollBack();
                output_json(409, ['error' => 'Les données ont été modifiées ailleurs. Rechargez avant de réessayer.']);
            }
            $next = ['revision' => (int)$row['revision'] + 1, 'state' => $state];
            $update = $pdo->prepare('UPDATE ' . database_table() . ' SET revision = ?, payload = ? WHERE id = 1');
            $update->execute([$next['revision'], json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
            $pdo->commit();
            return $next;
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('GaubreTrail MariaDB update: ' . $error->getMessage());
            output_json(500, ['error' => 'Enregistrement dans MariaDB impossible.']);
        }
    }
    $lock = fopen(data_path('state-lock'), 'c');
    if (!$lock || !flock($lock, LOCK_EX)) output_json(500, ['error' => 'Verrouillage des données impossible.']);
    $document = read_document();
    if ($expectedRevision !== (int)$document['revision']) {
        flock($lock, LOCK_UN); fclose($lock);
        output_json(409, ['error' => 'Les données ont été modifiées ailleurs. Rechargez avant de réessayer.']);
    }
    $next = ['revision' => (int)$document['revision'] + 1, 'state' => $state];
    write_document($next);
    flock($lock, LOCK_UN); fclose($lock);
    return $next;
}

function pick(array $row, array $keys): array {
    $result = [];
    foreach ($keys as $key) if (array_key_exists($key, $row)) $result[$key] = $row[$key];
    return $result;
}

function public_state(array $state): array {
    $visibleVolunteers = array_values(array_filter($state['volunteers'] ?? [], fn($v) => !empty($v['active']) && !empty($v['publicVisible'])));
    $volunteerIds = array_fill_keys(array_column($visibleVolunteers, 'id'), true);
    $visiblePosts = array_values(array_filter($state['posts'] ?? [], fn($p) => !empty($p['publicVisible'])));
    $postIds = array_fill_keys(array_column($visiblePosts, 'id'), true);
    $types = $state['providerTypes'] ?? [];
    $photoTypeIds = [];
    foreach ($types as $type) if (stripos((string)($type['id'] ?? '') . ' ' . (string)($type['name'] ?? ''), 'photo') !== false) $photoTypeIds[$type['id']] = true;
    $providers = array_values(array_filter($state['providers'] ?? [], fn($p) => isset($photoTypeIds[$p['typeId'] ?? '']) && is_numeric($p['lat'] ?? null) && is_numeric($p['lng'] ?? null)));
    return [
        'schemaVersion' => 3,
        'editions' => array_map(fn($r) => pick($r, ['id','season','year','name','date','site','lat','lng']), $state['editions'] ?? []),
        'courses' => array_map(fn($r) => pick($r, ['id','editionId','name','distance','gain','loss','departureTime','firstDuration','lastDuration','intermediateTimes','volunteerLeadMinutes','volunteerTailMinutes','color','visible','source','geojson']), $state['courses'] ?? []),
        'volunteers' => array_map(fn($r) => pick($r, ['id','firstName','lastName','editionIds','active','publicVisible']), $visibleVolunteers),
        'assignments' => array_values(array_map(fn($r) => pick($r, ['id','volunteerId','postId','editionId','date','endDate','start','end','instructions']), array_filter($state['assignments'] ?? [], fn($r) => isset($volunteerIds[$r['volunteerId'] ?? ''], $postIds[$r['postId'] ?? ''])))),
        'posts' => array_map(fn($r) => pick($r, ['id','editionId','number','name','lat','lng','instructions','courseIds','publicVisible']), $visiblePosts),
        'aidStations' => array_values(array_map(fn($r) => pick($r, ['id','editionId','number','name','lat','lng','courseIds','km','information','start','end','visible']), array_filter($state['aidStations'] ?? [], fn($r) => !empty($r['visible'])))),
        'mapElements' => array_values(array_map(fn($r) => pick($r, ['id','editionId','name','kind','lat','lng','courseIds','visible']), array_filter($state['mapElements'] ?? [], fn($r) => !empty($r['visible'])))),
        'providerTypes' => array_map(fn($r) => pick($r, ['id','name']), $types),
        'providers' => array_map(fn($r) => pick($r, ['id','company','typeId','lat','lng']), $providers),
        'owners' => [], 'parcels' => [], 'equipment' => [], 'equipmentTypes' => [], 'messages' => [],
        'settings' => is_array($state['settings']['branding'] ?? null) ? ['branding' => pick($state['settings']['branding'], ['primaryColor','secondaryColor','logo'])] : new stdClass(),
    ];
}

$configFile = __DIR__ . DIRECTORY_SEPARATOR . 'config.php';
$configured = is_file($configFile);
$config = $configured ? require $configFile : [];
$path = trim((string)parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
$position = strpos($path, 'api/');
$route = $position === false ? '' : substr($path, $position + 4);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($route === 'session' && $method === 'GET') {
    output_json(200, ['available' => $configured, 'admin' => $configured && !empty($_SESSION['gaubretrail_admin']), 'capabilities' => ['state'], 'user' => !empty($_SESSION['gaubretrail_admin']) ? ['id' => 'primary', 'name' => $config['admin_name'], 'role' => 'organizer'] : null]);
}
if (!$configured) output_json(503, ['error' => 'API non configurée. Copiez api/config.example.php vers api/config.php.']);

if ($route === 'login' && $method === 'POST') {
    $data = body_json();
    $attempts = (int)($_SESSION['login_attempts'] ?? 0);
    if ($attempts >= 8) output_json(429, ['error' => 'Trop de tentatives. Fermez le navigateur puis réessayez.']);
    $valid = hash_equals((string)$config['admin_username'], (string)($data['username'] ?? '')) && verify_admin_password((string)($data['password'] ?? ''), (string)$config['admin_password_hash']);
    if (!$valid) { $_SESSION['login_attempts'] = $attempts + 1; output_json(401, ['error' => 'Identifiant ou mot de passe incorrect.']); }
    session_regenerate_id(true); $_SESSION['gaubretrail_admin'] = true; unset($_SESSION['login_attempts']);
    output_json(200, ['ok' => true]);
}
if ($route === 'logout' && $method === 'POST') { require_admin(); $_SESSION = []; session_destroy(); output_json(200, ['ok' => true]); }

if ($route === 'public' && $method === 'GET') { $document = read_document(); output_json(200, ['revision' => $document['revision'], 'state' => public_state($document['state'])]); }
if ($route === 'state' && $method === 'GET') { require_admin(); output_json(200, read_document()); }
if ($route === 'state' && $method === 'PUT') {
    require_admin();
    $state = body_json();
    if (($state['schemaVersion'] ?? null) !== 3 || !is_array($state['editions'] ?? null) || !is_array($state['courses'] ?? null)) output_json(422, ['error' => 'Structure de données invalide.']);
    $expected = isset($_SERVER['HTTP_IF_MATCH']) ? (int)$_SERVER['HTTP_IF_MATCH'] : -1;
    $next = update_document($expected, $state);
    output_json(200, ['revision' => $next['revision']]);
}

output_json(404, ['error' => 'Point d’accès inconnu.']);
