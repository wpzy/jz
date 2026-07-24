from __future__ import annotations

import hashlib
import hmac
import html
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, quote, urlparse

try:
    import pysqlite3 as sqlite3  # type: ignore[no-redef]
except ImportError:
    import sqlite3  # type: ignore[no-redef]

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

APP_NAME = "JZ 个人记事"
AUTH_COOKIE_NAME = "jz_session"
AUTH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

HOST = os.getenv("JZ_HOST", "127.0.0.1")
PORT = int(os.getenv("JZ_PORT", "8766"))
PUBLIC_BASE = os.getenv("JZ_PUBLIC_BASE", f"http://127.0.0.1:{PORT}")
DB_PATH = Path(os.getenv("JZ_DB_PATH", "./jz.db")).expanduser()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title=APP_NAME, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# Auth
# ──────────────────────────────────────────────


def _auth_enabled() -> bool:
    value = os.getenv("JZ_AUTH_ENABLED", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _auth_username() -> str:
    return os.getenv("JZ_AUTH_USER", "admin")


def _auth_password() -> str:
    return os.getenv("JZ_AUTH_PASSWORD", "change-me")


def _auth_secret() -> str:
    value = os.getenv("JZ_AUTH_SECRET", "").strip()
    if value:
        return value
    return "jz-local-dev-secret-change-me"


def _normalize_next_path(next_path: str) -> str:
    value = (next_path or "/ui/").strip()
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc or not value.startswith("/") or value.startswith("//"):
        return "/ui/"
    return value


def _sign_session(username: str, expires_at: int) -> str:
    payload = f"{username}:{expires_at}"
    return hmac.new(_auth_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _make_session_token(username: str) -> str:
    expires_at = int(time.time()) + AUTH_MAX_AGE_SECONDS
    signature = _sign_session(username, expires_at)
    return f"{username}:{expires_at}:{signature}"


def _is_valid_session(token: str) -> bool:
    try:
        username, expires_text, signature = token.split(":", 2)
        expires_at = int(expires_text)
    except (TypeError, ValueError):
        return False
    if username != _auth_username() or expires_at < int(time.time()):
        return False
    expected = _sign_session(username, expires_at)
    return hmac.compare_digest(signature, expected)


def _is_public_path(path: str) -> bool:
    return path in {"/login", "/ping", "/favicon.ico"} or path.startswith("/auth/")


def _wants_html(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "text/html" in accept or request.url.path in {"/", "/ui", "/ui/", "/docs", "/redoc"}


@app.middleware("http")
async def require_login(request: Request, call_next):
    if not _auth_enabled() or request.method == "OPTIONS":
        return await call_next(request)
    if _is_public_path(request.url.path):
        return await call_next(request)
    if _is_valid_session(request.cookies.get(AUTH_COOKIE_NAME, "")):
        return await call_next(request)

    next_path = request.url.path
    if request.url.query:
        next_path = f"{next_path}?{request.url.query}"
    if _wants_html(request):
        return RedirectResponse(url=f"/login?next={quote(next_path, safe='')}", status_code=303)
    return JSONResponse({"detail": "Authentication required"}, status_code=401)


def _login_page(error: str = "", next_path: str = "/ui/") -> str:
    escaped_error = html.escape(error)
    escaped_next = html.escape(next_path or "/ui/", quote=True)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{APP_NAME} 登录</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top left, #dbeafe, transparent 32%), linear-gradient(135deg, #0f172a, #1e3a8a);
      color: #0f172a;
    }}
    .card {{
      width: min(420px, calc(100vw - 32px));
      padding: 32px;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35);
    }}
    h1 {{ margin: 0 0 8px; font-size: 28px; }}
    p {{ margin: 0 0 24px; color: #64748b; }}
    label {{ display: block; margin: 14px 0 6px; font-weight: 700; }}
    input {{
      width: 100%; height: 44px; padding: 0 12px; border: 1px solid #cbd5e1;
      border-radius: 12px; font-size: 15px;
    }}
    button {{
      width: 100%; height: 46px; margin-top: 22px; border: 0; border-radius: 12px;
      background: #2563eb; color: white; font-size: 16px; font-weight: 800; cursor: pointer;
    }}
    .error {{ margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: #fee2e2; color: #b91c1c; }}
  </style>
</head>
<body>
  <form class="card" method="post" action="/auth/login">
    <h1>{APP_NAME}</h1>
    <p>请登录后访问你的个人日志、Todo 和记账工具。</p>
    {f'<div class="error">{escaped_error}</div>' if escaped_error else ''}
    <input type="hidden" name="next" value="{escaped_next}">
    <label for="username">用户名</label>
    <input id="username" name="username" autocomplete="username" value="admin" autofocus>
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password">
    <button type="submit">登录</button>
  </form>
</body>
</html>"""


@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/ui/", status_code=303)


@app.get("/login", response_class=HTMLResponse, include_in_schema=False)
async def login_page(request: Request, next: str = "/ui/"):
    next_path = _normalize_next_path(next)
    if _is_valid_session(request.cookies.get(AUTH_COOKIE_NAME, "")):
        return RedirectResponse(url=next_path, status_code=303)
    return HTMLResponse(_login_page(next_path=next_path))


@app.post("/auth/login", include_in_schema=False)
async def login_submit(request: Request):
    body = (await request.body()).decode("utf-8", errors="ignore")
    form = parse_qs(body)
    username = (form.get("username") or [""])[0]
    password = (form.get("password") or [""])[0]
    next_path = _normalize_next_path((form.get("next") or ["/ui/"])[0])

    if username == _auth_username() and password == _auth_password():
        response = RedirectResponse(url=next_path, status_code=303)
        response.set_cookie(
            AUTH_COOKIE_NAME,
            _make_session_token(username),
            max_age=AUTH_MAX_AGE_SECONDS,
            httponly=True,
            samesite="lax",
        )
        return response
    return HTMLResponse(_login_page("用户名或密码错误", next_path=next_path), status_code=401)


@app.get("/auth/logout", include_in_schema=False)
async def logout():
    response = RedirectResponse(url="/login", status_code=303)
    response.delete_cookie(AUTH_COOKIE_NAME)
    return response


# ──────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────


def now_ts() -> int:
    return int(time.time())


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
    return dict(row) if row is not None else None


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS journal_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entry_date TEXT NOT NULL,
              title TEXT,
              body TEXT NOT NULL,
              mood TEXT,
              tags TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(entry_date DESC);
            CREATE INDEX IF NOT EXISTS idx_journal_updated ON journal_entries(updated_at DESC);

            CREATE TABLE IF NOT EXISTS todos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              notes TEXT,
              status TEXT NOT NULL DEFAULT 'open',
              priority TEXT NOT NULL DEFAULT 'normal',
              due_date TEXT,
              completed_at INTEGER,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
            CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

            CREATE TABLE IF NOT EXISTS accounts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL UNIQUE,
              type TEXT,
              initial_balance REAL NOT NULL DEFAULT 0,
              notes TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              kind TEXT NOT NULL,
              parent_id INTEGER,
              sort_order INTEGER NOT NULL DEFAULT 0,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              UNIQUE(name, kind)
            );
            CREATE INDEX IF NOT EXISTS idx_categories_kind ON categories(kind);

            CREATE TABLE IF NOT EXISTS transactions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              txn_date TEXT NOT NULL,
              kind TEXT NOT NULL,
              amount REAL NOT NULL,
              category_id INTEGER,
              account_id INTEGER,
              notes TEXT,
              counterparty TEXT,
              tags TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              FOREIGN KEY(category_id) REFERENCES categories(id),
              FOREIGN KEY(account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(txn_date DESC);
            CREATE INDEX IF NOT EXISTS idx_transactions_kind ON transactions(kind);
            CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
            """
        )
        seed_defaults(conn)


def seed_defaults(conn: sqlite3.Connection) -> None:
    ts = now_ts()
    account_count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    if account_count == 0:
        conn.execute(
            "INSERT INTO accounts (name, type, initial_balance, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
            ("现金", "cash", 0, "默认现金账户", ts, ts),
        )

    category_count = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if category_count == 0:
        expense = ["餐饮", "交通", "购物", "居住", "水电网", "医疗", "娱乐", "学习", "人情", "其他支出"]
        income = ["工资", "副业", "投资", "退款", "其他收入"]
        for index, name in enumerate(expense):
            conn.execute(
                "INSERT INTO categories (name, kind, sort_order, is_active, created_at, updated_at) VALUES (?, 'expense', ?, 1, ?, ?)",
                (name, index, ts, ts),
            )
        for index, name in enumerate(income):
            conn.execute(
                "INSERT INTO categories (name, kind, sort_order, is_active, created_at, updated_at) VALUES (?, 'income', ?, 1, ?, ?)",
                (name, index, ts, ts),
            )


# ──────────────────────────────────────────────
# Validation helpers
# ──────────────────────────────────────────────


def parse_date(value: str, field: str = "date") -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} 必须是 YYYY-MM-DD")
    return value


def parse_month(value: str, field: str = "month") -> str:
    try:
        datetime.strptime(value, "%Y-%m")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} 必须是 YYYY-MM")
    return value


def validate_kind(kind: str) -> str:
    if kind not in {"income", "expense"}:
        raise HTTPException(status_code=400, detail="kind 必须是 income 或 expense")
    return kind


def validate_status(status: str) -> str:
    if status not in {"open", "done", "archived"}:
        raise HTTPException(status_code=400, detail="status 必须是 open、done 或 archived")
    return status


def validate_priority(priority: str) -> str:
    if priority not in {"low", "normal", "high"}:
        raise HTTPException(status_code=400, detail="priority 必须是 low、normal 或 high")
    return priority


def clamp_limit(limit: int, default: int = 100, maximum: int = 500) -> int:
    if limit <= 0:
        return default
    return min(limit, maximum)


def get_one_or_404(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...], label: str) -> dict[str, Any]:
    row = conn.execute(sql, params).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label} 不存在")
    return dict(row)


