<?php
// api.php - Backend for TASKFLOW.AI

// 1. CORS & HEADERS
$allowed_origin = $_SERVER['HTTP_ORIGIN'] ?? "*";
header("Access-Control-Allow-Origin: $allowed_origin");
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Max-Age: 86400');

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    if (isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD']))
        header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");         
    if (isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS']))
        header("Access-Control-Allow-Headers: {$_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS']}, Authorization, Content-Type");
    exit(0);
}

header("Content-Type: application/json; charset=UTF-8");
error_reporting(E_ALL);
ini_set('display_errors', 0); 
ini_set('log_errors', 1);

// --- CONFIGURATION ---
define('API_SECRET', getenv('API_SECRET') ?: 'TASKFLOW_SECRET_KEY_999');

// --- DB CONNECTION ---
// UPDATE THESE WITH YOUR ACTUAL DATABASE CREDENTIALS
$host = "localhost";      // CHANGE THIS
$user = "u303071594_tsk";     // CHANGE THIS
$pass = "sX0&e>eU^T4";    // CHANGE THIS
$db   = "u303071594_tsk";    // CHANGE THIS   

try {
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $conn = new mysqli($host, $user, $pass, $db);
    $conn->set_charset("utf8mb4");
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection failed"]);
    exit;
}

// --- HELPERS ---

function getJsonInput() { 
    $in = file_get_contents('php://input'); 
    return $in ? json_decode($in, true) : []; 
}

function generateToken($userId) {
    $payload = json_encode(['uid' => $userId, 'exp' => time() + (86400 * 7)]);
    $hash = hash_hmac('sha256', $payload, API_SECRET);
    return base64_encode("$hash|$payload");
}

function validateAuth() {
    global $conn;
    $headers = apache_request_headers();
    $authHeader = $headers['Authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    
    if (!preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        http_response_code(401); echo json_encode(["error" => "Unauthorized"]); exit;
    }
    
    $token = $matches[1];
    $decoded = base64_decode($token);
    $parts = explode('|', $decoded, 2);
    
    if (count($parts) !== 2) { http_response_code(401); echo json_encode(["error" => "Invalid Token"]); exit;
    }
    
    list($hash, $payloadStr) = $parts;
    
    if (hash_hmac('sha256', $payloadStr, API_SECRET) !== $hash) {
        http_response_code(401); echo json_encode(["error" => "Invalid Signature"]); exit;
    }
    
    $payload = json_decode($payloadStr, true);
    if ($payload['exp'] < time()) {
        http_response_code(401); echo json_encode(["error" => "Token Expired"]); exit;
    }
    
    return $payload['uid'];
}

// --- ROUTING ---
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

try {

    // --- AUTH ---

    if ($method === 'POST' && $action === 'register') {
        $d = getJsonInput();
        $user = $d['username'] ?? '';
        $pass = $d['password'] ?? '';
        $email = $d['email'] ?? '';

        if (!$user || !$pass || !$email) throw new Exception("Missing fields");

        $hash = password_hash($pass, PASSWORD_DEFAULT);
        
        $stmt = $conn->prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)");
        $stmt->bind_param("sss", $user, $email, $hash);
        
        if ($stmt->execute()) {
            $uid = $conn->insert_id;
            echo json_encode([
                "success" => true, 
                "token" => generateToken($uid), 
                "user" => ["id" => $uid, "username" => $user, "xp" => 0, "level" => 1, "last_reset_at" => null]
            ]);
        } else {
            http_response_code(400);
            echo json_encode(["error" => "User already exists"]);
        }

    } elseif ($method === 'POST' && $action === 'login') {
        $d = getJsonInput();
        $email = $d['email'] ?? '';
        $pass = $d['password'] ?? '';

        $stmt = $conn->prepare("SELECT id, username, password_hash, xp, level, streak, last_active_date, last_reset_at FROM users WHERE email = ?");
        $stmt->bind_param("s", $email);
        $stmt->execute();
        $res = $stmt->get_result();

        if ($row = $res->fetch_assoc()) {
            if (password_verify($pass, $row['password_hash'])) {
                // Streak Logic
                $today = date('Y-m-d');
                if ($row['last_active_date'] !== $today) {
                    $yesterday = date('Y-m-d', strtotime('-1 day'));
                    $newStreak = ($row['last_active_date'] === $yesterday) ? $row['streak'] + 1 : 1;
                    $upd = $conn->prepare("UPDATE users SET last_active_date = ?, streak = ? WHERE id = ?");
                    $upd->bind_param("sii", $today, $newStreak, $row['id']);
                    $upd->execute();
                    $row['streak'] = $newStreak;
                }

                echo json_encode([
                    "success" => true, 
                    "token" => generateToken($row['id']),
                    "user" => [
                        "id" => $row['id'],
                        "username" => $row['username'],
                        "xp" => $row['xp'],
                        "level" => $row['level'],
                        "streak" => $row['streak'],
                        "last_reset_at" => $row['last_reset_at']
                    ]
                ]);
            } else {
                http_response_code(401); echo json_encode(["error" => "Invalid credentials"]);
            }
        } else {
            http_response_code(404); echo json_encode(["error" => "User not found"]);
        }

    // --- TASKS ---

    } elseif ($method === 'GET' && $action === 'get_tasks') {
        $uid = validateAuth();
        $stmt = $conn->prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC");
        $stmt->bind_param("i", $uid);
        $stmt->execute();
        $res = $stmt->get_result();
        
        $tasks = [];
        while($r = $res->fetch_assoc()) {
            $r['tags'] = json_decode($r['tags']);
            $r['dependencies'] = json_decode($r['dependencies']) ?: [];
            $r['estimatedTime'] = $r['estimated_time'];
            unset($r['estimated_time']);
            
            if (isset($r['recurrence']) && $r['recurrence']) {
                $r['recurrence'] = json_decode($r['recurrence']);
            }
            $tasks[] = $r;
        }
        echo json_encode($tasks);

    } elseif ($method === 'POST' && $action === 'sync_tasks') {
        $uid = validateAuth();
        $d = getJsonInput();
        
        $stmt = $conn->prepare("INSERT INTO tasks (id, user_id, title, workspace, energy, status, estimated_time, tags, dependencies, created_at, completed_at, due_date, snoozed_until, recurrence, original_recurrence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=VALUES(title), workspace=VALUES(workspace), energy=VALUES(energy), status=VALUES(status), dependencies=VALUES(dependencies), completed_at=VALUES(completed_at), due_date=VALUES(due_date), snoozed_until=VALUES(snoozed_until), recurrence=VALUES(recurrence)");
        
        $tagsJson = json_encode($d['tags'] ?? []);
        $depsJson = json_encode($d['dependencies'] ?? []);
        $recJson = isset($d['recurrence']) ? json_encode($d['recurrence']) : null;
        
        // Ensure values are NULL if empty
        $completedAt = $d['completedAt'] ?? null;
        $dueDate = $d['dueDate'] ?? null;
        $snoozedUntil = $d['snoozedUntil'] ?? null;
        $origRecId = $d['originalRecurrenceId'] ?? null;
        
        // NOTE: We use 's' (string) for BIGINT timestamp fields to avoid 32-bit integer overflow issues in PHP
        // sissssissssssss (15 parameters)
        $stmt->bind_param("sissssissssssss", 
            $d['id'], 
            $uid, 
            $d['title'], 
            $d['workspace'], 
            $d['energy'], 
            $d['status'], 
            $d['estimatedTime'], 
            $tagsJson, 
            $depsJson, 
            $d['createdAt'], 
            $completedAt,    
            $dueDate,        
            $snoozedUntil,   
            $recJson, 
            $origRecId
        );
        
        if ($stmt->execute()) {
             echo json_encode(["success" => true]);
        } else {
             http_response_code(500);
             echo json_encode(["error" => "DB Error: " . $stmt->error]);
        }

    } elseif ($method === 'POST' && $action === 'delete_task') {
        $uid = validateAuth();
        $d = getJsonInput();
        $stmt = $conn->prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?");
        $stmt->bind_param("si", $d['id'], $uid);
        $stmt->execute();
        echo json_encode(["success" => true]);

    } elseif ($method === 'POST' && $action === 'complete_task') {
        $uid = validateAuth();
        $d = getJsonInput();
        $taskId = $d['id'];
        $now = round(microtime(true) * 1000); 
        
        // Use 's' for timestamps
        $stmt = $conn->prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ? AND user_id = ?");
        $stmt->bind_param("ssi", $now, $taskId, $uid);
        $stmt->execute();

        // XP Logic
        $conn->query("UPDATE users SET xp = xp + 50 WHERE id = $uid");
        $uRes = $conn->query("SELECT xp, level FROM users WHERE id = $uid");
        $uRow = $uRes->fetch_assoc();
        $newLevel = floor($uRow['xp'] / 500) + 1;
        $leveledUp = false;
        
        if ($newLevel > $uRow['level']) {
            $conn->query("UPDATE users SET level = $newLevel WHERE id = $uid");
            $leveledUp = true;
        }

        echo json_encode([
            "success" => true, 
            "new_xp" => $uRow['xp'], 
            "new_level" => $newLevel,
            "leveled_up" => $leveledUp
        ]);

    } elseif ($method === 'POST' && $action === 'uncomplete_task') {
        // Deprecated but kept for fallback
        $uid = validateAuth();
        $d = getJsonInput();
        $stmt = $conn->prepare("UPDATE tasks SET status = 'todo', completed_at = NULL WHERE id = ? AND user_id = ?");
        $stmt->bind_param("si", $d['id'], $uid);
        $stmt->execute();
        echo json_encode(["success" => true]);

    } elseif ($method === 'POST' && $action === 'daily_reset') {
        $uid = validateAuth();
        // Use ISO 8601 string for compatibility
        $now = date('c'); 
        
        $stmt = $conn->prepare("UPDATE users SET last_reset_at = ? WHERE id = ?");
        $stmt->bind_param("si", $now, $uid);
        
        if ($stmt->execute()) {
             echo json_encode(["success" => true, "reset_time" => $now]);
        } else {
             http_response_code(500);
             echo json_encode(["error" => "Update failed"]);
        }

    } else {
        echo json_encode(["message" => "TaskFlow API Online"]);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => $e->getMessage()]);
}
$conn->close();
?>