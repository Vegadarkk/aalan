---
name: llm-council
description: Conseil des IA — avant de présenter un plan ou une décision importante, consulter d'autres modèles (ChatGPT et Gemini, ou un panel de modèles gratuits via freellmpool), comparer leurs avis avec le mien et rendre un plan synthétisé. À utiliser quand Adil dit « consulte le conseil », « demande à ChatGPT et Gemini », « avis des autres IA », et sur toute décision structurante d'un projet.
---

# Conseil des IA (llm-council)

D'après gcpdev/llm-council-skill (licence MIT, © 2026 Gustavo Publio), adapté au français et aux règles d'Adil, avec un mode gratuit fondé sur 0xzr/freellmpool (licence MIT). Adil a demandé le 09/11/2026 que ce skill soit présent dans tous ses projets, actuels et futurs, et a validé le mode gratuit le même jour pour les sujets non critiques.

## Quand l'utiliser
- Adil le demande : « consulte le conseil », « demande l'avis de ChatGPT et Gemini », « qu'en pensent les autres IA ».
- De moi-même, avant de présenter un plan pour une décision structurante d'un projet : choix d'architecture, migration, plan de lancement, garde-fous du bot de trading, arbitrage difficile à défaire. Pas pour les tâches courantes.

## Choisir le mode
- **`--gratuit`** : un avis par fournisseur gratuit disponible, interrogés en parallèle : Gemini, Groq, OpenRouter, NVIDIA, Mistral, Hugging Face (chacun seulement si sa clé est dans llm-council.env) et LLM7 (sans clé). Le script lit EN DIRECT la liste des modèles de chaque fournisseur et prend le meilleur disponible, puis bascule sur le suivant en cas d'échec : les modèles retirés ne cassent plus le panel. freellmpool ne sert plus qu'en dernier recours. **Uniquement pour les sujets non critiques** : ces fournisseurs peuvent garder la question et s'en servir pour entraîner leurs modèles. Adil l'accepte pour ce type de sujet.
- **`--payant`** : ChatGPT + Gemini avec les clés d'Adil. Pour les sujets sensibles d'un projet (sans jamais de secret ni de donnée personnelle).
- **`--complet`** : les deux, pour les décisions les plus lourdes.
- Sans option : payant si une clé OpenAI ou Gemini existe, sinon gratuit.
- `--avis N` règle la taille du panel gratuit (2 à 5, 5 par défaut : un fournisseur gratuit sur deux peut être en panne à un instant donné).

