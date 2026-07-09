#!/usr/bin/env python3
"""
Busca capa jornalística para matérias gospel quando a API Node não encontra imagem.

Entrada (stdin JSON):
  titulo, resumo, titulo_referencia, url_fonte, termos_busca[], assunto_imagem, pessoa_principal

Saída (stdout JSON):
  {"ok": true, "imagem": "/uploads/...", "alt": "..."}
  {"ok": false, "erro": "..."}
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image

try:
    from duckduckgo_search import DDGS
except ImportError:
    DDGS = None

ROOT = Path(__file__).resolve().parent.parent
UPLOADS = ROOT / "uploads"
USER_AGENT = "Mozilla/5.0 (compatible; SiteGospelBot/1.0; +https://gitlab.com/perfilcursor07-group/obuxixo)"


def carregar_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        chave, _, valor = line.partition("=")
        chave, valor = chave.strip(), valor.strip()
        if chave and chave not in os.environ:
            os.environ[chave] = valor

STOPWORDS = {
    "sobre", "nova", "novo", "mais", "como", "para", "pela", "pelo", "entre",
    "apos", "show", "noite", "diz", "que", "com", "uma", "seu", "sua", "gospel",
    "evangelico", "igreja", "culto", "louvor", "brasil", "evento", "programacao",
    "anuncia", "promete", "historica", "historico", "atracoes", "atracao",
}

BLOQUEADOS = {
    "crunchyroll", "anime", "manga", "cartoon", "naruto", "wallpaper", "wallpapers",
    "pixiv", "deviantart", "pinterest", "hentai", "netflix", "disney", "funimation",
    "stock-photo", "shutterstock", "getty", "istockphoto", "placeholder", "logo",
    "favicon", "avatar", "1x1", "pixel",
    "peaky", "blinders", "cillian", "murphy", "imdb", "tmdb", "fanart", "tumblr",
    "unsplash", "pexels", "wallhaven", "artstation", "hollywood", "celebrity",
}

DOMINIOS_BLOQUEADOS = (
    "crunchyroll.com", "pixiv.net", "pinterest.com", "deviantart.com",
    "wallpaper", "myanimelist.net", "imdb.com", "tmdb.org", "reddit.com",
    "tumblr.com", "unsplash.com", "pexels.com", "wallhaven.cc",
)

FAMOSOS_GOSPEL = (
    "silas malafaia", "marcos feliciano", "edir macedo", "valdemiro santiago",
    "evandro guedes", "damares alves", "fernandinho", "priscilla alcantara",
    "bispo macedo", "marcelo crivella", "romildo ribeiro", "deive leonardo",
)
SOBRENOMES_FAMOSOS = ("malafaia", "feliciano", "valdemiro", "macedo", "damares")


def sanitizar_texto(texto: str) -> str:
    if not isinstance(texto, str):
        return "" if texto is None else str(texto)
    return re.sub(r"[\ud800-\udfff]", "", texto)


def sanitizar_payload(obj):
    if isinstance(obj, str):
        return sanitizar_texto(obj)
    if isinstance(obj, list):
        return [sanitizar_payload(x) for x in obj]
    if isinstance(obj, dict):
        return {k: sanitizar_payload(v) for k, v in obj.items()}
    return obj


def emitir_json(data: dict) -> None:
    texto = json.dumps(data, ensure_ascii=False)
    sys.stdout.buffer.write(texto.encode("utf-8", errors="replace"))
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()


def normalizar(texto: str) -> str:
    if not texto:
        return ""
    t = unicodedata.normalize("NFD", texto)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-zA-Z0-9\s]", " ", t.lower())
    return re.sub(r"\s+", " ", t).strip()


def extrair_termos(titulo: str, resumo: str, titulo_ref: str, conteudo: str = "") -> list[str]:
    texto = f"{titulo} {resumo} {titulo_ref} {conteudo[:1500] if conteudo else ''}"
    termos = set()
    for n in re.findall(r"\b\d{2,4}\b", texto):
        termos.add(n)
    for m in re.findall(r"\b[A-ZÀ-Ú][\wà-ú]*(?:ão|zão)?\b", texto):
        n = normalizar(m)
        if len(n) > 3 and n not in STOPWORDS:
            termos.add(n)
    for p in normalizar(texto).split():
        if len(p) > 3 and p not in STOPWORDS:
            termos.add(p)
    return list(termos)[:12]


def url_proibida(url: str) -> bool:
    lower = (url or "").lower()
    if any(b in lower for b in BLOQUEADOS):
        return True
    if any(d in lower for d in DOMINIOS_BLOQUEADOS):
        return True
    return False


def texto_materia(titulo: str, resumo: str, titulo_ref: str, conteudo: str = "") -> str:
    return normalizar(f"{titulo} {resumo} {titulo_ref} {conteudo[:1500] if conteudo else ''}")


def materia_anonima(titulo: str, resumo: str, titulo_ref: str, conteudo: str = "") -> bool:
    t = texto_materia(titulo, resumo, titulo_ref, conteudo)
    return bool(re.search(
        r"\b(nome nao divulgado|ex lider|ex criminoso|gangue|facao|faccao|anonimo|desconhecido)\b",
        t,
    ))


def famoso_citado(famoso: str, titulo: str, resumo: str, titulo_ref: str, conteudo: str = "") -> bool:
    materia = texto_materia(titulo, resumo, titulo_ref, conteudo)
    partes = [p for p in normalizar(famoso).split() if len(p) > 2]
    if len(partes) >= 2:
        return partes[0] in materia and partes[-1] in materia
    return len(partes) == 1 and partes[0] in materia


def imagem_pessoa_inadequada(meta: str, titulo: str, resumo: str, titulo_ref: str, conteudo: str = "") -> bool:
    norm = normalizar(meta)
    for famoso in FAMOSOS_GOSPEL:
        fn = normalizar(famoso)
        if fn in norm or fn.replace(" ", "-") in norm or fn.replace(" ", "") in norm:
            if not famoso_citado(famoso, titulo, resumo, titulo_ref, conteudo):
                return True
    for sobrenome in SOBRENOMES_FAMOSOS:
        if sobrenome in norm and not famoso_citado(sobrenome, titulo, resumo, titulo_ref, conteudo):
            return True
    if materia_anonima(titulo, resumo, titulo_ref, conteudo) and any(s in norm for s in SOBRENOMES_FAMOSOS):
        return True
    return False


def pagina_combina_materia(texto: str, titulo: str, resumo: str, titulo_ref: str) -> bool:
    norm = normalizar(texto)
    palavras = list(dict.fromkeys(
        p for p in normalizar(f"{titulo} {resumo} {titulo_ref}").split()
        if len(p) > 3 and p not in STOPWORDS
    ))
    if not palavras:
        return False
    acertos = [p for p in palavras if p in norm]
    fortes = [p for p in palavras if len(p) > 5 or p.isdigit()]
    acertos_fortes = [p for p in fortes if p in norm]
    if acertos_fortes and len(acertos) >= 2:
        return True
    minimo = min(3, max(2, (len(palavras) + 2) // 3))
    return len(acertos) >= minimo


def combina_materia(texto: str, termos: list[str], pessoa: str | None) -> bool:
    if url_proibida(texto):
        return False
    norm = normalizar(texto)
    if pessoa:
        partes = normalizar(pessoa).split()
        if len(partes) >= 2 and partes[0] in norm and partes[-1] in norm:
            return True
    if not termos:
        return True
    acertos = [t for t in termos if t in norm]
    fortes = [t for t in termos if len(t) > 4 or t.isdigit()]
    if any(t in norm for t in fortes) and len(acertos) >= 2:
        return True
    return len(acertos) >= min(3, max(2, len(termos) // 2))


def extrair_og_images(html: str, base_url: str) -> list[str]:
    urls = []
    soup = BeautifulSoup(html, "html.parser")
    for prop in ("og:image", "og:image:secure_url", "twitter:image"):
        for tag in soup.find_all("meta", property=prop):
            u = tag.get("content")
            if u:
                urls.append(urljoin(base_url, u))
        for tag in soup.find_all("meta", attrs={"name": prop}):
            u = tag.get("content")
            if u:
                urls.append(urljoin(base_url, u))
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if src and not src.startswith("data:"):
            urls.append(urljoin(base_url, src))
    vistos = set()
    out = []
    for u in urls:
        if u not in vistos and not url_proibida(u):
            vistos.add(u)
            out.append(u)
    return out[:8]


def fetch_page(url: str, timeout: int = 12) -> tuple[str | None, str | None]:
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout, allow_redirects=True)
        if r.ok:
            return r.text, r.url
    except requests.RequestException:
        pass
    return None, None


def imagens_da_fonte(url: str) -> list[dict]:
    html, final = fetch_page(url)
    if not html or not final:
        return []
    imgs = extrair_og_images(html, final)
    return [{"url": u, "title": "", "source": final, "from_fonte": True} for u in imgs]


def brave_web(query: str, api_key: str, count: int = 5) -> list[dict]:
    try:
        r = requests.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": count, "country": "BR", "search_lang": "pt-br"},
            headers={"Accept": "application/json", "X-Subscription-Token": api_key},
            timeout=12,
        )
        if not r.ok:
            return []
        candidatos = []
        for item in r.json().get("web", {}).get("results", []):
            page_url = item.get("url")
            if not page_url:
                continue
            html, final = fetch_page(page_url)
            if not html:
                continue
            for u in extrair_og_images(html, final or page_url):
                candidatos.append({
                    "url": u,
                    "title": item.get("title") or "",
                    "source": final or page_url,
                    "from_noticia": True,
                })
        return candidatos
    except requests.RequestException:
        return []


def brave_images(query: str, api_key: str, count: int = 15) -> list[dict]:
    try:
        r = requests.get(
            "https://api.search.brave.com/res/v1/images/search",
            params={"q": query, "count": count, "country": "BR", "spellcheck": "1"},
            headers={"Accept": "application/json", "X-Subscription-Token": api_key},
            timeout=12,
        )
        if not r.ok:
            return []
        out = []
        for item in r.json().get("results", []):
            u = (item.get("properties") or {}).get("url") or (item.get("thumbnail") or {}).get("src")
            if u:
                out.append({
                    "url": u,
                    "title": item.get("title") or "",
                    "source": item.get("url") or "",
                    "from_web": True,
                })
        return out
    except requests.RequestException:
        return []


def duckduckgo_images(query: str, max_results: int = 12) -> list[dict]:
    if not DDGS:
        return []
    try:
        out = []
        with DDGS() as ddgs:
            for r in ddgs.images(query, region="br-pt", safesearch="off", max_results=max_results):
                u = r.get("image") or r.get("thumbnail")
                if u:
                    out.append({
                        "url": u,
                        "title": r.get("title") or "",
                        "source": r.get("url") or "",
                        "from_web": True,
                    })
        return out
    except Exception:
        return []


def pontuar(c: dict, termos: list[str]) -> int:
    texto = normalizar(f"{c.get('title', '')} {c.get('url', '')} {c.get('source', '')}")
    score = 0
    if c.get("from_fonte"):
        score -= 50
    if c.get("from_noticia"):
        score -= 30
    for t in termos:
        if t in texto:
            score -= 10
    if url_proibida(c.get("url", "")):
        score += 200
    return score


def baixar_webp(url: str, referer: str = "") -> str | None:
    if url_proibida(url):
        return None
    try:
        r = requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "image/*",
                "Referer": referer or "",
            },
            timeout=20,
            allow_redirects=True,
        )
        if not r.ok:
            return None
        ct = (r.headers.get("content-type") or "").lower()
        if not ct.startswith("image/"):
            return None
        data = r.content
        if len(data) < 2500 or len(data) > 8 * 1024 * 1024:
            return None

        UPLOADS.mkdir(parents=True, exist_ok=True)
        nome = f"ai-py-{int(time.time())}-{os.urandom(3).hex()}.webp"
        dest = UPLOADS / nome

        img = Image.open(BytesIO(data))
        img = img.convert("RGB") if img.mode in ("RGBA", "P") else img
        img.thumbnail((1600, 1200), Image.Resampling.LANCZOS)
        img.save(dest, "WEBP", quality=82, method=4)
        return f"/uploads/{nome}"
    except Exception:
        return None


def montar_alt(titulo: str, assunto: str, pessoa: str | None) -> str:
    if assunto:
        alt = assunto.strip()
    elif pessoa:
        alt = f"{pessoa} — {titulo}"
    else:
        alt = titulo
    return alt[:125]


def coletar_candidatos(payload: dict) -> list[dict]:
    payload = sanitizar_payload(payload)
    titulo = payload.get("titulo") or ""
    resumo = payload.get("resumo") or ""
    conteudo = payload.get("conteudo") or ""
    titulo_ref = payload.get("titulo_referencia") or titulo
    url_fonte = payload.get("url_fonte") or ""
    assunto = payload.get("assunto_imagem") or ""
    termos_extra = payload.get("termos_busca") or []

    termos = list(dict.fromkeys(extrair_termos(titulo, resumo, titulo_ref, conteudo) + termos_extra))
    brave_key = os.environ.get("BRAVE_SEARCH_API_KEY", "")

    candidatos: list[dict] = []
    vistos = set()

    def add_lista(items: list[dict]):
        for c in items:
            u = c.get("url")
            if not u or u in vistos:
                continue
            vistos.add(u)
            candidatos.append(c)

    if url_fonte:
        add_lista(imagens_da_fonte(url_fonte))

    consultas = list(dict.fromkeys([
        titulo_ref,
        titulo,
        f'"{titulo_ref}"' if titulo_ref else "",
        f'"{titulo}"' if titulo and titulo != titulo_ref else "",
        assunto,
        *termos_extra[:4],
    ]))
    ctx = normalizar(f"{titulo} {resumo}")
    if re.search(r"gangue|facao|faccao|criminoso|profecia|soterrados", ctx):
        consultas = [q for q in [titulo, titulo_ref, f'"{titulo}"', assunto] if q and len(q.strip()) > 4]
    else:
        consultas = [q for q in consultas if q and len(q.strip()) > 4]

    if brave_key:
        for q in consultas[:5]:
            add_lista(brave_web(q, brave_key))
        for q in consultas[:3]:
            add_lista(brave_images(q, brave_key, count=20))

    for q in consultas[:3]:
        add_lista(duckduckgo_images(q, max_results=15))

    return candidatos


def listar(payload: dict) -> dict:
    candidatos = coletar_candidatos(payload)
    titulo = payload.get("titulo") or ""
    resumo = payload.get("resumo") or ""
    conteudo = payload.get("conteudo") or ""

    filtrados = [
        c for c in candidatos
        if c.get("url") and not url_proibida(c.get("url", ""))
        and not imagem_pessoa_inadequada(
            f"{c.get('title', '')} {c.get('url', '')} {c.get('source', '')}",
            titulo, resumo, titulo, conteudo
        )
    ]

    if not filtrados:
        return {"ok": False, "erro": "Nenhuma imagem encontrada na busca web."}

    termos = extrair_termos(titulo, resumo, titulo, conteudo)
    filtrados.sort(key=lambda c: pontuar(c, termos))

    saida = []
    for c in filtrados[:30]:
        u = c.get("url", "")
        saida.append({
            "url": u,
            "preview": u,
            "title": (c.get("title") or "")[:200],
            "source": c.get("source") or "",
        })

    return {"ok": True, "candidatos": saida}


def buscar(payload: dict) -> dict:
    payload = sanitizar_payload(payload)
    titulo = payload.get("titulo") or ""
    resumo = payload.get("resumo") or ""
    conteudo = payload.get("conteudo") or ""
    titulo_ref = payload.get("titulo_referencia") or titulo
    url_fonte = payload.get("url_fonte") or ""
    assunto = payload.get("assunto_imagem") or ""
    pessoa = payload.get("pessoa_principal")
    termos_extra = payload.get("termos_busca") or []

    termos = list(dict.fromkeys(extrair_termos(titulo, resumo, titulo_ref, conteudo) + termos_extra))
    candidatos = coletar_candidatos(payload)

    def candidato_valido(c: dict) -> bool:
        meta = f"{c.get('title', '')} {c.get('url', '')} {c.get('source', '')}"
        if imagem_pessoa_inadequada(meta, titulo, resumo, titulo_ref, conteudo):
            return False
        if url_proibida(c.get("url", "")):
            return False
        if c.get("from_fonte") or c.get("from_noticia"):
            return pagina_combina_materia(meta, titulo, resumo, titulo_ref) or combina_materia(meta, termos, pessoa)
        return combina_materia(meta, termos, pessoa)

    filtrados = [c for c in candidatos if candidato_valido(c)]

    if not filtrados:
        return {"ok": False, "erro": "Nenhuma imagem adequada encontrada pelo buscador Python."}

    filtrados.sort(key=lambda c: pontuar(c, termos))

    for c in filtrados[:15]:
        salva = baixar_webp(c["url"], c.get("source") or "")
        if salva:
            return {
                "ok": True,
                "imagem": salva,
                "alt": montar_alt(titulo, assunto, pessoa),
                "fonte": c.get("source") or c["url"],
            }

    return {"ok": False, "erro": "Nenhuma imagem adequada encontrada pelo buscador Python."}


def main():
    try:
        carregar_env()
        raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
        payload = json.loads(raw) if raw.strip() else {}
        payload = sanitizar_payload(payload)
        if payload.get("modo") == "listar":
            result = listar(payload)
        else:
            result = buscar(payload)
        emitir_json(result)
        sys.exit(0 if result.get("ok") else 1)
    except Exception as e:
        emitir_json({"ok": False, "erro": sanitizar_texto(str(e))})
        sys.exit(1)


if __name__ == "__main__":
    main()