# ──────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────


class JournalIn(BaseModel):
    entry_date: str
    title: str = ""
    body: str
    mood: str = ""
    tags: str = ""


class TodoIn(BaseModel):
    title: str
    notes: str = ""
    status: str = "open"
    priority: str = "normal"
    due_date: str = ""


class AccountIn(BaseModel):
    name: str
    type: str = ""
    initial_balance: float = 0
    notes: str = ""
    is_active: int = 1


class CategoryIn(BaseModel):
    name: str
    kind: str
    parent_id: Optional[int] = None
    sort_order: int = 0
    is_active: int = 1


class TransactionIn(BaseModel):
    txn_date: str
    kind: str
    amount: float = Field(gt=0)
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    notes: str = ""
    counterparty: str = ""
    tags: str = ""


# ──────────────────────────────────────────────
# Common routes
# ──────────────────────────────────────────────


@app.get("/ping")
async def ping():
    return {
        "ok": True,
        "app": "jz",
        "db_path": str(DB_PATH),
        "public_base": PUBLIC_BASE,
        "time": now_ts(),
    }


@app.get("/api/meta")
async def meta():
    return {"app": APP_NAME, "public_base": PUBLIC_BASE, "today": date.today().isoformat()}


# ──────────────────────────────────────────────
# Journals
# ──────────────────────────────────────────────


