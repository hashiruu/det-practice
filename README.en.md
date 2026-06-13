# DET Practice Arena 🦉

[简体中文](README.md) · **English**

**Turn Duolingo English Test prep into an RPG.**

Answer questions to earn energy → energy powers your hero's auto-battle → slain bosses drop coins → upgrade gear, climb the tower, rebirth. Every correct answer buys your hero 30 more seconds of combat — vocabulary grind becomes a level-up grind.

## 🎬 Demo

![Demo: fight on the left while you drill on the right](docs/demo.gif)

▶️ [Watch the full HD clip (MP4)](docs/demo.mp4) — shield blocks, spinning-slash crits, day/night biome shifts, an elite knight going down — all in one take.

## 📸 Screenshots

| Daily quest dashboard | Fight-while-you-drill split view |
| :---: | :---: |
| ![Dashboard](docs/screenshot-dashboard.png) | ![Battle & drill split view](docs/screenshot-battle.png) |

## 🎮 How the game works

- **⚔️ Boss Tower**: turn-based auto-combat — your hero unleashes hand-choreographed sword combos while monsters charge and counter, and shield blocks throw sparks. Battle time is earned only by studying: **1 answered question = 30 seconds**
- **100+ bosses** from CC0 animated avatars (goblin, skeleton, fire serpent, zombie, evil wizard, oni, dark knight, dragon…), recolored into elite variants every cycle — azure, amethyst, gold, crimson, emerald
- **Today's accuracy = today's crit rate** — study sharper, hit harder
- **Gear & progression**: a feather shop upgrades weapons and armor (blades change shape and color by tier), plus combat levels and a title ladder
- **Hero evolution**: the protagonist unlocks 3 hi-res forms by combat level — night-owl swordsman → armored champion → sword-king — gaining a golden aura after rebirth
- **🌀 Rebirth / prestige**: past floor 25, rebirth keeps your combat level and stacks permanent damage — the numbers never inflate
- **Living battlefield**: 7 chiptune tracks cross-fade on every kill while you march through procedurally generated biomes (outdoors, blue sky, ruins, desert, snow, night city)
- **Daily quests**: quest rings, streaks, XP levels and a badge wall — 15–30 min a day, evenly covering every task type

## 📚 Practice features

- **Timed simulations of 12 DET task types**: interactive speaking (TTS prompt + AI adaptive follow-ups), describe-the-image, read-then-speak, the long speaking sample, listening dictation, conversation summary, real/fake words, fill-in-the-blanks, C-test, write-about-the-photo, interactive writing, writing sample
- **AI scoring on the official rubric**: scoring is built on the six criteria and band descriptors of the official DET scoring guide, tolerant of speech-to-text errors, with a stated reason for every band
- **Highlighter-style corrections**: your full answer is reproduced verbatim, errors highlighted in red with the correct phrasing right after in green
- **🎓 AI speaking coach**: a daily drill — model answer, structure & sentence-pattern breakdown, keyword recall, timed response, AI critique and multi-version rewrites
- **Never-repeating banks**: answered items never reappear across devices or reloads; the AI tops banks up automatically when they run low
- **Voice transcription**: server-side faster-whisper, CPU-friendly, works in both Safari and Chrome
- **Vocabulary & mistake books**: wrong words collected automatically with AI explanations; all progress syncs across browsers

## 🏗 Architecture

```
index.html / style.css / app.js / data.js   Frontend (vanilla JS, zero build, no framework)
server.js          Node ≥18: static files + API proxy
  POST /api/ai           → DeepSeek-compatible API (key read server-side, never sent to the client)
  POST /api/transcribe   → local whisper daemon (127.0.0.1:8095)
  GET/POST /api/state    → data/profile.json (cross-browser progress sync, single user)
transcribe_daemon.py     faster-whisper base.en (int8, CPU is enough)
```

## 🚀 Deploy

```bash
# 1. Provide an AI key (DeepSeek or any /chat/completions-compatible service)
echo "DEEPSEEK_API_KEY=sk-..." > /path/to/.env
echo "DEEPSEEK_MODEL=deepseek-chat" >> /path/to/.env
export DEEPSEEK_ENV_PATH=/path/to/.env

# 2. Transcription service (optional; without it, recording-based scoring is unavailable)
python3 -m venv whisper-venv && whisper-venv/bin/pip install faster-whisper av
whisper-venv/bin/python transcribe_daemon.py &

# 3. Run
node server.js          # http://localhost:8090
```

Microphone access requires HTTPS (browser restriction): use [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) or any reverse proxy.

## 🎨 Asset credits (open-licensed; all sprites/audio are CC0)

- SFX: [Kenney](https://kenney.nl) Impact Sounds / RPG Audio · [RPG Sound Pack](https://opengameart.org/content/rpg-sound-pack) (artisticdude)
- Particles: Kenney Particle Pack
- BGM: Juhani Junkala [5 Chiptunes (Action)](https://opengameart.org/content/5-chiptunes-action) + [4 Chiptunes (Adventure)](https://opengameart.org/content/4-chiptunes-adventure)
- Hero + 30+ pixel character/monster/feral-dog avatars: multiple **CC0** packs by [LuizMelo](https://luizmelo.itch.io) (Fantasy Warrior, Hero Knight, Martial Hero, Evil Wizard, Huntress, Medieval King/Warrior, Monsters Creatures Fantasy, Pet Dogs, …)
- Animated bosses: Cethiel [Dragon](https://opengameart.org/content/dragon-fully-animated) / [Zombie - Fully Animated](https://opengameart.org/content/zombie-fully-animated)
- Backgrounds, effect choreography and the procedural pixel generators are original to this project
- Fonts: Fredoka & Nunito (**SIL Open Font License**, loaded via Google Fonts)

## 📄 License

Code is open-sourced under [MIT](LICENSE). Question content is original to this project (not real exam material). Duolingo English Test is a trademark of Duolingo, Inc.; this project is not affiliated with it.
