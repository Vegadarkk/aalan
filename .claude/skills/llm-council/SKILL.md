---
name: llm-council
description: Conseil des IA — avant de présenter un plan ou une décision importante, consulter ChatGPT et Gemini, comparer leurs avis avec le mien et rendre un plan synthétisé. À utiliser quand Adil dit « consulte le conseil », « demande à ChatGPT et Gemini », « avis des autres IA », et sur toute décision structurante d'un projet (architecture, choix technique, plan de lancement, arbitrage risqué).
---

# Conseil des IA (llm-council)

D'après gcpdev/llm-council-skill (licence MIT, © 2026 Gustavo Publio), adapté au français et aux règles d'Adil. Adil a demandé le 09/11/2026 que ce skill soit présent dans tous ses projets, actuels et futurs.

## Quand l'utiliser
- Adil le demande : « consulte le conseil », « demande l'avis de ChatGPT et Gemini », « qu'en pensent les autres IA ».
- De moi-même, avant de présenter un plan pour une décision structurante d'un projet : choix d'architecture, migration, plan de lancement, garde-fous du bot de trading, arbitrage difficile à défaire. Pas pour les tâches courantes.

## Déroulé
1. **Préparer la question** : une question autonome, avec le contexte utile (pile technique, contraintes, options envisagées). **Ne jamais y mettre** de secret, clé, mot de passe, donnée personnelle (adresse, santé, finances d'Adil), donnée de candidature ni code privé sensible : la question part chez OpenAI et Google.
2. **Interroger le conseil** : écrire le script ci-dessous dans un fichier temporaire s'il n'est pas déjà dans le dépôt (`.claude/skills/llm-council/scripts/query_llms.py`), puis lancer :
   `python3 query_llms.py "<question>"` (sous Windows : `python query_llms.py "<question>"`).
   Le script essaie d'abord les outils en ligne de commande `codex` et `gemini` s'ils sont installés, sinon les API.
3. **Analyser** : où les deux modèles s'accordent, où ils divergent, ce qu'ils apportent que je n'avais pas vu, ce qui est faux ou daté (vérifier tout fait avancé avant de le reprendre).
4. **Synthétiser** : un plan qui combine le meilleur des trois avis (le mien, ChatGPT, Gemini). Je reste responsable du résultat : un avis majoritaire n'a pas raison pour autant.
5. **Présenter à Adil**, court :
   - le plan recommandé, avec les apports attribués là où ils comptent (« Gemini a soulevé… ») ;
   - « Apports du conseil » : une ligne par modèle ;
   - « Désaccords » s'il y en a, et mon arbitrage.

## Clés et réglages
Les clés ne vont **jamais** dans un dépôt ni dans un fil. Ordre de lecture du script : variables d'environnement, puis le fichier désigné par `LLM_COUNCIL_ENV`, puis `C:\Users\<utilisateur>\cles\llm-council.env` (`~/cles/llm-council.env`), puis `.env` du dossier courant en dernier recours (il doit alors figurer dans `.gitignore`).

Contenu du fichier :
```
OPENAI_API_KEY=
GEMINI_API_KEY=
OPENAI_MODEL=gpt-5-mini
GEMINI_MODEL=gemini-3-flash-preview
```
Obtenir les clés : https://platform.openai.com/api-keys et https://aistudio.google.com/app/apikey. Les appels sont facturés par OpenAI et Google (Gemini a une offre gratuite limitée). Les noms de modèles évoluent : en cas d'erreur « model not found », vérifier les noms actuels sur les pages des fournisseurs.

Dans une session cloud ou planifiée, le réseau peut bloquer api.openai.com ou l'API Gemini : le dire en une ligne et donner mon seul avis.

## Erreurs
- Une clé manque ou un appel échoue : le dire, continuer avec l'avis disponible.
- Les deux échouent : le dire et donner mon analyse seule, sans prétendre avoir consulté le conseil.

## Script `query_llms.py`
```python
#!/usr/bin/env python3
"""Conseil des IA : interroge ChatGPT et Gemini et rend leurs réponses en JSON.
D'après gcpdev/llm-council-skill (MIT, (c) 2026 Gustavo Publio), adapté pour Adil."""
import json, os, shutil, subprocess, sys, urllib.request
from pathlib import Path

def load_env_files():
    candidates = []
    if os.environ.get("LLM_COUNCIL_ENV"):
        candidates.append(Path(os.environ["LLM_COUNCIL_ENV"]))
    candidates += [Path.home() / "cles" / "llm-council.env", Path(".env")]
    values = {}
    for path in candidates:
        if path.is_file():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    values.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return values

def setting(name, env_file, default=""):
    return os.environ.get(name) or env_file.get(name) or default

def run_cli(cmd, timeout=120):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8")
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

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"erreur": 'Usage : query_llms.py "<question>"'}, ensure_ascii=False)); sys.exit(1)
    prompt = " ".join(sys.argv[1:])
    env = load_env_files()
    okey, gkey = setting("OPENAI_API_KEY", env), setting("GEMINI_API_KEY", env)
    omodel = setting("OPENAI_MODEL", env, "gpt-5-mini")
    gmodel = setting("GEMINI_MODEL", env, "gemini-3-flash-preview")
    chatgpt, csrc = None, "aucune"
    if shutil.which("codex"):
        chatgpt = run_cli(["codex", "exec", "--skip-git-repo-check", prompt]); csrc = "codex-cli" if chatgpt else csrc
    if chatgpt is None and okey:
        chatgpt, csrc = ask_openai(prompt, okey, omodel), f"api ({omodel})"
    chatgpt = chatgpt or "Indisponible : ni Codex en ligne de commande, ni OPENAI_API_KEY"
    gemini, gsrc = None, "aucune"
    if shutil.which("gemini"):
        gemini = run_cli(["gemini", "-p", prompt]); gsrc = "gemini-cli" if gemini else gsrc
    if gemini is None and gkey:
        gemini, gsrc = ask_gemini(prompt, gkey, gmodel), f"api ({gmodel})"
    gemini = gemini or "Indisponible : ni Gemini CLI, ni GEMINI_API_KEY"
    print(json.dumps({"question": prompt, "chatgpt": {"source": csrc, "reponse": chatgpt},
                      "gemini": {"source": gsrc, "reponse": gemini}}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
```
