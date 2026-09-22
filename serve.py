# -*- coding: utf-8 -*-
"""שרת מקומי: דפי המחברת, שירי משנת חיים, עזרים ומבחנים."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from datetime import datetime
import json
import os
import re
import shutil
import sys
import urllib.parse
import webbrowser

ROOT = Path(__file__).resolve().parent
MEDIA = Path(r"C:\Users\User\OneDrive\Desktop\ישיבה תיכונית תשפז\משנה")
MATERIALS = ROOT / "חומרים"
REGISTRY = MATERIALS / "רישום.json"
PORT = 8765
LETTERS = "אבגדהוזחט"
SAFE_NAME = re.compile(r"[^\w\u0590-\u05FF\-_. ]+", re.UNICODE)
YOUTUBE_RE = re.compile(
    r"(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:embed/|shorts/|live/|watch\?(?:[^#]*&)?v=)|[?&]v=)([\w-]{11})",
    re.I,
)


def letter(n):
    return LETTERS[int(n) - 1]


def chapter_dir(perek):
    return MATERIALS / ("פרק " + letter(perek))


def role_dir(perek, role):
    return chapter_dir(perek) / role


def links_path(perek):
    return chapter_dir(perek) / "קישורים.json"


def safe(name):
    name = SAFE_NAME.sub("", Path(name).name).strip() or "קובץ"
    return name[:80]


def send_json(handler, payload, code=200):
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def read_json_file(path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def write_json_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def pdf_to_pages(pdf_path, dest):
    import pymupdf

    dest.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    mat = pymupdf.Matrix(2.0, 2.0)
    pages = []
    for i, page in enumerate(doc):
        name = "p%02d.jpg" % (i + 1)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(dest / name, jpg_quality=88)
        pages.append(name)
    return pages


def item_from_meta(meta_path, role, perek):
    meta = read_json_file(meta_path, None)
    if not meta:
        return None
    rel = meta_path.parent.relative_to(ROOT).as_posix()
    pages = ["/%s/%s" % (rel, p) for p in meta.get("pages") or []]
    file_url = ("/%s/%s" % (rel, meta["file"])) if meta.get("file") else ""
    return {
        "id": meta.get("id") or rel,
        "name": meta.get("name") or meta_path.parent.name,
        "role": meta.get("role") or role,
        "type": meta.get("type") or "pages",
        "pages": pages,
        "file": file_url,
        "path": rel,
        "perek": int(meta.get("perek") or perek),
        "mishnayot": meta.get("mishnayot") or [],
    }


def collect_chapter(perek):
    items = []
    seen = set()
    base = chapter_dir(perek)
    for role in ("עזרים", "מבחנים"):
        folder = base / role
        if not folder.exists():
            continue
        for meta_path in folder.rglob("meta.json"):
            item = item_from_meta(meta_path, role, perek)
            if not item or item["id"] in seen:
                continue
            seen.add(item["id"])
            items.append(item)
    for link in read_json_file(links_path(perek), []):
        if link.get("id") in seen:
            continue
        seen.add(link.get("id"))
        link = dict(link)
        link["perek"] = perek
        items.append(link)
    return items


def write_registry():
    items = []
    if MATERIALS.exists():
        for folder in MATERIALS.glob("פרק *"):
            name = folder.name.replace("פרק ", "")
            if name not in LETTERS:
                continue
            items.extend(collect_chapter(LETTERS.index(name) + 1))
    write_json_file(REGISTRY, {"items": items})
    return items


def list_materials(perek, mish):
    return collect_chapter(perek)


def parse_multipart(handler):
    ctype = handler.headers.get("Content-Type", "")
    length = int(handler.headers.get("Content-Length", "0") or 0)
    body = handler.rfile.read(length)
    match = re.search(r"boundary=([^;]+)", ctype)
    if not match:
        return {}, {}
    boundary = match.group(1).strip().strip('"').encode("ascii", "ignore")
    fields = {}
    files = {}
    for part in body.split(b"--" + boundary):
        if not part or part in (b"--\r\n", b"--", b"--\n"):
            continue
        if part.startswith(b"--"):
            continue
        head, sep, data = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        data = data.rstrip(b"\r\n")
        header = head.decode("utf-8", "replace")
        name_m = re.search(r'name="([^"]+)"', header)
        if not name_m:
            continue
        name = name_m.group(1)
        file_m = re.search(r'filename="([^"]*)"', header)
        if file_m:
            files[name] = {"filename": file_m.group(1), "data": data}
        else:
            fields[name] = data.decode("utf-8", "replace")
    return fields, files


def youtube_id(url):
    found = YOUTUBE_RE.search(url or "")
    return found.group(1) if found else ""


def unique_folder(parent, stem):
    dest = parent / stem
    if not dest.exists():
        return dest
    stamp = datetime.now().strftime("%H%M%S")
    return parent / (stem + " " + stamp)


def save_file_item(perek, role, raw_name, data, mish=None):
    name = safe(raw_name)
    folder = unique_folder(role_dir(perek, role), Path(name).stem)
    folder.mkdir(parents=True, exist_ok=True)
    original = folder / name
    original.write_bytes(data)
    ext = original.suffix.lower()
    pages = []
    kind = "file"
    if ext == ".pdf":
        pages = pdf_to_pages(original, folder)
        kind = "pages"
    elif ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        pages = [name]
        kind = "pages"
    elif ext in (".mp4", ".webm", ".mov", ".m4v"):
        kind = "video"
    mishnayot = [int(mish)] if mish else []
    meta = {
        "id": folder.name,
        "name": name,
        "role": role,
        "type": kind,
        "pages": pages,
        "file": name,
        "perek": int(perek),
        "mishnayot": mishnayot,
    }
    write_json_file(folder / "meta.json", meta)
    write_registry()
    return meta


def remove_empty_dirs(path):
    if not path.exists() or not path.is_dir():
        return
    for child in list(path.iterdir()):
        if child.is_dir():
            remove_empty_dirs(child)
    try:
        next(path.iterdir())
    except StopIteration:
        if path != MATERIALS:
            path.rmdir()


def migrate_nested():
    if not MATERIALS.exists():
        return
    for perek_dir in MATERIALS.glob("פרק *"):
        for mish_path in list(perek_dir.glob("משנה *")):
            for role in ("עזרים", "מבחנים"):
                src_role = mish_path / role
                if not src_role.exists():
                    continue
                dest_role = perek_dir / role
                dest_role.mkdir(parents=True, exist_ok=True)
                for item in list(src_role.iterdir()):
                    dest = dest_role / item.name
                    if dest.exists():
                        continue
                    try:
                        shutil.move(str(item), str(dest))
                    except OSError:
                        if item.is_dir():
                            shutil.copytree(item, dest, dirs_exist_ok=True)
                        else:
                            shutil.copy2(item, dest)
            old_links = mish_path / "קישורים.json"
            if old_links.exists():
                dest_links = perek_dir / "קישורים.json"
                merged = read_json_file(dest_links, []) + read_json_file(old_links, [])
                uniq = []
                seen = set()
                for link in merged:
                    key = link.get("id") or link.get("youtubeId")
                    if key in seen:
                        continue
                    seen.add(key)
                    uniq.append(link)
                write_json_file(dest_links, uniq)
                old_links.unlink()
            remove_empty_dirs(mish_path)


def already_imported(name):
    if not MATERIALS.exists():
        return False
    for meta_path in MATERIALS.rglob("meta.json"):
        meta = read_json_file(meta_path, {})
        if meta.get("name") == name or meta_path.parent.name == Path(name).stem:
            return True
    return False


def import_known_worksheets():
    known = [
        (MEDIA / "דף עבודה - מסכת ברכות, פרק א' משניות א'-ב'.pdf", 1, "עזרים"),
    ]
    for src, perek, role in known:
        if not src.exists() or already_imported(src.name):
            continue
        save_file_item(perek, role, src.name, src.read_bytes())


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urllib.parse.unquote(urllib.parse.urlparse(path).path)
        if parsed.startswith("/media/"):
            rel = Path(parsed[len("/media/") :])
            if ".." in rel.parts:
                return str(ROOT / "missing")
            target = (MEDIA / rel).resolve()
            try:
                target.relative_to(MEDIA.resolve())
            except ValueError:
                return str(ROOT / "missing")
            return str(target)
        return super().translate_path(path)

    def end_headers(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path.startswith("/media/") or path.startswith("/חומרים/") or path.startswith("/שירים/"):
            self.send_header("Content-Disposition", "inline")
            self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/materials":
            q = urllib.parse.parse_qs(parsed.query)
            try:
                perek = int(q.get("perek", ["1"])[0])
                mish = int(q.get("mish", ["1"])[0])
            except ValueError:
                return send_json(self, {"items": []}, 400)
            return send_json(self, {"items": list_materials(perek, mish)})
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/upload":
            fields, files = parse_multipart(self)
            upload = files.get("file")
            if not upload or not upload.get("data"):
                return send_json(self, {"ok": False, "error": "חסר קובץ"}, 400)
            try:
                perek = int(fields.get("perek", "1"))
                mish = fields.get("mish")
                mish = int(mish) if mish else None
            except ValueError:
                return send_json(self, {"ok": False}, 400)
            role = fields.get("role", "עזרים")
            if role not in ("עזרים", "מבחנים"):
                role = "עזרים"
            meta = save_file_item(perek, role, upload["filename"] or fields.get("name") or "קובץ", upload["data"], mish)
            return send_json(self, {"ok": True, "item": meta})

        if parsed.path == "/api/youtube":
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return send_json(self, {"ok": False}, 400)
            vid = youtube_id(body.get("url", ""))
            if not vid:
                return send_json(self, {"ok": False, "error": "לא זוהה קישור יוטיוב"}, 400)
            perek = int(body.get("perek", 1))
            dest = links_path(perek)
            links = read_json_file(dest, [])
            item = {
                "id": "yt-" + vid + "-" + datetime.now().strftime("%H%M%S"),
                "name": body.get("title") or "סרטון יוטיוב",
                "role": "youtube",
                "type": "youtube",
                "youtubeId": vid,
                "url": "https://www.youtube.com/watch?v=" + vid,
                "perek": perek,
            }
            links.append(item)
            write_json_file(dest, links)
            write_registry()
            return send_json(self, {"ok": True, "item": item})

        if parsed.path == "/api/delete":
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return send_json(self, {"ok": False}, 400)
            if body.get("youtubeId"):
                dest = links_path(int(body.get("perek") or 1))
                links = [x for x in read_json_file(dest, []) if x.get("id") != body.get("id")]
                write_json_file(dest, links)
                write_registry()
                return send_json(self, {"ok": True})
            rel = body.get("path") or ""
            target = (ROOT / rel).resolve()
            try:
                target.relative_to(MATERIALS.resolve())
            except ValueError:
                return send_json(self, {"ok": False}, 400)
            if target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
            elif target.exists():
                target.unlink()
            write_registry()
            return send_json(self, {"ok": True})

        self.send_error(404)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    MATERIALS.mkdir(exist_ok=True)
    try:
        migrate_nested()
    except Exception as exc:
        print("migrate skip", exc, flush=True)
    try:
        import_known_worksheets()
        write_registry()
    except Exception as exc:
        print("materials keep", exc, flush=True)
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = "http://127.0.0.1:%s/" % PORT
    print("Open", url, flush=True)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("closed")
