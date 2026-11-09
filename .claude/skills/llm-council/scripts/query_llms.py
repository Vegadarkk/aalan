#!/usr/bin/env python3
"""
Conseil des IA : interroge plusieurs modèles sur une même question et rend leurs réponses en JSON.

D'après gcpdev/llm-council-skill (MIT, (c) 2026 Gustavo Publio), adapté pour Adil.
Modes :
  --payant  : ChatGPT + Gemini (clés OpenAI/Gemini, ou CLI codex/gemini)
  --gratuit : panel de modèles gratuits via freellmpool (0xzr/freellmpool, MIT)
  --complet : les deux
  (défaut)  : payant si une clé payante existe, sinon gratuit
Clés : variables d'environnement, puis LLM_COUNCIL_ENV, puis ~/cles/llm-council.env, puis .env.
Le mode gratuit envoie la question à des fournisseurs gratuits qui peuvent l'utiliser pour
l'entraînement : réservé aux sujets non critiques, sans donnée personnelle ni secret.
"""

import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


def load_env_files() -> dict:
    candidates = []
    if os.environ.get("LLM_COUNCIL_ENV"):
        candidates.append(Path(os.environ["LLM_COUNCIL_ENV"]))
    candidates += [Path.home() / "cles" / "llm-council.env", Path(".env")]
    values = {}
    for path in candidates:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                value = value.strip().strip('"').strip("'")
                if value:
                    values.setdefault(key.strip(), value)
    return values


def setting(name, env_file, default=""):
    return os.environ.get(name) or env_file.get(name) or default


def run_cli(cmd, timeout=180, env=None):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                             encoding="utf-8", env=env)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:
        pass
    return None


def post_json(url, payload, headers, timeout=90):
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ask_openai(prompt, key, model):
    try:
        d = post_json("https://api.openai.com/v1/chat/completions",
                      {"model": model, "messages": [{"role": "user", "content": prompt}]},
                      {"Authorization": f"Bearer {key}"})
        return d["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Erreur ChatGPT ({model}) : {e}"


def ask_gemini(prompt, key, model):
    try:
        d = post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                      {"contents": [{"parts": [{"text": prompt}]}]}, {"x-goog-api-key": key})
        return d["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        return f"Erreur Gemini ({model}) : {e}"


def paid_council(prompt, env):
    okey, gkey = setting("OPENAI_API_KEY", env), setting("GEMINI_API_KEY", env)
    omodel = setting("OPENAI_MODEL", env, "gpt-5-mini")
    gmodel = setting("GEMINI_MODEL", env, "gemini-3-flash-preview")
    out = {}
    chatgpt, src = None, "aucune"
    if shutil.which("codex"):
        chatgpt = run_cli(["codex", "exec", "--skip-git-repo-check", prompt])
        src = "codex-cli" if chatgpt else src
    if chatgpt is None and okey:
        chatgpt, src = ask_openai(prompt, okey, omodel), f"api ({omodel})"
    out["chatgpt"] = {"source": src, "reponse": chatgpt or "Indisponible : ni Codex, ni OPENAI_API_KEY"}
    gemini, src = None, "aucune"
    if shutil.which("gemini"):
        gemini = run_cli(["gemini", "-p", prompt])
        src = "gemini-cli" if gemini else src
    if gemini is None and gkey:
        gemini, src = ask_gemini(prompt, gkey, gmodel), f"api ({gmodel})"
    out["gemini"] = {"source": src, "reponse": gemini or "Indisponible : ni Gemini CLI, ni GEMINI_API_KEY"}
    return out


def run_raw(cmd, timeout=300, env=None):
    """Rend la sortie même en cas de code retour non nul (le panel liste ses échecs)."""
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                             encoding="utf-8", env=env)
        return out.returncode, out.stdout.strip()
    except Exception as e:
        return 99, f"{e}"


def free_council(prompt, env, opinions):
    """Panel de modèles gratuits via freellmpool (CLI installée, sinon uvx).
    Si tout le panel échoue, une question simple avec bascule automatique sur tous les fournisseurs."""
    if shutil.which("freellmpool"):
        base = ["freellmpool"]
    elif shutil.which("uvx"):
        base = ["uvx", "freellmpool"]
    else:
        return {"source": "aucune",
                "reponse": "freellmpool absent : `pip install freellmpool` (ou installer uv pour `uvx freellmpool`)"}
    child_env = {**os.environ, **env}  # transmet les clés gratuites (GROQ_API_KEY, OPENROUTER_API_KEY…)
    rc, panel = run_raw(base + ["ask", "--second-opinion", "--opinions", str(opinions), prompt], timeout=150, env=child_env)
    if rc != 99 and panel and panel.count("(failed)") < opinions:
        return {"source": "freellmpool --second-opinion", "reponse": panel}
    rc2, single = run_raw(base + ["ask", "--routing", "quality", prompt], timeout=120, env=child_env)
    if rc2 == 0 and single:
        return {"source": "freellmpool ask (panel indisponible, un seul modèle gratuit)", "reponse": single,
                "panel_echoue": panel}
    return {"source": "freellmpool", "reponse": "Échec : aucun fournisseur gratuit n'a répondu "
            "(quotas épuisés, clés manquantes ou réseau bloqué). Ajouter des clés gratuites dans llm-council.env.",
            "detail": panel[-1500:]}


def main():
    args = sys.argv[1:]
    mode = None
    opinions = 3
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--gratuit", "--payant", "--complet"):
            mode = a[2:]
        elif a == "--avis" and i + 1 < len(args):
            opinions = max(2, min(5, int(args[i + 1]))); i += 1
        else:
            rest.append(a)
        i += 1
    if not rest:
        print(json.dumps({"erreur": 'Usage : query_llms.py [--gratuit|--payant|--complet] [--avis N] "<question>"'},
                         ensure_ascii=False))
        sys.exit(1)
    prompt = " ".join(rest)
    env = load_env_files()
    has_paid = any(setting(k, env) for k in ("OPENAI_API_KEY", "GEMINI_API_KEY")) \
        or shutil.which("codex") or shutil.which("gemini")
    if mode is None:
        mode = "payant" if has_paid else "gratuit"

    result = {"question": prompt, "mode": mode}
    if mode in ("payant", "complet"):
        result.update(paid_council(prompt, env))
    if mode in ("gratuit", "complet"):
        result["gratuits"] = free_council(prompt, env, opinions)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