@app.get("/api/journals")
async def list_journals(
    from_date: str = Query("", alias="from"),
    to_date: str = Query("", alias="to"),
    q: str = "",
    tag: str = "",
    limit: int = 50,
    offset: int = 0,
):
    where: list[str] = []
    params: list[Any] = []
    if from_date:
        where.append("entry_date >= ?")
        params.append(parse_date(from_date, "from"))
    if to_date:
        where.append("entry_date <= ?")
        params.append(parse_date(to_date, "to"))
    if q:
        where.append("(title LIKE ? OR body LIKE ? OR tags LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    if tag:
        where.append("tags LIKE ?")
        params.append(f"%{tag}%")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.extend([clamp_limit(limit, 50), max(offset, 0)])
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM journal_entries {clause} ORDER BY entry_date DESC, updated_at DESC LIMIT ? OFFSET ?",
            tuple(params),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/journals")
async def create_journal(item: JournalIn):
    entry_date = parse_date(item.entry_date, "entry_date")
    body = item.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="日志正文不能为空")
    ts = now_ts()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO journal_entries (entry_date, title, body, mood, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (entry_date, item.title.strip(), body, item.mood.strip(), item.tags.strip(), ts, ts),
        )
        return get_one_or_404(conn, "SELECT * FROM journal_entries WHERE id = ?", (cur.lastrowid,), "日志")