## Déroulé
1. **Préparer la question** : une question autonome, avec le contexte utile (pile technique, contraintes, options envisagées). **Ne jamais y mettre** de secret, clé, mot de passe, donnée personnelle (adresse, santé, finances d'Adil), donnée de candidature ni code privé sensible : la question part chez des tiers. En mode gratuit, rien qui ne puisse devenir public.
2. **Interroger le conseil** : utiliser `.claude/skills/llm-council/scripts/query_llms.py` s'il est dans le dépôt, sinon écrire le script ci-dessous dans un fichier temporaire, puis lancer :
   `python3 query_llms.py --gratuit "<question>"` (sous Windows : `python ...`).
   Le mode gratuit demande freellmpool : `pip install freellmpool` (ou `uvx freellmpool` si uv est installé). Les outils en ligne de commande `codex` et `gemini`, s'ils sont installés, servent en priorité pour le mode payant.
3. **Analyser** : où les modèles s'accordent, où ils divergent, ce qu'ils apportent que je n'avais pas vu, ce qui est faux ou daté (vérifier tout fait avancé avant de le reprendre). Les modèles gratuits sont souvent plus petits : peser leurs avis en conséquence.
4. **Synthétiser** : un plan qui combine le meilleur des avis et du mien. Je reste responsable du résultat : un avis majoritaire n'a pas raison pour autant.
5. **Présenter à Adil**, court :
   - le plan recommandé, avec les apports attribués là où ils comptent (« Gemini a soulevé… », « deux modèles gratuits sur trois… ») ;
   - « Apports du conseil » : une ligne par modèle, en nommant le modèle ;
   - « Désaccords » s'il y en a, et mon arbitrage.

## Clés et réglages
Les clés ne vont **jamais** dans un dépôt ni dans un fil. Ordre de lecture : variables d'environnement, puis le fichier désigné par `LLM_COUNCIL_ENV`, puis `C:\Users\<utilisateur>\cles\llm-council.env` (`~/cles/llm-council.env`), puis `.env` du dossier courant en dernier recours (il doit alors figurer dans `.gitignore`). Le script transmet aussi ces clés à freellmpool.

```
# Conseil payant
OPENAI_API_KEY=
GEMINI_API_KEY=
OPENAI_MODEL=gpt-5-mini
GEMINI_MODEL=gemini-3-flash-preview
# Conseil gratuit (toutes facultatives ; sans clé, seuls les fournisseurs sans inscription servent, et ils sont instables)
GROQ_API_KEY=
OPENROUTER_API_KEY=
MISTRAL_API_KEY=
NVIDIA_API_KEY=
HF_TOKEN=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
REQUESTY_API_KEY=
AION_API_KEY=
```
Inscriptions gratuites : https://github.com/0xzr/freellmpool/blob/main/docs/ACCOUNTS.md . Clés payantes : https://platform.openai.com/api-keys et https://aistudio.google.com/app/apikey (Gemini a aussi une offre gratuite). Les noms de modèles et les quotas gratuits évoluent sans prévenir.

Dans une session cloud ou planifiée, le réseau peut bloquer ces fournisseurs : le dire en une ligne et donner mon seul avis.

## Erreurs
- Une source échoue : le dire, continuer avec les avis disponibles.
- Tout échoue : le dire et donner mon analyse seule, sans prétendre avoir consulté le conseil.

## Script `query_llms.py`
```python
#!/usr/bin/env python3
"""
Conseil des IA : interroge plusieurs modèles sur une même question et rend leurs réponses en JSON.

D'après gcpdev/llm-council-skill (MIT, (c) 2026 Gustavo Publio), adapté pour Adil.
Modes :
  --payant  : ChatGPT + Gemini (clés OpenAI/Gemini, ou CLI codex/gemini)
  --gratuit : panel de modèles gratuits (Gemini, Groq, OpenRouter, NVIDIA, Mistral, Hugging Face, LLM7),
              interrogés en direct avec leur liste de modèles du moment ; freellmpool en dernier recours
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


# --- Panel gratuit en direct ---------------------------------------------------------------
# Chaque fournisseur expose une API compatible OpenAI. On lit sa liste de modèles EN DIRECT
# (les catalogues figés vieillissent : modèles retirés = erreurs 404/410), on choisit le
# meilleur modèle selon des préférences, et on bascule sur le suivant en cas d'échec.
EXCLUDE = ("embed", "whisper", "tts", "audio", "image", "vision", "guard", "rerank", "reward",
           "moderation", "transcribe", "speech", "safety", "-vl", "ocr", "live", "realtime")

FREE_DIRECT = [
    # (nom, variable de clé, URL de base, préférences par ordre, filtre supplémentaire)
    ("gemini", "GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai",
     ["pro", "flash"], lambda m: "gemini" in m and "lite" not in m),
    ("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1",
     ["gpt-oss-120b", "kimi", "llama-3.3-70b", "qwen", "llama-4", "gpt-oss"], lambda m: True),
    ("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1",
     ["deepseek", "qwen3", "gpt-oss", "llama-3.3-70b", "kimi", "glm", "gemma", "mistral"],
     lambda m: m.endswith(":free")),
    ("nvidia", "NVIDIA_API_KEY", "https://integrate.api.nvidia.com/v1",
     ["deepseek", "qwen3", "kimi", "llama-3.3-70b", "nemotron-super", "gpt-oss", "mistral-large"],
     lambda m: True),
    ("mistral", "MISTRAL_API_KEY", "https://api.mistral.ai/v1",
     ["mistral-medium", "mistral-small", "magistral"], lambda m: "latest" in m),
    ("huggingface", "HF_TOKEN", "https://router.huggingface.co/v1",
     ["deepseek", "qwen3", "llama-3.3-70b", "gpt-oss"], lambda m: True),
    ("llm7", None, "https://api.llm7.io/v1",
     ["deepseek", "gpt", "codestral", "mistral", "qwen"], lambda m: True),
]


def http_json(url, key=None, payload=None, timeout=60):
    headers = {"Content-Type": "application/json", "User-Agent": "llm-council/1.0"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def rank_models(ids, prefs, extra):
    ids = [i for i in ids if extra(i) and not any(x in i.lower() for x in EXCLUDE)]
    def score(i):
        low = i.lower()
        for rank, p in enumerate(prefs):
            if p in low:
                return (rank, -len([c for c in low if c.isdigit()]), i)
        return (len(prefs), 0, i)
    return sorted(ids, key=score, reverse=False)


def ask_direct(name, key, base, prefs, extra, prompt, tries=3):
    try:
        listing = http_json(base + "/models", key, timeout=30)
        ids = [m.get("id", "") for m in listing.get("data", [])
               if m.get("model_type", "chat") == "chat" and m.get("tier") not in ("pro",)
               and not m.get("usage_based_only", False)]
        if name == "llm7":  # sélecteurs gratuits documentés par LLM7
            ids = ["default", "fast"] + ids
    except Exception as e:
        return {"fournisseur": name, "modele": None, "reponse": f"Échec liste des modèles : {e}"}
    candidates = rank_models(ids, prefs, extra)
    if name == "gemini":  # le plus récent d'abord à préférence égale
        candidates.sort(key=lambda i: (0 if "pro" in i else 1, [-int(x) for x in __import__("re").findall(r"\d+", i)][:3]))
    errors = []
    for model in candidates[:tries]:
        mid = model.split("/", 1)[1] if name == "gemini" and model.startswith("models/") else model
        try:
            d = http_json(base + "/chat/completions", key,
                          {"model": mid, "messages": [{"role": "user", "content": prompt}], "max_tokens": 1500},
                          timeout=120)
            text = (d.get("choices") or [{}])[0].get("message", {}).get("content")
            if text:
                return {"fournisseur": name, "modele": mid, "reponse": text.strip()}
            errors.append(f"{mid} : réponse vide")
        except Exception as e:
            errors.append(f"{mid} : {e}")
    return {"fournisseur": name, "modele": None, "reponse": "Échec : " + " | ".join(errors or ["aucun modèle disponible"])}


def free_council(prompt, env, opinions):
    """Un avis par fournisseur gratuit disponible (clé présente, ou sans clé pour llm7), en parallèle."""
    from concurrent.futures import ThreadPoolExecutor
    jobs = [(n, setting(k, env) if k else None, b, p, x) for n, k, b, p, x in FREE_DIRECT
            if k is None or setting(k, env)]
    jobs = jobs[:max(opinions, 2)]
    with ThreadPoolExecutor(max_workers=len(jobs) or 1) as pool:
        results = list(pool.map(lambda j: ask_direct(*j, prompt), jobs))
    ok = [r for r in results if r["modele"]]
    if not ok and (shutil.which("freellmpool") or shutil.which("uvx")):  # dernier recours
        base = ["freellmpool"] if shutil.which("freellmpool") else ["uvx", "freellmpool"]
        rc, text = run_raw(base + ["ask", prompt], timeout=120, env={**os.environ, **env})
        if rc == 0 and text:
            results.append({"fournisseur": "freellmpool", "modele": "auto", "reponse": text})
    return {"avis_obtenus": len([r for r in results if r["modele"]]), "avis": results}


def main():
    args = sys.argv[1:]
    mode = None
    opinions = 5
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
```
