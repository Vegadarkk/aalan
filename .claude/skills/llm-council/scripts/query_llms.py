#!/usr/bin/env python3
"""
Conseil des IA : interroge ChatGPT et Gemini sur une même question et rend leurs réponses en JSON.

D'après gcpdev/llm-council-skill (MIT, (c) 2026 Gustavo Publio), adapté pour Adil :
- les clés ne vivent jamais dans un dépôt : variables d'environnement, puis ~/cles/llm-council.env,
  puis le fichier désigné par LLM_COUNCIL_ENV, puis .env du dossier courant (en dernier recours) ;
- appel Codex corrigé (`codex exec`, l'option -p de Codex désigne un profil, pas une question) ;
- dépendances : bibliothèque standard uniquement (pas de requests).
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
    candidates.append(Path.home() / "cles" / "llm-council.env")
    candidates.append(Path(".env"))
    values = {}
    for path in candidates:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def setting(name: str, env_file: dict, default: str = "") -> str:
    return os.environ.get(name) or env_file.get(name) or default


def run_cli(cmd: list, timeout: int = 120):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8")
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:
        pass
    return None


def post_json(url: str, payload: dict, headers: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ask_openai(prompt: str, key: str, model: str) -> str:
    try:
        data = post_json("https://api.openai.com/v1/chat/completions",
                         {"model": model, "messages": [{"role": "user", "content": prompt}]},
                         {"Authorization": f"Bearer {key}"})
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Erreur ChatGPT ({model}) : {e}"


def ask_gemini(prompt: str, key: str, model: str) -> str:
    try:
        data = post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                         {"contents": [{"parts": [{"text": prompt}]}]},
                         {"x-goog-api-key": key})
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        return f"Erreur Gemini ({model}) : {e}"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"erreur": "Usage : query_llms.py \"<question>\""}, ensure_ascii=False))
        sys.exit(1)
    prompt = " ".join(sys.argv[1:])
    env_file = load_env_files()
    openai_key = setting("OPENAI_API_KEY", env_file)
    gemini_key = setting("GEMINI_API_KEY", env_file)
    openai_model = setting("OPENAI_MODEL", env_file, "gpt-5-mini")
    gemini_model = setting("GEMINI_MODEL", env_file, "gemini-3-flash-preview")

    chatgpt, chatgpt_src = None, "aucune"
    if shutil.which("codex"):
        chatgpt = run_cli(["codex", "exec", "--skip-git-repo-check", prompt])
        chatgpt_src = "codex-cli" if chatgpt else chatgpt_src
    if chatgpt is None and openai_key:
        chatgpt, chatgpt_src = ask_openai(prompt, openai_key, openai_model), f"api ({openai_model})"
    if chatgpt is None:
        chatgpt = "Indisponible : ni Codex en ligne de commande, ni OPENAI_API_KEY"

    gemini, gemini_src = None, "aucune"
    if shutil.which("gemini"):
        gemini = run_cli(["gemini", "-p", prompt])
        gemini_src = "gemini-cli" if gemini else gemini_src
    if gemini is None and gemini_key:
        gemini, gemini_src = ask_gemini(prompt, gemini_key, gemini_model), f"api ({gemini_model})"
    if gemini is None:
        gemini = "Indisponible : ni Gemini CLI, ni GEMINI_API_KEY"

    print(json.dumps({"question": prompt,
                      "chatgpt": {"source": chatgpt_src, "reponse": chatgpt},
                      "gemini": {"source": gemini_src, "reponse": gemini}},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