@app.get("/api/journals/{journal_id}")
async def get_journal(journal_id: int):
    with get_db() as conn:
        return get_one_or_404(conn, "SELECT * FROM journal_entries WHERE id = ?", (journal_id,), "日志")


@app.put("/api/journals/{journal_id}")
async def update_journal(journal_id: int, item: JournalIn):
    entry_date = parse_date(item.entry_date, "entry_date")
    body = item.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="日志正文不能为空")
    with get_db() as conn:
        result = conn.execute(
            """
            UPDATE journal_entries
            SET entry_date = ?, title = ?, body = ?, mood = ?, tags = ?, updated_at = ?
            WHERE id = ?
            """,
            (entry_date, item.title.strip(), body, item.mood.strip(), item.tags.strip(), now_ts(), journal_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="日志不存在")
        return get_one_or_404(conn, "SELECT * FROM journal_entries WHERE id = ?", (journal_id,), "日志")


@app.delete("/api/journals/{journal_id}")
async def delete_journal(journal_id: int):
    with get_db() as conn:
        result = conn.execute("DELETE FROM journal_entries WHERE id = ?", (journal_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="日志不存在")
    return {"ok": True}


# ──────────────────────────────────────────────
# Todos
# ──────────────────────────────────────────────


@app.get("/api/todos")
async def list_todos(
    status: str = "open",
    q: str = "",
    due_from: str = "",
    due_to: str = "",
):
    where: list[str] = []
    params: list[Any] = []
    if status and status != "all":
        where.append("status = ?")
        params.append(validate_status(status))
    if q:
        where.append("(title LIKE ? OR notes LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])
    if due_from:
        where.append("due_date >= ?")
        params.append(parse_date(due_from, "due_from"))
    if due_to:
        where.append("due_date <= ?")
        params.append(parse_date(due_to, "due_to"))
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM todos {clause}
            ORDER BY
              CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
              CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
              COALESCE(due_date, '9999-12-31') ASC,
              updated_at DESC
            """,
            tuple(params),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/todos")
async def create_todo(item: TodoIn):
    title = item.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Todo 标题不能为空")
    status = validate_status(item.status)
    priority = validate_priority(item.priority)
    due_date = parse_date(item.due_date, "due_date") if item.due_date else ""
    completed_at = now_ts() if status == "done" else None
    ts = now_ts()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO todos (title, notes, status, priority, due_date, completed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (title, item.notes.strip(), status, priority, due_date, completed_at, ts, ts),
        )
        return get_one_or_404(conn, "SELECT * FROM todos WHERE id = ?", (cur.lastrowid,), "Todo")


@app.put("/api/todos/{todo_id}")
async def update_todo(todo_id: int, item: TodoIn):
    title = item.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Todo 标题不能为空")
    status = validate_status(item.status)
    priority = validate_priority(item.priority)
    due_date = parse_date(item.due_date, "due_date") if item.due_date else ""
    completed_at = now_ts() if status == "done" else None
    with get_db() as conn:
        result = conn.execute(
            """
            UPDATE todos
            SET title = ?, notes = ?, status = ?, priority = ?, due_date = ?, completed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, item.notes.strip(), status, priority, due_date, completed_at, now_ts(), todo_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Todo 不存在")
        return get_one_or_404(conn, "SELECT * FROM todos WHERE id = ?", (todo_id,), "Todo")


@app.post("/api/todos/{todo_id}/complete")
async def complete_todo(todo_id: int):
    with get_db() as conn:
        result = conn.execute(
            "UPDATE todos SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?",
            (now_ts(), now_ts(), todo_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Todo 不存在")
        return get_one_or_404(conn, "SELECT * FROM todos WHERE id = ?", (todo_id,), "Todo")


@app.post("/api/todos/{todo_id}/reopen")
async def reopen_todo(todo_id: int):
    with get_db() as conn:
        result = conn.execute(
            "UPDATE todos SET status = 'open', completed_at = NULL, updated_at = ? WHERE id = ?",
            (now_ts(), todo_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Todo 不存在")
        return get_one_or_404(conn, "SELECT * FROM todos WHERE id = ?", (todo_id,), "Todo")


@app.delete("/api/todos/{todo_id}")
async def delete_todo(todo_id: int):
    with get_db() as conn:
        result = conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Todo 不存在")
    return {"ok": True}


# ──────────────────────────────────────────────
# Accounting lookups
# ──────────────────────────────────────────────


@app.get("/api/accounts")
async def list_accounts(include_inactive: int = 0):
    where = "" if include_inactive else "WHERE is_active = 1"
    with get_db() as conn:
        rows = conn.execute(f"SELECT * FROM accounts {where} ORDER BY is_active DESC, name ASC").fetchall()
    return rows_to_dicts(rows)


@app.post("/api/accounts")
async def create_account(item: AccountIn):
    name = item.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="账户名称不能为空")
    ts = now_ts()
    try:
        with get_db() as conn:
            cur = conn.execute(
                """
                INSERT INTO accounts (name, type, initial_balance, notes, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (name, item.type.strip(), item.initial_balance, item.notes.strip(), 1 if item.is_active else 0, ts, ts),
            )
            return get_one_or_404(conn, "SELECT * FROM accounts WHERE id = ?", (cur.lastrowid,), "账户")
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="账户名称已存在")


@app.put("/api/accounts/{account_id}")
async def update_account(account_id: int, item: AccountIn):
    name = item.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="账户名称不能为空")
    try:
        with get_db() as conn:
            result = conn.execute(
                """
                UPDATE accounts
                SET name = ?, type = ?, initial_balance = ?, notes = ?, is_active = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, item.type.strip(), item.initial_balance, item.notes.strip(), 1 if item.is_active else 0, now_ts(), account_id),
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="账户不存在")
            return get_one_or_404(conn, "SELECT * FROM accounts WHERE id = ?", (account_id,), "账户")
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="账户名称已存在")


@app.delete("/api/accounts/{account_id}")
async def delete_account(account_id: int):
    with get_db() as conn:
        result = conn.execute("UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?", (now_ts(), account_id))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="账户不存在")
    return {"ok": True}


@app.get("/api/categories")
async def list_categories(kind: str = "", include_inactive: int = 0):
    where: list[str] = []
    params: list[Any] = []
    if kind:
        where.append("kind = ?")
        params.append(validate_kind(kind))
    if not include_inactive:
        where.append("is_active = 1")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM categories {clause} ORDER BY kind ASC, sort_order ASC, name ASC",
            tuple(params),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/categories")
async def create_category(item: CategoryIn):
    name = item.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    kind = validate_kind(item.kind)
    ts = now_ts()
    try:
        with get_db() as conn:
            cur = conn.execute(
                """
                INSERT INTO categories (name, kind, parent_id, sort_order, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (name, kind, item.parent_id, item.sort_order, 1 if item.is_active else 0, ts, ts),
            )
            return get_one_or_404(conn, "SELECT * FROM categories WHERE id = ?", (cur.lastrowid,), "分类")
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="同类型分类名称已存在")


@app.put("/api/categories/{category_id}")
async def update_category(category_id: int, item: CategoryIn):
    name = item.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    kind = validate_kind(item.kind)
    try:
        with get_db() as conn:
            result = conn.execute(
                """
                UPDATE categories
                SET name = ?, kind = ?, parent_id = ?, sort_order = ?, is_active = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, kind, item.parent_id, item.sort_order, 1 if item.is_active else 0, now_ts(), category_id),
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="分类不存在")
            return get_one_or_404(conn, "SELECT * FROM categories WHERE id = ?", (category_id,), "分类")
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="同类型分类名称已存在")


@app.delete("/api/categories/{category_id}")
async def delete_category(category_id: int):
    with get_db() as conn:
        result = conn.execute("UPDATE categories SET is_active = 0, updated_at = ? WHERE id = ?", (now_ts(), category_id))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="分类不存在")
    return {"ok": True}


