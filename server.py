import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


BASE_DIR      = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("ATTENDANCE_DB", BASE_DIR / "student_attendance.db"))
PORT          = int(os.environ.get("PORT", "8000"))
HOST          = os.environ.get("HOST", "0.0.0.0")

# Session tokens expire after 8 hours (seconds)
SESSION_TTL = 8 * 60 * 60

SAMPLE_STUDENTS = [
    ("ST001", "Kwame Mensah",   "Computer Science",       "100", "Present"),
    ("ST002", "Ama Owusu",      "Information Technology", "100", "Absent"),
    ("ST003", "Kofi Asare",     "Computer Science",       "100", "Late"),
    ("ST004", "Efua Boateng",   "Mathematics",            "200", "Present"),
    ("ST005", "Daniel Addo",    "Business Administration","100", "Absent"),
    ("ST006", "Nana Konadu",    "Accounting",             "300", "Late"),
    ("ST007", "Yaw Appiah",     "Physics",                "200", "Present"),
    ("ST008", "Abigail Mensah", "English Literature",     "100", "Present"),
]
VALID_STATUSES = {"Present", "Absent", "Late"}

# ── Helpers ────────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Return a hex-encoded SHA-256 PBKDF2 hash with an embedded salt."""
    salt = secrets.token_hex(16)
    dk   = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"{salt}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time comparison of a plain password against a stored hash."""
    try:
        salt, dk_hex = stored.split(":", 1)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return hmac.compare_digest(dk.hex(), dk_hex)


def now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


# ── Database ───────────────────────────────────────────────────────────────────