# ──────────────────────────────────────────────
# Transactions and stats
# ──────────────────────────────────────────────


def validate_transaction_refs(conn: sqlite3.Connection, kind: str, category_id: Optional[int], account_id: Optional[int]) -> None:
    if category_id is not None:
        row = conn.execute("SELECT kind, is_active FROM categories WHERE id = ?", (category_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="分类不存在")
        if row["kind"] != kind:
            raise HTTPException(status_code=400, detail="分类类型必须和流水类型一致")
    if account_id is not None:
        row = conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="账户不存在")


def transaction_select_sql(where_clause: str = "") -> str:
    return f"""
        SELECT
          t.*,
          c.name AS category_name,
          c.kind AS category_kind,
          a.name AS account_name
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id
        {where_clause}
    """


@app.get("/api/transactions")
async def list_transactions(
    from_date: str = Query("", alias="from"),
    to_date: str = Query("", alias="to"),
    kind: str = "",
    category_id: int = 0,
    account_id: int = 0,
    q: str = "",
    limit: int = 100,
    offset: int = 0,
):
    where: list[str] = []
    params: list[Any] = []
    if from_date:
        where.append("t.txn_date >= ?")
        params.append(parse_date(from_date, "from"))
    if to_date:
        where.append("t.txn_date <= ?")
        params.append(parse_date(to_date, "to"))
    if kind:
        where.append("t.kind = ?")
        params.append(validate_kind(kind))
    if category_id:
        where.append("t.category_id = ?")
        params.append(category_id)
    if account_id:
        where.append("t.account_id = ?")
        params.append(account_id)
    if q:
        where.append("(t.notes LIKE ? OR t.counterparty LIKE ? OR t.tags LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.extend([clamp_limit(limit, 100), max(offset, 0)])
    with get_db() as conn:
        rows = conn.execute(
            transaction_select_sql(clause) + " ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?",
            tuple(params),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/transactions")
async def create_transaction(item: TransactionIn):
    txn_date = parse_date(item.txn_date, "txn_date")
    kind = validate_kind(item.kind)
    ts = now_ts()
    with get_db() as conn:
        validate_transaction_refs(conn, kind, item.category_id, item.account_id)
        cur = conn.execute(
            """
            INSERT INTO transactions (txn_date, kind, amount, category_id, account_id, notes, counterparty, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (txn_date, kind, item.amount, item.category_id, item.account_id, item.notes.strip(), item.counterparty.strip(), item.tags.strip(), ts, ts),
        )
        rows = conn.execute(transaction_select_sql("WHERE t.id = ?"), (cur.lastrowid,)).fetchall()
    return rows_to_dicts(rows)[0]


@app.get("/api/transactions/{txn_id}")
async def get_transaction(txn_id: int):
    with get_db() as conn:
        rows = conn.execute(transaction_select_sql("WHERE t.id = ?"), (txn_id,)).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="流水不存在")
    return rows_to_dicts(rows)[0]


@app.put("/api/transactions/{txn_id}")
async def update_transaction(txn_id: int, item: TransactionIn):
    txn_date = parse_date(item.txn_date, "txn_date")
    kind = validate_kind(item.kind)
    with get_db() as conn:
        validate_transaction_refs(conn, kind, item.category_id, item.account_id)
        result = conn.execute(
            """
            UPDATE transactions
            SET txn_date = ?, kind = ?, amount = ?, category_id = ?, account_id = ?, notes = ?, counterparty = ?, tags = ?, updated_at = ?
            WHERE id = ?
            """,
            (txn_date, kind, item.amount, item.category_id, item.account_id, item.notes.strip(), item.counterparty.strip(), item.tags.strip(), now_ts(), txn_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="流水不存在")
        rows = conn.execute(transaction_select_sql("WHERE t.id = ?"), (txn_id,)).fetchall()
    return rows_to_dicts(rows)[0]


@app.delete("/api/transactions/{txn_id}")
async def delete_transaction(txn_id: int):
    with get_db() as conn:
        result = conn.execute("DELETE FROM transactions WHERE id = ?", (txn_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="流水不存在")
    return {"ok": True}


@app.get("/api/accounting/summary")
async def accounting_summary(month: str = ""):
    if not month:
        month = date.today().strftime("%Y-%m")
    parse_month(month)
    start = f"{month}-01"
    end = (datetime.strptime(start, "%Y-%m-%d").date().replace(day=28) + timedelta(days=4)).replace(day=1).isoformat()
    with get_db() as conn:
        totals = conn.execute(
            """
            SELECT
              COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0) AS income_total,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0) AS expense_total,
              COUNT(*) AS transaction_count
            FROM transactions
            WHERE txn_date >= ? AND txn_date < ?
            """,
            (start, end),
        ).fetchone()
        top = conn.execute(
            """
            SELECT c.id AS category_id, COALESCE(c.name, '未分类') AS category_name, COALESCE(SUM(t.amount), 0) AS total
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.kind = 'expense' AND t.txn_date >= ? AND t.txn_date < ?
            GROUP BY c.id, c.name
            ORDER BY total DESC
            LIMIT 8
            """,
            (start, end),
        ).fetchall()
    income_total = float(totals["income_total"] or 0)
    expense_total = float(totals["expense_total"] or 0)
    return {
        "month": month,
        "income_total": income_total,
        "expense_total": expense_total,
        "net_total": income_total - expense_total,
        "transaction_count": int(totals["transaction_count"] or 0),
        "top_expense_categories": rows_to_dicts(top),
    }


@app.get("/api/accounting/monthly")
async def accounting_monthly(from_month: str = "", to_month: str = ""):
    if not to_month:
        to_month = date.today().strftime("%Y-%m")
    parse_month(to_month, "to_month")
    if not from_month:
        to_date = datetime.strptime(to_month + "-01", "%Y-%m-%d").date()
        year = to_date.year
        month = to_date.month - 11
        while month <= 0:
            year -= 1
            month += 12
        from_month = f"{year:04d}-{month:02d}"
    parse_month(from_month, "from_month")
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
              substr(txn_date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0) AS income_total,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0) AS expense_total,
              COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE -amount END), 0) AS net_total
            FROM transactions
            WHERE substr(txn_date, 1, 7) >= ? AND substr(txn_date, 1, 7) <= ?
            GROUP BY substr(txn_date, 1, 7)
            ORDER BY month ASC
            """,
            (from_month, to_month),
        ).fetchall()
    return rows_to_dicts(rows)