@contextmanager
def connect_database():
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect_database() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS students (
                id         TEXT PRIMARY KEY COLLATE NOCASE,
                name       TEXT NOT NULL,
                email      TEXT UNIQUE,
                phone      TEXT,
                course     TEXT NOT NULL,
                level      TEXT NOT NULL DEFAULT '',
                gender     TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS attendance (
                student_id      TEXT NOT NULL COLLATE NOCASE,
                attendance_date TEXT NOT NULL,
                status          TEXT NOT NULL CHECK (status IN ('Present','Absent','Late')),
                PRIMARY KEY (student_id, attendance_date),
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT    NOT NULL,
                email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT    NOT NULL,
                student_id    TEXT    REFERENCES students(id) ON DELETE SET NULL,
                created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
        """)

        # Seed sample students only when the table is empty
        count = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        if count == 0:
            conn.executemany(
                "INSERT INTO students (id, name, course, level) VALUES (?,?,?,?)",
                [(sid, name, course, level)
                 for sid, name, course, level, _ in SAMPLE_STUDENTS],
            )
            conn.executemany(
                "INSERT INTO attendance (student_id, attendance_date, status) VALUES (?,?,?)",
                [(sid, date.today().isoformat(), status)
                 for sid, _, _, _, status in SAMPLE_STUDENTS],
            )


# ── Request handler ────────────────────────────────────────────────────────────

class AttendanceHandler(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    # ── Low-level helpers ──────────────────────────────────────────────────────

    def send_json(self, status, payload):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",  "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control",  "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as e:
            raise ValueError("Invalid request length.") from e
        if length <= 0 or length > 1_000_000:
            raise ValueError("Request body must be between 1 byte and 1 MB.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError("Request body must contain valid JSON.") from e
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    @staticmethod
    def validate_date(value):
        try:
            return date.fromisoformat(value).isoformat()
        except (TypeError, ValueError) as e:
            raise ValueError("Date must use YYYY-MM-DD format.") from e

    def get_session_user(self):
        """Return the user row if a valid session token is present, else None."""
        cookie_header = self.headers.get("Cookie", "")
        token = None
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith("session="):
                token = part[len("session="):]
                break
        if not token:
            return None
        with connect_database() as conn:
            row = conn.execute(
                """SELECT u.id, u.name, u.email, u.student_id
                   FROM sessions s JOIN users u ON s.user_id = u.id
                   WHERE s.token = ? AND s.expires_at > ?""",
                (token, now_ts()),
            ).fetchone()
        return dict(row) if row else None

    def set_session_cookie(self, token, max_age):
        self.send_header(
            "Set-Cookie",
            f"session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
        )

    # ── Routing ────────────────────────────────────────────────────────────────

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/students":
            if not self.get_session_user():
                self.send_json(401, {"error": "Not authenticated."})
                return
            with connect_database() as conn:
                rows = conn.execute(
                    "SELECT id, name, email, phone, course, level, gender "
                    "FROM students ORDER BY name COLLATE NOCASE"
                ).fetchall()
            self.send_json(200, [dict(r) for r in rows])
            return

        if parsed.path == "/api/attendance":
            if not self.get_session_user():
                self.send_json(401, {"error": "Not authenticated."})
                return
            query = parse_qs(parsed.query)
            try:
                att_date = self.validate_date(query.get("date", [None])[0])
            except ValueError as e:
                self.send_json(400, {"error": str(e)})
                return
            with connect_database() as conn:
                rows = conn.execute(
                    "SELECT student_id, status FROM attendance WHERE attendance_date = ?",
                    (att_date,),
                ).fetchall()
            self.send_json(200, [dict(r) for r in rows])
            return

        if parsed.path == "/api/auth/me":
            user = self.get_session_user()
            if not user:
                self.send_json(401, {"error": "Not authenticated."})
                return
            self.send_json(200, user)
            return

        if parsed.path.startswith("/api/"):
            self.send_json(404, {"error": "API endpoint not found."})
            return

        # Static file serving
        rel  = unquote(parsed.path).lstrip("/")
        dest = (BASE_DIR / rel).resolve()
        if os.path.commonpath((str(BASE_DIR), str(dest))) != str(BASE_DIR):
            self.send_error(404)
            return
        if parsed.path == "/" or dest.is_dir():
            # Issue a proper redirect so the browser URL updates cleanly
            self.send_response(302)
            self.send_header("Location", "/login.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        parsed_path = urlparse(self.path).path

        AUTH_ROUTES = {"/api/auth/register", "/api/auth/login", "/api/auth/logout"}
        if parsed_path in AUTH_ROUTES:
            try:
                payload = self.read_json() if parsed_path != "/api/auth/logout" else {}
                if parsed_path == "/api/auth/register":
                    self.auth_register(payload)
                elif parsed_path == "/api/auth/login":
                    self.auth_login(payload)
                else:
                    self.auth_logout()
            except ValueError as e:
                self.send_json(400, {"error": str(e)})
            return

        if parsed_path not in {"/api/students", "/api/attendance"}:
            self.send_json(404, {"error": "API endpoint not found."})
            return

        if not self.get_session_user():
            self.send_json(401, {"error": "Not authenticated."})
            return

        try:
            payload = self.read_json()
            if parsed_path == "/api/students":
                self.create_student(payload)
            else:
                self.save_attendance(payload)
        except ValueError as e:
            self.send_json(400, {"error": str(e)})
        except sqlite3.IntegrityError as e:
            msg = str(e)
            if "UNIQUE constraint failed: students.id" in msg:
                self.send_json(409, {"error": "That student ID already exists."})
            elif "UNIQUE constraint failed: students.email" in msg:
                self.send_json(409, {"error": "That email is already registered to a student."})
            elif parsed_path == "/api/students":
                self.send_json(400, {"error": "Student record violates a database constraint."})
            else:
                self.send_json(400, {"error": "Attendance contains an unknown student ID."})
        except sqlite3.Error:
            self.log_error("Database request failed")
            self.send_json(500, {"error": "The database could not save this request."})

    # ── Auth handlers ──────────────────────────────────────────────────────────

    def auth_register(self, payload):
        # Validate fields
        name     = str(payload.get("name",     "") or "").strip()
        email    = str(payload.get("email",    "") or "").strip().lower()
        password = str(payload.get("password", "") or "")
        student_id = str(payload.get("student_id", "") or "").strip() or None

        # Optional extras forwarded to the students table
        course = str(payload.get("course", "") or "").strip()
        level  = str(payload.get("level",  "") or "").strip()
        gender = str(payload.get("gender", "") or "").strip() or None
        phone  = str(payload.get("phone",  "") or "").strip() or None

        if not name:
            raise ValueError("Name is required.")
        if not email or "@" not in email:
            raise ValueError("A valid email address is required.")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters.")

        pw_hash = hash_password(password)

        try:
            with connect_database() as conn:
                # If a student_id was supplied, create/upsert the student row so
                # the foreign key constraint is satisfied.
                if student_id and course:
                    conn.execute(
                        """INSERT INTO students (id, name, email, phone, course, level, gender)
                           VALUES (?,?,?,?,?,?,?)
                           ON CONFLICT(id) DO UPDATE SET
                               email  = COALESCE(excluded.email,  students.email),
                               phone  = COALESCE(excluded.phone,  students.phone),
                               gender = COALESCE(excluded.gender, students.gender)
                        """,
                        (student_id, name, email, phone, course, level, gender),
                    )
                conn.execute(
                    "INSERT INTO users (name, email, password_hash, student_id) VALUES (?,?,?,?)",
                    (name, email, pw_hash, student_id),
                )
        except sqlite3.IntegrityError as e:
            if "UNIQUE constraint failed: users.email" in str(e):
                self.send_json(409, {"error": "An account with that email already exists."})
            else:
                self.send_json(409, {"error": "Registration failed due to a conflict."})
            return

        self.send_json(201, {"message": "Account created. You can now sign in."})

    def auth_login(self, payload):
        email    = str(payload.get("email",    "") or "").strip().lower()
        password = str(payload.get("password", "") or "")

        if not email or not password:
            raise ValueError("Email and password are required.")

        with connect_database() as conn:
            user = conn.execute(
                "SELECT id, name, email, password_hash, student_id FROM users WHERE email = ?",
                (email,),
            ).fetchone()

        if not user or not verify_password(password, user["password_hash"]):
            # Return the same error for both missing user and wrong password
            self.send_json(401, {"error": "Invalid email or password."})
            return

        # Issue a new session token
        token      = secrets.token_urlsafe(32)
        created_at = now_ts()
        expires_at = created_at + SESSION_TTL

        with connect_database() as conn:
            # Clean up any expired tokens for this user first
            conn.execute(
                "DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?",
                (user["id"], created_at),
            )
            conn.execute(
                "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
                (token, user["id"], created_at, expires_at),
            )

        self.send_response(200)
        self.send_header("Content-Type",  "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.set_session_cookie(token, SESSION_TTL)
        body = json.dumps({
            "message":    "Login successful.",
            "name":       user["name"],
            "email":      user["email"],
            "student_id": user["student_id"],
        }).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def auth_logout(self):
        cookie_header = self.headers.get("Cookie", "")
        token = None
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith("session="):
                token = part[len("session="):]
                break
        if token:
            with connect_database() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))

        self.send_response(200)
        self.send_header("Content-Type",  "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        # Expire the cookie
        self.set_session_cookie("", 0)
        body = json.dumps({"message": "Logged out."}).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── Student / attendance handlers (unchanged logic) ────────────────────────

    def create_student(self, payload):
        student = {}
        for field, required in (
            ("id", True), ("name", True), ("course", True), ("level", False),
            ("email", False), ("phone", False), ("gender", False),
        ):
            value = payload.get(field, "") or ""
            if not isinstance(value, str):
                raise ValueError(f"{field.capitalize()} must be text.")
            value = value.strip()
            if required and not value:
                raise ValueError(f"{field.capitalize()} is required.")
            if len(value) > 200:
                raise ValueError(f"{field.capitalize()} must be 200 characters or fewer.")
            student[field] = value

        with connect_database() as conn:
            conn.execute(
                """INSERT INTO students (id, name, email, phone, course, level, gender)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    student["id"], student["name"],
                    student["email"] or None, student["phone"] or None,
                    student["course"], student["level"],
                    student["gender"] or None,
                ),
            )
        self.send_json(201, {"message": "Student created.", "id": student["id"]})

    def save_attendance(self, payload):
        att_date = self.validate_date(payload.get("date"))
        records  = payload.get("records")
        if not isinstance(records, list):
            raise ValueError("Records must be a list.")

        normalized, seen = [], set()
        for rec in records:
            if not isinstance(rec, dict):
                raise ValueError("Each attendance record must be an object.")
            sid    = rec.get("student_id")
            status = rec.get("status")
            if not isinstance(sid, str) or not sid.strip():
                raise ValueError("Each attendance record needs a student ID.")
            sid = sid.strip()
            if sid.casefold() in seen:
                raise ValueError("A student can only have one status per date.")
            if status not in VALID_STATUSES:
                raise ValueError("Status must be Present, Absent, or Late.")
            seen.add(sid.casefold())
            normalized.append((sid, att_date, status))

        with connect_database() as conn:
            conn.executemany(
                """INSERT INTO attendance (student_id, attendance_date, status) VALUES (?,?,?)
                   ON CONFLICT (student_id, attendance_date)
                   DO UPDATE SET status = excluded.status""",
                normalized,
            )
        self.send_json(200, {
            "message": "Attendance saved.",
            "date":    att_date,
            "count":   len(normalized),
        })

    def do_DELETE(self):
        if not self.get_session_user():
            self.send_json(401, {"error": "Not authenticated."})
            return
        parsed_path = urlparse(self.path).path
        prefix = "/api/students/"
        if not parsed_path.startswith(prefix):
            self.send_json(404, {"error": "API endpoint not found."})
            return
        sid = unquote(parsed_path[len(prefix):]).strip()
        if not sid:
            self.send_json(400, {"error": "Student ID is required."})
            return
        with connect_database() as conn:
            cursor = conn.execute("DELETE FROM students WHERE id = ?", (sid,))
        if cursor.rowcount == 0:
            self.send_json(404, {"error": "Student not found."})
            return
        self.send_json(200, {"message": "Student and attendance records removed."})

    def log_message(self, fmt, *args):
        # Print to stdout so issues are visible during development
        print(f"[{self.address_string()}] {fmt % args}")


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), AttendanceHandler)
    print(f"Jbrains.Tech Study Planner  →  http://127.0.0.1:{PORT}/")
    if HOST == "0.0.0.0":
        print(f"LAN access                  →  http://<your-ip>:{PORT}/")
    print(f"SQLite database             →  {DATABASE_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