@app.get("/api/accounting/by-category")
async def accounting_by_category(
    from_date: str = Query("", alias="from"),
    to_date: str = Query("", alias="to"),
    kind: str = "expense",
):
    kind = validate_kind(kind)
    if not from_date or not to_date:
        month = date.today().strftime("%Y-%m")
        from_date = f"{month}-01"
        to_date = date.today().isoformat()
    from_date = parse_date(from_date, "from")
    to_date = parse_date(to_date, "to")
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT c.id AS category_id, COALESCE(c.name, '未分类') AS category_name, COALESCE(SUM(t.amount), 0) AS total, COUNT(*) AS count
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.kind = ? AND t.txn_date >= ? AND t.txn_date <= ?
            GROUP BY c.id, c.name
            ORDER BY total DESC
            """,
            (kind, from_date, to_date),
        ).fetchall()
    return rows_to_dicts(rows)


@app.get("/api/accounting/by-account")
async def accounting_by_account(
    from_date: str = Query("", alias="from"),
    to_date: str = Query("", alias="to"),
):
    if not from_date or not to_date:
        month = date.today().strftime("%Y-%m")
        from_date = f"{month}-01"
        to_date = date.today().isoformat()
    from_date = parse_date(from_date, "from")
    to_date = parse_date(to_date, "to")
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
              a.id AS account_id,
              COALESCE(a.name, '未指定账户') AS account_name,
              COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0) AS income_total,
              COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS expense_total,
              COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE -t.amount END), 0) AS net_total,
              COUNT(*) AS count
            FROM transactions t
            LEFT JOIN accounts a ON a.id = t.account_id
            WHERE t.txn_date >= ? AND t.txn_date <= ?
            GROUP BY a.id, a.name
            ORDER BY net_total DESC
            """,
            (from_date, to_date),
        ).fetchall()
    return rows_to_dicts(rows)


_FRONTEND = Path(__file__).parent / "frontend"
if _FRONTEND.exists():
    app.mount("/ui", StaticFiles(directory=_FRONTEND, html=True), name="ui")


if __name__ == "__main__":
    if _auth_password() == "change-me" and _auth_enabled():
        print("WARNING: JZ_AUTH_PASSWORD is using the default value. Set a real password before deployment.")
    uvicorn.run(app, host=HOST, port=PORT)
