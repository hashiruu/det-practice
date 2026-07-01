/* DET Practice App — vanilla JS, no build step. Progress in localStorage. */

// ───────────────────────── utils ─────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ───────────────────── cross-browser progress sync ─────────────────────
// every det_* localStorage write is debounced and pushed to the server;
// on startup the server copy is merged in (Safari/Chrome share one save).
const _origSet = localStorage.setItem.bind(localStorage);
const LOCAL_ONLY = k => k.startsWith("det_bag_") || k.startsWith("det_genauto_");
let _pushTimer = null, _suspendPush = false;
localStorage.setItem = (k, v) => {
  _origSet(k, v);
  if (!_suspendPush && String(k).startsWith("det_") && !LOCAL_ONLY(String(k))) schedulePush();
};
function collectState() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith("det_") && !LOCAL_ONLY(k)) out[k] = localStorage.getItem(k);
  }
  return out;
}
function schedulePush() {
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: collectState() }),
    }).catch(() => {});
  }, 2500);
}
const J = s => { try { return JSON.parse(s); } catch { return null; } };
function mergeState(remote) {
  _suspendPush = true;
  try {
    for (const [k, rv] of Object.entries(remote || {})) {
      if (LOCAL_ONLY(k)) continue;
      const lv = localStorage.getItem(k);
      if (lv == null) { _origSet(k, rv); continue; }
      if (rv === lv) continue;
      const r = J(rv), l = J(lv);
      if (k === "det_log" && Array.isArray(r) && Array.isArray(l)) {
        const seen = new Set(l.map(e => e.t + "|" + e.task));
        _origSet(k, JSON.stringify(l.concat(r.filter(e => !seen.has(e.t + "|" + e.task))).sort((a, b) => a.t - b.t)));
      } else if (k === "det_vocab" && Array.isArray(r) && Array.isArray(l)) {
        const have = new Set(l.map(x => x.w));
        _origSet(k, JSON.stringify(l.concat(r.filter(x => !have.has(x.w)))));
      } else if (k === "det_perfect" && Array.isArray(r) && Array.isArray(l)) {
        _origSet(k, JSON.stringify([...new Set(l.concat(r))].sort()));
      } else if (k === "det_sphist" && Array.isArray(r) && Array.isArray(l)) {
        const seenS = new Set(l.map(e => e.t));
        _origSet(k, JSON.stringify(l.concat(r.filter(e => !seenS.has(e.t))).sort((a, b) => a.t - b.t).slice(-200)));
      } else if (k === "det_wrong" && Array.isArray(r) && Array.isArray(l)) {
        const seenW = new Set(l.map(e => e.t + "|" + e.q));
        _origSet(k, JSON.stringify(l.concat(r.filter(e => !seenW.has(e.t + "|" + e.q))).sort((a, b) => a.t - b.t).slice(-500)));
      } else if ((k.startsWith("det_gen_") || k.startsWith("det_seen_")) && Array.isArray(r) && Array.isArray(l)) {
        const have = new Set(l.map(x => JSON.stringify(x)));
        _origSet(k, JSON.stringify(l.concat(r.filter(x => !have.has(JSON.stringify(x))))));
      } else if (k === "det_game" && r && l) {
        const score = g => (g.reborn || 0) * 1e12 + (g.bossIndex || 0) * 1e9 + (g.kills ? g.kills.length : 0) * 1e7 + (g.clv || 0) * 1e6 + ((g.weapon || 0) + (g.armor || 0)) * 1e5 + (g.coins || 0);
        const win = score(r) >= score(l) ? r : l, lose = win === r ? l : r;
        if (win.day === lose.day) {
          win.towerClaimed = Math.max(win.towerClaimed || 0, lose.towerClaimed || 0);
          win.energy = Math.max(win.energy || 0, lose.energy || 0);
        }
        _origSet(k, JSON.stringify(win));
      } else if (k === "det_speakladder" && r && l) {
        _origSet(k, JSON.stringify((r.stage || 0) > (l.stage || 0) || ((r.stage || 0) === (l.stage || 0) && (r.streak || 0) > (l.streak || 0)) ? r : l));
      } else if (k === "det_coach" && r && l) {
        const rank = c => (c.date || "") + (c.feedback ? "2" : c.transcript ? "1" : "0");
        _origSet(k, rank(r) > rank(l) ? rv : lv);
      }
      // anything else: keep local
    }
  } finally { _suspendPush = false; }
}
async function initSync() {
  try {
    const r = await fetch("/api/state");
    const j = await r.json();
    if (j && j.state && Object.keys(j.state).length) {
      mergeState(j.state);
      renderDashboard(); renderLog(); renderVocab(); renderBattle(); renderCoach(); renderWrong();
      toast("☁️ 进度已跨设备同步");
    }
  } catch {}
  schedulePush(); // push merged state back
}

function logPractice(task, detail = "", ok = true) {
  const log = JSON.parse(localStorage.getItem("det_log") || "[]");
  const entry = { t: Date.now(), task, detail };
  if (!ok) entry.h = 1; // wrong answer → half rewards
  log.push(entry);
  localStorage.setItem("det_log", JSON.stringify(log));
  // wrong answers also fuel the auto-battle at half rate, so spamming
  // wrong answers can't farm battle time
  const gain = ok ? ENERGY_PER_ITEM : ENERGY_PER_ITEM / 2;
  try {
    const g = getGame();
    g.energy = Math.min(ENERGY_CAP, (g.energy || 0) + gain);
    saveGame(g);
  } catch {}
  toast(ok ? `+10 XP · ⚔️+${gain}s` : `答错 +5 XP · ⚔️+${gain}s`);
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}
const getLog = () => JSON.parse(localStorage.getItem("det_log") || "[]");
const dayKey = ts => new Date(ts).toLocaleDateString("sv");

// ───────────────────────── TTS ─────────────────────────
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith("en")); }
loadVoices();
if (typeof speechSynthesis !== "undefined") speechSynthesis.onvoiceschanged = loadVoices;

function speak(text, { pitch = 1, rate = 0.95 } = {}) {
  return new Promise(resolve => {
    if (!voices.length) loadVoices();
    const u = new SpeechSynthesisUtterance(text);
    const preferred = voices.find(v => /en-US/i.test(v.lang) && /Samantha|Google US|Aaron|Zira/i.test(v.name)) || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
    if (preferred) u.voice = preferred;
    u.lang = "en-US"; u.pitch = pitch; u.rate = rate;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}
function stopSpeak() { speechSynthesis.cancel(); }

// ───────────────────────── timer ─────────────────────────
function runTimer(el, seconds, { cls = "go", onTick, barEl } = {}) {
  // returns {promise, cancel}; cancel() resolves the promise with false immediately
  let left = seconds, timer, resolveFn;
  el.className = `timer ${cls}`;
  el.textContent = fmt(left);
  if (barEl) barEl.style.width = "0%";
  const promise = new Promise(res => { resolveFn = res; });
  const settle = val => { clearInterval(timer); resolveFn(val); };
  timer = setInterval(() => {
    left--;
    el.textContent = fmt(Math.max(left, 0));
    if (barEl) barEl.style.width = `${((seconds - left) / seconds) * 100}%`;
    if (left <= 10 && cls === "go") el.className = "timer danger";
    if (onTick) onTick(left);
    if (left <= 0) settle(true);
  }, 1000);
  return { promise, cancel: () => settle(false) };
}

// ───────────────────────── recorder ─────────────────────────
async function getMic() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
  return navigator.mediaDevices.getUserMedia({ audio: true });
}
function stopStream(stream) {
  if (stream) for (const t of stream.getTracks()) t.stop();
}
function startRecording(stream) {
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(m => MediaRecorder.isTypeSupported(m));
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch { rec = new MediaRecorder(stream); }
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(resolve => {
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || "audio/webm" }) : null);
    rec.onerror = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || "audio/webm" }) : null);
  });
  rec.start(500);
  return { stop: () => { try { if (rec.state !== "inactive") rec.stop(); } catch {} }, done };
}
// wait until <img> inside el are loaded (max 4s) so prep time isn't wasted on a blank photo
function waitImgs(el) {
  const imgs = [...el.querySelectorAll("img")].filter(im => !im.complete);
  if (!imgs.length) return Promise.resolve();
  return Promise.race([
    Promise.all(imgs.map(im => new Promise(r => { im.onload = im.onerror = r; }))),
    new Promise(r => setTimeout(r, 4000)),
  ]);
}

// ───────────────────────── AI (DeepSeek via /api/ai proxy) ─────────────────────────
async function aiChat(system, user, maxTokens = 1800, temperature) {
  const r = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, user, max_tokens: maxTokens, temperature }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.content;
}

const SR_CLASS = window.SpeechRecognition || window.webkitSpeechRecognition;
// Safari's SpeechRecognition fights MediaRecorder for the audio session and
// depends on system dictation — skip live SR there and use server-side whisper
const IS_SAFARI = /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|Edg|Android/.test(navigator.userAgent);

async function serverTranscribe(blob) {
  if (!blob || blob.size < 800) throw new Error("没录到声音，请重新录音");
  const r = await fetch("/api/transcribe", { method: "POST", body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return (j.text || "").trim();
}

// fill the transcript textarea from the server when live transcription got nothing
function fillTranscriptFromServer(ta, blob) {
  if (!blob) return;
  ta.placeholder = "🤖 服务器正在转写录音（Whisper，几秒钟）…";
  serverTranscribe(blob)
    .then(t => {
      if (ta.value.trim()) return; // user already typed something
      if (t) { ta.value = t; ta.dispatchEvent(new Event("input")); }
      else ta.placeholder = "转写结果为空（没检测到语音）——可手动输入大意再点 AI 点评";
    })
    .catch(e => { ta.placeholder = `转写失败：${String(e.message || e)}——可手动输入大意`; });
}

function startTranscript() {
  if (!SR_CLASS || IS_SAFARI) return null;
  let finalText = "", running = true;
  const rec = new SR_CLASS();
  rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++)
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
  };
  // fatal errors must kill the auto-restart loop, or onend→start() spins forever
  rec.onerror = e => { if (["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(e.error)) running = false; };
  rec.onend = () => { if (running) { try { rec.start(); } catch {} } };
  try { rec.start(); } catch { return null; }
  return {
    stop: () => {
      running = false;
      try { rec.stop(); } catch {}
      return new Promise(res => setTimeout(() => res(finalText.trim()), 700));
    },
  };
}

const mdLite = s => esc(s)
  .replace(/\[\[(.+?)(?:=>|=&gt;|⇒|→)(.+?)\]\]/g, '<mark class="fix-bad">$1</mark><mark class="fix-good">$2</mark>')
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

// 评分量表：提炼自 Duolingo 官方《Scoring Guide for Teachers 2026》§5.1-5.3
const DET_RUBRIC = `【DET 官方口语评分体系（依据官方 2026 评分指南提炼）】
口语按 6 项标准评：content、discourse coherence、fluency、grammar、lexis、pronunciation。
你拿到的是语音转写文本：pronunciation 无法评判（忽略）；fluency 只能从重复、重启、自我修正、句子中断的痕迹弱推断；其余 4 项可直接评。

各标准考察点：
- content：是否回答了题目的每一个部分并全程切题；观点是否有细节和例子展开支撑；风格是否得体。这是第一权重。
- discourse coherence：想法是否按逻辑递进；是否用连接词和代词把句子衔接成整体；听者是否容易跟上。
- grammar：结构范围（能否混用简单句与复杂句、条件句、定语从句、情态动词、被动语态）+ 准确性（错误是否影响理解）+ 灵活与一致（时态/主谓一致是否稳定）。
- lexis：词汇多样性（避免重复同一个词）、精确度（具体词 vs nice/good/thing 这类泛词）、搭配与习语是否自然、词形是否正确（bored vs boring）。

分数段锚点（按官方描述判段，先定段再段内微调）：
- 130-150：清晰得体、例子相关；多样结构大多正确（复杂句/条件/被动/倒装），小错不碍事；词汇宽、有自然搭配和一些习语。
- 100-125：覆盖大部分要点、主要观点有一定展开但未必深入；逻辑分组清楚，连接词/代词使用得当；能用 although/because/so that 复杂句、should/might 情态、定语从句、条件句，有错但不碍理解；词汇基本恰当但有重复和不精确处。
- 60-95：内容基础、欠展开或与题目联系松散；组织简单，只靠 and/but/because/so 这类基础连接词且衔接常缺失；语法范围窄（一般现在/过去时、基础情态），部分错误影响理解；依赖泛词和重复。
- 30-55：只沾到话题、细节缺失；列举式、重复，基础连接词误用；基础语法错误频繁；词汇贫乏。
- 10-25：基本没完成任务，极短或难以理解。

【官方判分锚点——先对照锚点再定段，禁止压分】
以下是官方指南公布的真实考生答案与官方实评分，你的分数尺度必须与之对齐：
▶ 官方 145 分（供对照，达到"描述完整+合理推测+结构多样(被动/现在完成/定语从句)+错误极少"即应给 135-150）：
"This is a picture of a sports game stadium. In the background is the view of a huge metropolis. There are several buildings including huge skyscrapers. The playground is quite green in color. This test taker scored 140 for Writing. Content: The test taker describes key features of the image—namely the stadium, the city skyline, skyscrapers, and the green field. The answer is relevant, focused, and on-topic. Discourse coherence: The ideas are presented in a logical order, moving from the main subject (the stadium) to the background and then to a specific detail (the field).…"
▶ 官方 115 分（主要元素齐但发展不足、有若干别扭句）："This image I see three people sitting on a rock like on the road. One of them is like a mannequin. I think it is a normal person but they do disguise like this to make money. The, next to him on his right there is a person dressing as I think he is maybe a businessman. He has on his waist his cell phone. He has a bag, maybe his work bag. And he is putting his hand on his face like he is thinking thinking about his problems maybe. He is not feeling…"
▶ 官方 85 分（内容碎、语法错误多、意群断裂）："Okay. They might despite three girls and one man. They are sit. It seem to me be like conversation with with each other. Two girls wear sunglass and were wear on the right hand you can see the girl wear T-shirts, gray t-shirt. You can see the man on the right hand wear a yellow T-shirt and he use glass either. They probably talking about some magazines and both they both girls have two bottles of water, yeah, two side, and then two side up, the girls like to call… have a conversation about something,…"
校准规则：一个回答如果与 145 锚点同档表现，就给 135-150，不要因为"还能更好"而扣到 110-120；比 115 锚点明显强、接近 145 锚点 → 125-140。历史偏差警告：此前评分系统性偏低约 15 分，尤其压制 130+ 高分段——对照锚点纠正这一倾向。

判分流程：① 对照题目逐部分检查是否都回答了；② 在转写中找语法结构证据（有无复杂句/条件/定语从句/情态——这是 100+ 与 60-95 的分水岭）；③ 数连接手段的种类；④ 评词汇多样性与精确度；⑤ 先定分数段，再依展开充分度在段内微调。

【口语判分修正（依官方 5.2/5.3 原文）】
① 文体：官方 Appropriacy of style 明确“口语任务应更个人化(more personal when speaking)”——口语体、缩略、直接表达是【正确文体】；书面作文腔在口语里反而是文体不当，绝不能要求考生说书面长难句。
② 100-125 段官方原话要点：内容“部分展开即可，整体清楚就行”；流利度“允许明显停顿、迟疑、重复、自我修正，稍慢、听者略费力都可接受”；语法“结构大多数时候正确即可，可以有错误，只要不妨碍理解”；词汇“可以重复用词、依赖熟悉表达”。→ 切题+有条理+有细节+自然出现若干复杂结构（哪怕有错）= 110-125，不要求完美。
③ “结构多样”的官方例子是：because/although/so that 连词复句、should/might 情态、定语从句、条件句的【自然使用】——不是长句堆砌。
④ 评分是整体判断：两个段位之间拿不准时，若沟通完全有效，取【较高】段。

【ASR 重要提醒】考生文本是语音自动转写（ASR）的结果，必然存在转写造成的错误：同音/近音词被替换（如 their/there、to/too）、专有名词拼错、个别词被吞掉或多出、标点缺失。这些不是考生的错误。
评分必须抓住整体框架（内容是否切题完整、组织是否有条理、语法形态与句式结构、词汇广度），对一切"疑似转写错误"一律宽容：绝不因拼写扣分，绝不把可能是转写问题的地方当成考生的语言错误来点评。只有当错误明显属于语言能力（如时态、主谓一致、句式结构混乱）时才计入。`;

const SPEAK_RATER = `你是 Duolingo English Test 口语评分官。考生目标是 Speaking 单项 ≥130（官方 130-150 段，约 IELTS 7）。点评时明确指出：这个回答离 130-150 段还差在哪一项（发展充分度 / 结构多样性 / 用词精确度 / 错误率），差距要说具体。
${DET_RUBRIC}
这是【口语】，不是作文：你给的每一句建议都必须是一个人在限时口语里一口气能自然说出来的话（短句、口语体、≤14 词），绝不要书面长难句或文绉绉的措辞。
输出格式（中文点评，英文例句保留英文）：
**原文标注**：完整还原考生整段转写原文（保持原顺序，不许改写、缩短或省略任何部分），把每一处真实的语言错误用 [[错误原文=>正确表达]] 标记包裹（错误片段一字不改地保留在标记内；“正确表达”必须是最自然的口语说法，不是书面改写）。疑似转写错误不要标。整段除标记外不加任何点评文字。这是考生最看重的部分，必须完整。
**维度点评**：content / coherence / grammar / lexis 各一行，"维度 ★1-5 一句话（引用转写中的证据）"
**口语升级**：教 1-2 个考生下次开口就能用的口语句型（如 The thing is… / If I had to choose… / It's not just X, it's also Y），每个配一句 ≤12 词的示范，说明用在哪
**口语好词**：2-3 个口语常用 chunk/搭配（拒绝生僻书面词）
**估分**：按上面的分数段锚点定段并给出区间。牢记官方 100-125 的宽容度：切题+有条理+有细节+自然复杂句（可带错误、重复、迟疑）就该给 110-125，拿不准取高段
最后单独一行输出 \`VOCAB: word1, word2, word3\`（从你的建议中挑 3-5 个最值得考生收藏的单词或搭配，小写英文，逗号分隔）`;

const WRITE_RATER = `你是 Duolingo English Test 写作评分官。考生目标整体分数体面（≥120）。
按 DET 写作 4 项标准点评：content（内容量与切题）、discourse coherence、grammar、lexis。
输出格式（中文点评，英文保留英文，总长 ≤350 字）：
**维度点评**：每个维度一行，"维度 ★1-5 一句话"
**逐句修改**：挑 2-3 处最值得改的句子，"原句 → 改后"
**句式升级**：挑考生 1-2 个简单句，用更高级的句式改写（标注句式名称）
**估分**：对应的 DET Writing 区间
最后单独一行输出 \`VOCAB: word1, word2, word3\`（从你的建议中挑 3-5 个最值得考生收藏的单词或搭配，小写英文，逗号分隔）`;

const VOCAB_COACH = `你是英语词汇老师，学生备考 DET（目标 B2+）。对给出的每个单词/搭配输出一行：
**word** — 中文释义 · 一句 B2 水平英文例句 · 一个高频搭配
最后给一条整体记忆建议。中文讲解，例句保留英文，总长 ≤350 字。`;

const READ_COACH = `你是英语阅读老师，讲解 DET 'Read and Complete'（C-test）段落。学生想提高阅读能力。输出：
**段落大意**：一句中文
**错词讲解**：对学生填错的每个词一行：**词** — 中文词义 · 指出句中哪个上下文线索（搭配/逻辑/语法）能推出这个词
**阅读建议**：针对这次的错误类型给一条做题技巧
中文讲解，总长 ≤350 字。`;

function aiFeedbackButton(parent, label, buildMessages) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<button class="secondary">🤖 ${esc(label)}</button><div class="ai-box hidden"></div>`;
  const btn = wrap.querySelector("button"), out = wrap.querySelector(".ai-box");
  btn.onclick = async () => {
    btn.disabled = true;
    let waitS = 0;
    btn.textContent = "🤖 思考中… 0s";
    const waitT = setInterval(() => { waitS += 1; btn.textContent = `🤖 思考中… ${waitS}s${waitS > 60 ? "（推理模型较慢，请稍候）" : ""}`; }, 1000);
    out.classList.remove("hidden"); out.textContent = "…";
    try {
      const { system, user, maxTokens } = buildMessages();
      let content = await aiChat(system, user, maxTokens);
      // harvest the VOCAB: line into the notebook
      let harvested = 0;
      const vm = content.match(/^\s*`?VOCAB[:：]\s*(.+?)`?\s*$/im);
      if (vm) {
        harvested = addVocab(vm[1].split(/[,，;；]/), "AI点评");
        content = content.replace(/^\s*`?VOCAB[:：].*$/im, "").trim();
      }
      clearInterval(waitT);
      out.innerHTML = mdLite(content) + (harvested ? `<br><span class="muted">📒 ${harvested} 个表达已自动加入生词本</span>` : "");
      btn.classList.add("hidden");
    } catch (e) {
      clearInterval(waitT);
      out.innerHTML = `<span class="result-bad">AI 点评失败：${esc(String(e.message || e))} —— 点按钮重试</span>`;
      btn.disabled = false; btn.textContent = `🤖 ${label}（重试）`;
    }
  };
  parent.appendChild(wrap);
}

// ───────────────────── AI question generation (pooled in localStorage) ─────────────────────
const getGen = key => JSON.parse(localStorage.getItem("det_gen_" + key) || "[]");
const pool = (key, base) => base.concat(getGen(key));

// draw with PERMANENT exclusion: every drawn item is hashed into a synced
// det_seen_<key> set and never appears again on any device; when fresh items
// run low, DeepSeek silently tops the bank up -> infinite, repeat-free
function itemHash(it) {
  const s = typeof it === "string" ? it : JSON.stringify(it);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function drawFrom(key, base) {
  const items = pool(key, base);
  const seen = new Set(J(localStorage.getItem("det_seen_" + key)) || []);
  const fresh = items.filter(it => !seen.has(itemHash(it)));
  maybeAutoGen(key, fresh.length);
  // 宗旨：做过的题绝不再出（跨设备、跨刷新）。fresh<20 就开始 AI 补题，打空时紧急补
  const source = fresh.length ? fresh : items;
  const item = source[Math.floor(Math.random() * source.length)];
  if (fresh.length) {
    seen.add(itemHash(item));
    localStorage.setItem("det_seen_" + key, JSON.stringify([...seen])); // synced cross-device
  }
  return item;
}

// wrong-answer book (synced): what you answered vs what was right
const getWrong = () => J(localStorage.getItem("det_wrong")) || [];
function addWrong(task, q, ans, correct) {
  const w = getWrong();
  w.push({ t: Date.now(), task, q: String(q).slice(0, 170), ans: String(ans).slice(0, 120), correct: String(correct).slice(0, 170) });
  localStorage.setItem("det_wrong", JSON.stringify(w.slice(-500)));
}

const _genInFlight = {};
function maybeAutoGen(key, remaining) {
  if (!GEN_SPECS[key] || _genInFlight[key] || remaining > 20) return;
  const last = +localStorage.getItem("det_genauto_" + key) || 0;
  if (remaining > 3 && Date.now() - last < 8 * 60 * 1000) return; // nearly dry -> skip the throttle
  _genInFlight[key] = true;
  _origSet("det_genauto_" + key, String(Date.now()));
  genMore(key)
    .then(n => toast(`🤖 ${TASK_NAMES[key] || key} 题库自动补充了 ${n} 题`))
    .catch(() => {})
    .finally(() => { _genInFlight[key] = false; });
}

const GEN_SPECS = {
  rts: {
    ask: "生成 8 道 DET 'Read Then Speak' 口语题（20秒准备+90秒作答）。每题一个 prompt（祈使句，如 Talk about… / Describe… / Explain…，个人经历、观点、或向外行解释一个简单概念）和恰好 3 个英文 bullets 引导子问题。B1-B2 难度，话题彼此不同。全部英文。",
    schema: '[{"prompt":"Talk about ...","bullets":["...","...","..."]}]',
    valid: x => x && typeof x.prompt === "string" && Array.isArray(x.bullets) && x.bullets.length >= 2,
  },
  ss: {
    ask: "生成 8 道 DET 'Speaking Sample' 议论型口语题（3 分钟长答）。每题一个英文字符串：agree/disagree 或二选一偏好型问题，并要求 reasons and examples。B2 难度，话题彼此不同。",
    schema: '["Some people believe ... Do you agree or disagree? Use reasons and examples."]',
    valid: x => typeof x === "string" && x.length > 30,
  },
  ws: {
    ask: "生成 8 道 DET 'Writing Sample' 议论型写作题（5 分钟）。每题一个英文字符串：观点/偏好型问题，要求 reasons and examples。B2 难度，话题彼此不同。",
    schema: '["Do you think ...? Explain your opinion with reasons and examples."]',
    valid: x => typeof x === "string" && x.length > 30,
  },
  iw: {
    ask: "生成 6 道 DET 'Interactive Writing' 两段式写作题。每题含 main（第一段题目）和 follow（针对同一话题但角度不同的追问）。全部英文，B2 难度。",
    schema: '[{"main":"Describe ...","follow":"Now write about ..."}]',
    valid: x => x && typeof x.main === "string" && typeof x.follow === "string",
  },
  lt: {
    ask: "生成 14 个 DET 'Listen and Type' 听写句子。日常/校园场景的英文陈述句，8–18 个词，难度 B1-B2，含不同时态、单复数、比较级等易错点，彼此话题不同。",
    schema: '["The library closes early on Friday evenings."]',
    valid: x => typeof x === "string" && x.split(/\s+/).length >= 6 && x.length < 170,
  },
  ct: {
    ask: "生成 5 段 DET 'Read and Complete' 用的英文说明性短文。每段 4–6 个完整句子、80–110 词，话题为常识/科普/生活（彼此不同），B1-B2 词汇，不用专有名词。",
    schema: '["Coffee is one of the most popular drinks in the world. ..."]',
    valid: x => typeof x === "string" && x.length > 150 && x.split(".").length >= 4,
  },
  fb: {
    ask: "生成 14 道 DET 'Fill in the Blanks' 题。每题含 s（去掉最后一个词的英文句子）和 w（那个被去掉的词，3 个字母以上的常用名词/动词，必须由句子语境强烈暗示、基本唯一）。",
    schema: '[{"s":"She opened the window to let in some fresh","w":"air"}]',
    valid: x => x && typeof x.s === "string" && typeof x.w === "string" && /^[a-zA-Z]{3,}$/.test(x.w),
  },
  realw: {
    ask: "生成 30 个真实存在的常用英文单词（B1-B2 水平，名词/动词/形容词混合，全部小写，彼此不同，不要太基础的词也不要生僻词）。",
    schema: '["bargain"]',
    valid: x => typeof x === "string" && /^[a-z]{3,12}$/.test(x),
  },
  fakew: {
    ask: "生成 30 个【假词】：看起来像英文、读得顺口、但实际不存在的词。通过对真实单词做 1-2 个字母替换/增删得到。绝对不能是任何真实存在的英文单词（包括罕见词、缩写、专有名词的小写形式）。全部小写。",
    schema: '["blosserm"]',
    valid: x => typeof x === "string" && /^[a-z]{4,12}$/.test(x) && !DATA.realWords.includes(x),
  },
  isq: {
    ask: "生成 12 个 DET 'Interactive Speaking' 风格的日常口语问题（英文，12-22 个词，个人化、可即兴回答，话题彼此不同）。",
    schema: '["What do you usually do to relax after a busy day?"]',
    valid: x => typeof x === "string" && x.length > 15 && x.length < 200,
  },
  sum: {
    ask: "生成 3 段 DET 'Summarize the Conversation' 用的校园场景英文对话。每段含 title（短标题）和 lines（5–6 轮 [说话人, 台词]，说话人用 Student/Professor/Advisor/Staff 等），有明确的问题和解决方案。",
    schema: '[{"title":"Late assignment","lines":[["Student","..."],["Professor","..."]]}]',
    valid: x => x && typeof x.title === "string" && Array.isArray(x.lines) && x.lines.length >= 4 && x.lines.every(l => Array.isArray(l) && l.length === 2),
  },
};

GEN_SPECS.ct2 = { ...GEN_SPECS.lt }; // micro C-test reuses sentence generation

async function genMore(key) {
  const spec = GEN_SPECS[key];
  const raw = await aiChat(
    "你是 Duolingo English Test 出题官，熟悉官方题型规范。只输出一个合法的 JSON 数组（双引号），不要 markdown 代码块，不要任何解释文字。",
    spec.ask + "\n输出 JSON 格式示例（仅示意结构，禁止照抄示例内容）：" + spec.schema, 3800);
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("AI 没有返回 JSON");
  // drop invalid items, the schema example if echoed back, and anything already in the pool
  const baseMap = { rts: DATA.readThenSpeak, ss: DATA.speakingSample, ws: DATA.writingSample, iw: DATA.interactiveWriting, lt: DATA.listenAndType, ct: DATA.cTest, fb: DATA.fillBlanks, sum: DATA.summarize, realw: DATA.realWords, fakew: DATA.fakeWords, isq: DATA.interactiveSpeaking.flatMap(t => t.questions), ct2: DATA.listenAndType };
  const seen = new Set(pool(key, baseMap[key] || []).map(x => JSON.stringify(x)));
  const arr = JSON.parse(m[0]).filter(spec.valid).filter(x => !seen.has(JSON.stringify(x)));
  if (!arr.length) throw new Error("生成结果为空");
  localStorage.setItem("det_gen_" + key, JSON.stringify(getGen(key).concat(arr)));
  return arr.length;
}

function attachGenUI(view, key, baseArr) {
  const card = view.querySelector(".card");
  if (!card || !GEN_SPECS[key]) return;
  const div = document.createElement("div");
  const countText = () => `题库：内置 ${baseArr.length} 题 + AI 已生成 ${getGen(key).length} 题`;
  div.innerHTML = `<p class="muted" style="margin-top:10px"><span>${countText()}</span>
    <button class="ghost" style="padding:4px 12px;font-size:13px;margin-left:8px">🤖 AI 再出一批新题</button></p>`;
  const btn = div.querySelector("button"), span = div.querySelector("span");
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "🤖 DeepSeek 出题中…（约 1 分钟）";
    try {
      const n = await genMore(key);
      span.textContent = countText();
      btn.textContent = `✅ 新增 ${n} 题，再出一批`;
    } catch (e) { btn.textContent = `❌ ${String(e.message || e).slice(0, 40)}，点击重试`; }
    btn.disabled = false;
  };
  card.appendChild(div);
}

// ───────────────────── vocab notebook (auto-collected from mistakes) ─────────────────────
const getVocab = () => JSON.parse(localStorage.getItem("det_vocab") || "[]");
function saveVocab(v) { localStorage.setItem("det_vocab", JSON.stringify(v)); }
function addVocab(words, src, ctx = "") {
  const v = getVocab();
  const have = new Set(v.map(x => x.w.toLowerCase()));
  let added = 0;
  for (const raw of words) {
    const w = String(raw).trim().toLowerCase();
    if (w.length >= 3 && w.length <= 40 && /^[a-z][a-z' -]*$/.test(w) && !have.has(w)) {
      v.push({ w, src, ctx: String(ctx).slice(0, 90), t: Date.now(), known: false });
      have.add(w); added++;
    }
  }
  if (added) saveVocab(v);
  return added;
}
const vocabNote = n => n ? `<p class="muted">📒 ${n} 个词已自动加入生词本</p>` : "";

// ───────────────────── battle game (Melvor-style reward sink) ─────────────────────
const WEAPONS = ["铅笔", "钢笔", "荧光笔", "机械键盘", "电子词典", "雷霆鹅毛笔", "词汇圣剑", "圣剑"];
const ARMORS = ["卫衣", "牛仔外套", "图书馆马甲", "学术袍", "降噪头盔", "鸮羽披风", "B2 圣铠"];
const BOSSES = [
  { icon: "🟢", name: "拼写史莱姆" },
  { icon: "👻", name: "假词幽灵" },
  { icon: "🧌", name: "语法巨魔" },
  { icon: "🦇", name: "听写蝙蝠王" },
  { icon: "🐙", name: "长难句海妖" },
  { icon: "🐲", name: "阅读巨龙" },
  { icon: "🌑", name: "暗影评分官" },
  { icon: "🦉", name: "大魔王杜欧" },
  { icon: "🦖", name: "残篇暴龙王" },
  { icon: "🐉", name: "同义烈焰龙" },
  { icon: "🐍", name: "从句巨蟒" },
  { icon: "🗿", name: "语法魔像" },
  { icon: "🐲", name: "雷暴冰龙" },
  { icon: "👹", name: "错题修罗" },
  { icon: "🌋", name: "熔岩古兽" },
  { icon: "🦑", name: "深渊词海皇" },
  { icon: "🐉", name: "灭国古龙" },
];
// ── asset bosses: CC0 web avatars — Cethiel (dragon/zombie, OGA) + LuizMelo pixel packs (itch.io) ──
// frames pre-rendered into mon/; every floor cycles the roster, deeper cycles get hue-rotate variants
const ASSET_BOSSES = [
  { key: "gob", species: "哥布林", icon: "👺", growl: "troll", anims: { battle: 4, atk: 8, hurt: 4, die: 4 }, speed: { battle: 190, atk: 90, hurt: 100, die: 140 }, skill: "乱刃斩", hit: [0.492, 0.607], css: "width:112%" },
  { key: "skel", species: "骷髅剑士", icon: "💀", growl: "ghost", anims: { battle: 4, atk: 8, hurt: 4, die: 4 }, speed: { battle: 200, atk: 90, hurt: 100, die: 150 }, skill: "枯骨斩", hit: [0.708, 0.486], css: "width:115%" },
  { key: "worm", species: "炎蟒", icon: "🐍", growl: "serpent", anims: { battle: 9, atk: 16, hurt: 3, die: 8 }, speed: { battle: 140, atk: 55, hurt: 110, die: 90 }, skill: "烈焰吐息", ranged: "fire", hit: [0.502, 0.711], css: "width:118%" },
  { key: "zomb", species: "尸鬼", icon: "🧟", growl: "troll", anims: { battle: 8, atk: 12, atk2: 12, hurt: 6, die: 12 }, speed: { battle: 230, atk: 65, atk2: 70, hurt: 70, die: 60 }, skill: "腐爪扑", hit: [0.58, 0.528], css: "width:130%;margin-left:-18%" },
  { key: "wiz", species: "邪法师", icon: "🧙", growl: "shadow", anims: { battle: 8, atk: 8, atk2: 8, hurt: 3, die: 7 }, speed: { battle: 170, atk: 95, atk2: 95, hurt: 120, die: 120 }, skill: "暗影召唤", ranged: "shadow", hit: [0.634, 0.632], css: "width:145%;margin-left:-25%" },
  { key: "mush", species: "毒菇怪", icon: "🍄", growl: "slime", anims: { battle: 4, atk: 8, hurt: 4, die: 4 }, speed: { battle: 210, atk: 90, hurt: 100, die: 150 }, skill: "孢子爪击", hit: [0.437, 0.55], css: "width:100%" },
  { key: "oni", species: "鬼面武士", icon: "👹", growl: "owlking", anims: { battle: 4, atk: 4, atk2: 4, hurt: 3, die: 7 }, speed: { battle: 220, atk: 150, atk2: 150, hurt: 120, die: 130 }, skill: "鬼月斩", hit: [0.723, 0.678], css: "width:120%;margin-left:-8%" },
  { key: "eye", species: "魔眼蝠", icon: "👁️", growl: "bat", anims: { battle: 8, atk: 8, hurt: 4, die: 4 }, speed: { battle: 120, atk: 90, hurt: 100, die: 140 }, skill: "邪瞳凝视", ranged: "beam", hit: [0.503, 0.334], css: "width:80%;margin-bottom:22%" },
  { key: "knightb", species: "黑暗骑士", icon: "🛡️", growl: "owlking", anims: { battle: 11, atk: 7, atk2: 7, hurt: 4, die: 11 }, speed: { battle: 130, atk: 95, atk2: 95, hurt: 110, die: 110 }, skill: "弦月斩", hit: [0.367, 0.665], css: "width:128%;margin-left:-12%" },
  { key: "drag", species: "魔龙", icon: "🐉", growl: "dragon", anims: { battle: 8, atk: 12, atk2: 12, hurt: 6, die: 12 }, speed: { battle: 240, atk: 60, atk2: 60, hurt: 70, die: 58 }, skill: "龙噬", hit: [0.441, 0.629], css: "width:175%;margin-left:-45%" },
  { key: "ewz1", species: "红袍咒师", icon: "🔥", growl: "shadow", anims: { battle: 8, atk: 8, hurt: 4, die: 5, run: 8 }, speed: { battle: 180, atk: 80, hurt: 110, die: 130, run: 90 }, skill: "炼狱火", ranged: "fire", hit: [0.697, 0.597], css: "width:113%" },
  { key: "ewz3", species: "亡灵巫师", icon: "💀", growl: "shadow", anims: { battle: 10, atk: 13, hurt: 3, die: 18, run: 8 }, speed: { battle: 180, atk: 80, hurt: 110, die: 130, run: 90 }, skill: "噬魂咒", ranged: "shadow", hit: [0.746, 0.576], css: "width:111%" },
  { key: "hk2", species: "堕落骑士", icon: "🛡️", growl: "owlking", anims: { battle: 11, atk: 6, hurt: 4, die: 9, run: 8 }, speed: { battle: 180, atk: 80, hurt: 110, die: 130, run: 90 }, skill: "新月斩", hit: [0.417, 0.665], css: "width:113%" },
  { key: "hunt", species: "暗影女猎手", icon: "🏹", growl: "ghost", anims: { battle: 8, atk: 5, atk2: 5, atk3: 7, hurt: 3, die: 8, run: 8 }, speed: { battle: 180, atk: 80, atk2: 80, atk3: 80, hurt: 110, die: 130, run: 90 }, skill: "旋月斩", hit: [0.55, 0.679], css: "width:111%" },
  { key: "hunt2", species: "翠羽游侠", icon: "🍃", growl: "ghost", anims: { battle: 10, atk: 6, hurt: 3, die: 10, run: 8 }, speed: { battle: 180, atk: 80, hurt: 110, die: 130, run: 90 }, skill: "穿心箭", ranged: "arrow", hit: [0.305, 0.586], css: "width:116%" },
  { key: "mh1", species: "浪人武者", icon: "🥋", growl: "owlking", anims: { battle: 8, atk: 6, atk2: 6, hurt: 4, die: 6, run: 8 }, speed: { battle: 180, atk: 80, atk2: 80, hurt: 110, die: 130, run: 90 }, skill: "月华斩", hit: [0.729, 0.676], css: "width:147%" },
  { key: "mh3", species: "武道宗师", icon: "👊", growl: "owlking", anims: { battle: 10, atk: 7, atk2: 6, atk3: 9, hurt: 3, die: 11, run: 8 }, speed: { battle: 180, atk: 80, atk2: 80, atk3: 80, hurt: 110, die: 130, run: 90 }, skill: "弦月斩", hit: [0.503, 0.746], css: "width:123%" },
  { key: "wizp", species: "奥术法师", icon: "🔮", growl: "shadow", anims: { battle: 7, atk: 9, atk2: 9, hurt: 4, die: 8, run: 9 }, speed: { battle: 180, atk: 80, atk2: 80, hurt: 110, die: 130, run: 90 }, skill: "奥术涌动", ranged: "arcane", hit: [0.554, 0.658], css: "width:112%" },
];
// 变色变体：紫龙、蓝龙、黄金哥布林……同一物种逐轮换色换名
const BOSS_VARIANTS = [
  { p: "", d: 0 }, { p: "苍蓝", d: 200 }, { p: "紫晶", d: 265 },
  { p: "黄金", d: 45 }, { p: "绯红", d: 330 }, { p: "翠绿", d: 130 },
];
function bossAssetOf(n) {
  const base = ASSET_BOSSES[n % ASSET_BOSSES.length];
  const cyc = (n / ASSET_BOSSES.length) | 0;
  const v = BOSS_VARIANTS[cyc % BOSS_VARIANTS.length];
  return { ...base, vName: v.p, filter: v.d ? `hue-rotate(${v.d}deg) saturate(1.1)` : "" };
}
// ── hero web avatar: CC0 "Fantasy Warrior" by LuizMelo (itch.io) — 克劳德标准的银发大剑士 ──
// ── 勇者多形态：随战斗等级 clv 进化（更多形象）。全部 CC0 LuizMelo 高清像素侧视 ──
const HERO_FORMS = [
  { key: "hero",  titles: ["夜读学徒", "夜读剑客", "见习剑士", "夜读剑士"], name: "夜读剑士", min: 0,  anims: { idle: 10, run: 8, atk1: 7, atk2: 7, atk3: 8, hurt: 3, die: 7 },
    speed: { idle: 110, run: 85, atk1: 60, atk2: 60, atk3: 55, hurt: 95, die: 110 }, css: "width:215%;margin-left:-55%;margin-top:-58%" },
  { key: "hero2", titles: ["重甲剑士", "破阵剑豪", "百战剑豪", "重甲剑豪"], name: "重甲剑豪", min: 10, anims: { idle: 8, run: 10, atk1: 5, atk2: 5, hurt: 4, die: 12 },
    speed: { idle: 120, run: 80, atk1: 70, atk2: 70, hurt: 100, die: 120 }, css: "width:120%;margin-left:-10%;margin-top:-34%" },
  { key: "hero3", titles: ["剑术宗师", "无双剑圣", "词海剑仙", "剑皇"], name: "剑皇", min: 25, anims: { idle: 6, run: 8, atk1: 6, atk2: 6, hurt: 4, die: 11 },
    speed: { idle: 130, run: 85, atk1: 70, atk2: 70, hurt: 100, die: 120 }, css: "width:150%;margin-left:-26%;margin-top:-30%" },
];
function heroFormFor(g) {
  const clv = (g && g.clv) || 0;
  let f = HERO_FORMS[0];
  for (const form of HERO_FORMS) if (clv >= form.min) f = form;
  return f;
}
let HERO_CUR = HERO_FORMS[0];
const HMON = { t: null, preloaded: {} };
const heroDefaultAnim = () => (BATTLE.running ? "run" : "idle");
function heroResolveAnim(name) {
  if (HERO_CUR.anims[name]) return name;
  if (name === "atk3") return HERO_CUR.anims.atk2 ? "atk2" : "atk1";
  if (name === "atk2") return "atk1";
  if (name === "run") return "idle";
  return "idle";
}
function heroAnim(name, once) {
  const img = document.getElementById("hero-img");
  if (!img) return;
  name = heroResolveAnim(name);
  clearInterval(HMON.t);
  const n = HERO_CUR.anims[name], ms = HERO_CUR.speed[name] || 90;
  let i = 0;
  img.src = `mon/${HERO_CUR.key}_${name}_0.png`;
  HMON.t = setInterval(() => {
    i++;
    if (i >= n) {
      if (once) { clearInterval(HMON.t); heroAnim(heroDefaultAnim()); return; }
      i = 0;
    }
    img.src = `mon/${HERO_CUR.key}_${name}_${i}.png`;
  }, ms);
}
function preloadHero() {
  if (HMON.preloaded[HERO_CUR.key]) return;
  HMON.preloaded[HERO_CUR.key] = 1;
  Object.entries(HERO_CUR.anims).forEach(([a, n]) => {
    for (let i = 0; i < n; i++) { const im = new Image(); im.src = `mon/${HERO_CUR.key}_${a}_${i}.png`; }
  });
}
const MON = { t: null, cfg: null, preloaded: 0 };
function assetBossAnim(name, once) {
  const img = document.getElementById("boss-img");
  if (!img || !MON.cfg || !MON.cfg.anims[name]) return;
  clearInterval(MON.t);
  const n = MON.cfg.anims[name], ms = MON.cfg.speed[name] || 80;
  let i = 0;
  img.src = `mon/${MON.cfg.key}_${name}_0.png`;
  MON.t = setInterval(() => {
    i++;
    if (i >= n) {
      if (once) { clearInterval(MON.t); if (name !== "die") assetBossAnim("battle"); return; }
      i = 0;
    }
    img.src = `mon/${MON.cfg.key}_${name}_${i}.png`;
  }, ms);
}
function preloadAssetBoss(cfg) {
  MON.preloaded = MON.preloaded || {};
  if (MON.preloaded[cfg.key]) return;
  MON.preloaded[cfg.key] = 1;
  Object.entries(cfg.anims).forEach(([a, n]) => {
    for (let i = 0; i < n; i++) { const im = new Image(); im.src = `mon/${cfg.key}_${a}_${i}.png`; }
  });
}
// ── procedural high-res pixel portraits (64×64 monsters, gear-aware hero) ──
function prng(seed) {
  let t = (seed * 2654435761) >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gridSVG(cells, W, H) { // cells: Map "x,y" -> color
  let rects = "";
  cells.forEach((color, key) => {
    const [x, y] = key.split(",");
    rects += `<rect x="${x}" y="${y}" width="1.05" height="1.05" fill="${color}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function genMonster(opts) {
  const { seed, hue } = opts;
  const W = 64, H = 64, R = prng(seed);
  const cx = 32, cy = 32;
  const rx = 14 + R() * 6, ry = 13 + R() * 7;
  const body = new Set();
  const put = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) body.add(x + "," + y); };
  const has = (x, y) => body.has(x + "," + y);
  // body plans: blob / kaiju(哥斯拉式) / dragon / serpent / golem — noisy mask, smoothed, mirrored
  const plan = opts.plan || "blob";
  let g = Array.from({ length: H }, () => new Array(W).fill(0));
  const ell = (ex, eyc, erx, ery, nz) => {
    for (let y = 2; y < H - 2; y++) for (let x = 2; x <= cx; x++) {
      const dx = (x - ex) / erx, dy = (y - eyc) / ery;
      if (dx * dx + dy * dy + (R() - 0.5) * (nz || 0.3) < 1) g[y][x] = 1;
    }
  };
  const blk = (x0, y0, x1, y1) => {
    for (let y = Math.max(2, y0); y <= Math.min(H - 3, y1); y++)
      for (let x = Math.max(2, x0); x <= Math.min(cx, x1); x++) g[y][x] = 1;
  };
  let smooth = 3;
  if (plan === "kaiju") { // 小头、塔状躯干、粗腿——巨兽踏地而来
    ell(cx, 14, 7, 7); blk(cx - 9, 16, cx, 30); ell(cx, 34, 12, 13, 0.35); blk(cx - 11, 44, cx - 4, 57); smooth = 2;
  } else if (plan === "dragon") { // 高昂的头、细长颈、阔胸
    ell(cx, 11, 8, 6); blk(cx - 3, 12, cx, 30); ell(cx, 38, 12, 12, 0.35); smooth = 2;
  } else if (plan === "serpent") { // 眼镜蛇兜帽 + 盘绕的身躯
    ell(cx, 14, 11, 9); blk(cx - 4, 22, cx, 38); ell(cx, 44, 12, 7); ell(cx, 53, 15, 6); smooth = 2;
  } else if (plan === "golem") { // 方正岩石躯体 + 巨拳
    blk(cx - 7, 6, cx, 18); blk(cx - 13, 21, cx, 44); blk(cx - 17, 23, cx - 11, 38); blk(cx - 18, 36, cx - 10, 48); blk(cx - 9, 46, cx - 3, 58); smooth = 1;
  } else {
    ell(cx, cy, rx, ry, 0.42);
  }
  for (let it = 0; it < smooth; it++) {
    const ng = g.map(r => r.slice());
    for (let y = 1; y < H - 1; y++) for (let x = 1; x <= cx; x++) {
      let nb = 0;
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) nb += g[y + yy][x + xx];
      ng[y][x] = nb >= 5 ? 1 : 0;
    }
    g = ng;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x <= cx; x++) if (g[y][x]) { put(x, y); put(W - 1 - x, y); }
  if (!body.size) for (let y = cy - 12; y < cy + 12; y++) for (let x = cx - 12; x < cx + 12; x++) { put(x, y); }

  const topAt = x => { for (let y = 0; y < H; y++) if (has(x, y)) return y; return cy; };
  const botAt = x => { for (let y = H - 1; y >= 0; y--) if (has(x, y)) return y; return cy; };
  const leftAt = y => { for (let x = 0; x < W; x++) if (has(x, y)) return x; return cx; };

  // parts (mirror-symmetric)
  const spike = (x0, y0, dx, len, wd) => {
    for (let i = 0; i < len; i++) for (let w = 0; w < Math.max(1, wd - (i * wd / len) | 0); w++) {
      put(x0 + dx * i + w, y0 - i); put(W - 1 - (x0 + dx * i + w), y0 - i);
    }
  };
  if (opts.dorsal) for (let k = 0; k < 4; k++) { // 背鳍骨板（左右对称）
    const dx0 = cx - 2 - k * 5, ty = topAt(dx0);
    spike(dx0, ty + 1, 0, 5 + (k === 1 ? 3 : 0), 3);
  }
  if (opts.tail) { // 甩向一侧的尾巴（镜像后再画，故意不对称）
    const ty0 = botAt(cx + 8) - 4;
    for (let i = 0; i < 16; i++) {
      const tx = cx + 8 + i, tyy = ty0 - ((i * i) * 0.05 | 0);
      for (let w = 0; w < Math.max(1, 4 - (i / 5 | 0)); w++) put(tx, tyy + w);
    }
  }
  if (opts.horns) spike(cx - 11, topAt(cx - 10) + 2, -1, 9 + (R() * 4 | 0), 4);
  if (opts.ears) spike(cx - 8, topAt(cx - 8) + 1, 0, 6, 3);
  if (opts.wings) {
    const ly = cy - 2 + (R() * 4 | 0);
    for (let i = 0; i < 13; i++) for (let t = 0; t < 9 - (i * 0.6 | 0); t++) {
      const x = leftAt(ly) - 1 - i, y = ly - 4 + t + (i * 0.45 | 0);
      put(x, y); put(W - 1 - x, y);
    }
  }
  const bossBot = botAt(cx);
  if (opts.tentacles) {
    for (let k = -2; k <= 2; k++) {
      const tx = cx + k * 7 - 1, len = 7 + (R() * 5 | 0);
      for (let i = 0; i < len; i++) { put(tx, bossBot + i); put(tx + 1, bossBot + i); put(tx + (i > len - 3 ? (k < 0 ? -1 : 1) : 0), bossBot + i); }
    }
  }
  if (opts.drip) {
    for (let k = 0; k < 5; k++) {
      const dx0 = cx - 14 + (R() * 28 | 0), len = 2 + (R() * 4 | 0), b = botAt(dx0);
      for (let i = 0; i < len; i++) { put(dx0, b + i); put(dx0 + 1, b + i); }
    }
  }
  if (opts.crown) {
    const ty = topAt(cx);
    for (let x = cx - 8; x <= cx + 8; x++) { put(x, ty - 1); put(x, ty - 2); }
    for (let k = -2; k <= 2; k++) { put(cx + k * 4, ty - 3); put(cx + k * 4, ty - 4); }
  }

  // paint with shading
  const base = `hsl(${hue},56%,${opts.dark ? 22 : 48}%)`;
  const dark = `hsl(${hue},60%,${opts.dark ? 10 : 26}%)`;
  const lite = `hsl(${hue},62%,${opts.dark ? 32 : 66}%)`;
  const cells = new Map();
  const crownTopY = opts.crown ? topAt(cx) : -99;
  body.forEach(key => {
    const [x, y] = key.split(",").map(Number);
    const edge = !has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1);
    let c = edge ? dark : base;
    if (!edge && y < cy - ry * 0.25 && x < cx + 2 && x > cx - rx) c = lite;
    if (!edge && prng(seed + x * 131 + y * 31)() < 0.05) c = dark;
    if (opts.crown && y <= crownTopY - 1) c = "#ffc800";
    cells.set(key, c);
  });

  // face: eyes drawn as swappable expression groups (normal / hurt)
  const ey = opts.faceY != null ? opts.faceY : cy - 5, eo = 7 + (opts.eyeSpread || 0);
  let eyesNormal = "", eyesHurt = "";
  const rectAt = (x, y, c) => `<rect x="${x}" y="${y}" width="1.05" height="1.05" fill="${c}"/>`;
  for (const sx of [cx - eo, cx + eo - 4]) {
    if (opts.glowEyes) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) eyesNormal += rectAt(sx + x, ey + y, `hsl(${hue},95%,72%)`);
      for (let x = 0; x < 5; x++) eyesHurt += rectAt(sx + x, ey + 2, `hsl(${hue},60%,45%)`);
    } else {
      for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) {
        if ((y === 0 || y === 4) && (x === 0 || x === 5)) continue;
        eyesNormal += rectAt(sx + x, ey + y, "#f6f7ff");
      }
      const px2 = sx + (sx < cx ? 3 : 1);
      for (let y = 1; y < 4; y++) for (let x = 0; x < 2; x++) eyesNormal += rectAt(px2 + x, ey + y, "#16161f");
      for (let i = 0; i < 5; i++) {
        const bx = sx < cx ? sx + i : sx + 5 - i;
        eyesNormal += rectAt(bx, ey - 2 + (i * 0.5 | 0), "#16161f");
      }
      for (let x = 0; x < 6; x++) eyesHurt += rectAt(sx + x, ey + 2, "#16161f"); // squeezed shut
    }
  }
  const faceGroups = `<g class="fg fg-normal">${eyesNormal}</g><g class="fg fg-hurt">${eyesHurt}</g><g class="fg fg-attack">${eyesNormal}</g><g class="fg fg-happy">${eyesNormal}</g>`;
  // mouth
  const my = ey + 10, mw = opts.mouthW || 14;
  for (let x = cx - mw / 2; x < cx + mw / 2; x++) for (let y = 0; y < 4; y++) cells.set(x + "," + (my + y), "#1b1320");
  if (opts.teeth) for (let x = cx - mw / 2, k = 0; x < cx + mw / 2; x += 3, k++) {
    for (let t = 0; t < 2; t++) { cells.set(x + "," + (my + (k % 2 ? 2 : 0) + t), "#ffffff"); cells.set((x + 1) + "," + (my + (k % 2 ? 2 : 0) + t), "#ffffff"); }
  } else if (!opts.glowEyes) {
    for (let x = cx - mw / 2; x < cx + mw / 2; x++) cells.set(x + "," + (my + 1), `hsl(${hue},45%,35%)`);
  }
  let rects = "";
  cells.forEach((color, key) => {
    const [x, y] = key.split(",");
    rects += `<rect x="${x}" y="${y}" width="1.05" height="1.05" fill="${color}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}${faceGroups}</svg>`;
}
const c0 = "#16161f"; // brow color helper

const BOSS_PRESETS = [
  { hue: 100, drip: 1, mouthW: 18, eyeSpread: 2 },                 // 拼写史莱姆
  { hue: 215, drip: 1, mouthW: 8 },                                 // 假词幽灵
  { hue: 25, horns: 1, teeth: 1, mouthW: 18 },                      // 语法巨魔
  { hue: 270, wings: 1, ears: 1, teeth: 1, mouthW: 10 },            // 听写蝙蝠王
  { hue: 190, tentacles: 1, mouthW: 10, eyeSpread: 3 },             // 长难句海妖
  { hue: 2, horns: 1, wings: 1, teeth: 1, mouthW: 16 },             // 阅读巨龙
  { hue: 252, dark: 1, glowEyes: 1, mouthW: 12 },                   // 暗影评分官
  { hue: 282, crown: 1, ears: 1, teeth: 1, mouthW: 12 },            // 大魔王杜欧
  { hue: 95, plan: "kaiju", teeth: 1, tail: 1, dorsal: 1, faceY: 12, mouthW: 10 },              // 残篇暴龙王
  { hue: 8, plan: "dragon", horns: 1, wings: 1, teeth: 1, tail: 1, faceY: 10, mouthW: 10 },     // 同义烈焰龙
  { hue: 130, plan: "serpent", teeth: 1, faceY: 12, mouthW: 8, eyeSpread: 1 },                  // 从句巨蟒
  { hue: 38, plan: "golem", glowEyes: 1, faceY: 12, mouthW: 8 },                                // 语法魔像
  { hue: 200, plan: "dragon", horns: 1, wings: 1, glowEyes: 1, tail: 1, faceY: 10, mouthW: 9 }, // 雷暴冰龙
  { hue: 330, plan: "kaiju", dark: 1, teeth: 1, tail: 1, dorsal: 1, faceY: 12, mouthW: 12 },    // 错题修罗
  { hue: 18, plan: "kaiju", drip: 1, glowEyes: 1, tail: 1, dorsal: 1, faceY: 12, mouthW: 11 },  // 熔岩古兽
  { hue: 265, plan: "serpent", tentacles: 1, crown: 1, teeth: 1, faceY: 12, mouthW: 10 },       // 深渊词海皇
];
function bossPortrait(n) { // web-avatar boss (every floor); procedural SVG kept as fallback art
  const a = bossAssetOf(n);
  if (a) return `<img id="boss-img" class="boss-img${a.smooth ? "" : " pixel"}" src="mon/${a.key}_battle_0.png" style="${a.css}${a.filter ? `;filter:${a.filter}` : ""}">`;
  return bossSVG(n);
}
function bossSVG(n) {
  if (n < BOSS_PRESETS.length) return genMonster({ seed: 77 + n * 13, ...BOSS_PRESETS[n] });
  const R = prng(n * 997 + 3);
  const plan = ["blob", "kaiju", "dragon", "serpent", "golem"][(R() * 5) | 0];
  return genMonster({
    seed: n * 997 + 3, hue: (n * 47) % 360, plan,
    faceY: plan === "blob" ? null : plan === "dragon" ? 10 : 12,
    tail: plan === "kaiju" || plan === "dragon" ? 1 : 0, dorsal: plan === "kaiju" ? 1 : 0,
    horns: R() < 0.5 ? 1 : 0, wings: R() < 0.35 ? 1 : 0, tentacles: R() < 0.3 ? 1 : 0,
    drip: R() < 0.25 ? 1 : 0, teeth: R() < 0.7 ? 1 : 0, glowEyes: R() < 0.2 ? 1 : 0,
    dark: R() < 0.2 ? 1 : 0, crown: R() < 0.12 ? 1 : 0, mouthW: 10 + (R() * 8 | 0), eyeSpread: (R() * 3 | 0),
  });
}

// ── hero: original anime-swordsman (silver spiky hair, greatcoat, greatsword) ──
// hand-drawn 24×26 base, Scale2x to 48×52; gear layers scale with weapon/armor
const HERO_BASE = [
  ".......aa...a...........",
  "......aaaa.aaa..a.......",
  ".....aaaaaaaaaaaa.......",
  "....aaaaaaaaaaaaa.......",
  "....aAaaaaaaaAaaa.......",
  "....aaffffffffaa........",
  "....Afffffffffa.........",
  "....ffkkffkkff..........",
  "....ffffffffff..........",
  ".....fffJJfff...........",
  "....jjjjJJjjjj..........",
  "...jjjjjjjjjjjj.........",
  "..jjjjjjjjjjjjjj........",
  "..jjjjjjjjjjjjjj........",
  "..jjj.jjjjjj.jjj........",
  "..jjj.jJJjjj.jjj........",
  "..jjj.jjjjjj.jjj........",
  "..fff.jjjjjj.fff........",
  "......pppppp............",
  "......pppppp............",
  "......pp..pp............",
  "......pp..pp............",
  "......pp..pp............",
  "......pp..pp............",
  ".....BBB..BBB...........",
  ".....BBB..BBB...........",
];
const ARMOR_TIERS = [
  ["#3a4a63", "#252f42"], ["#5d6675", "#3c424e"], ["#2f6e4f", "#1e4a34"], ["#5d3f93", "#3e2a64"],
  ["#8e3038", "#5e1f25"], ["#9a741d", "#6b5013"], ["#1b87b0", "#11576f"], ["#2a2a35", "#17171f"],
];
const BLADE_TIERS = ["#c4ccda", "#8e99ad", "#ffc800", "#ff9c2b", "#2cc8ff", "#7ff7ff", "#8a5fd0", "#3fae6a",
  "#7dff9e", "#ff6b6b", "#f4f6ff", "#ffd84d"]; // cycles forever — every upgrade shifts the hue
const bladeColor = w => BLADE_TIERS[w % BLADE_TIERS.length];
function scale2x(grid) {
  const H = grid.length, W = Math.max(...grid.map(r => r.length));
  const at = (x, y) => (y < 0 || y >= H || x < 0 || x >= (grid[y] || "").length) ? "." : grid[y][x];
  const out = Array.from({ length: H * 2 }, () => new Array(W * 2).fill("."));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
    out[y * 2][x * 2] = (C === A && C !== D && A !== B) ? A : P;
    out[y * 2][x * 2 + 1] = (A === B && A !== C && B !== D) ? B : P;
    out[y * 2 + 1][x * 2] = (D === C && D !== B && C !== A) ? C : P;
    out[y * 2 + 1][x * 2 + 1] = (B === D && B !== A && D !== C) ? D : P;
  }
  return out.map(r => r.join(""));
}
// modular part library — combat level recombines SHAPES, palette tier recolors
const HAIRS = [
  [ // 利落刺发
    ".......aa...a...........",
    "......aaaa.aaa..a.......",
    ".....aaaaaaaaaaaa.......",
    "....aaaaaaaaaaaaa.......",
    "....aAaaaaaaaAaaa.......",
  ],
  [ // 披肩长发
    "......aaaaaaaaaa........",
    ".....aaaaaaaaaaaa.......",
    "....aaaaaaaaaaaaaa......",
    "...aaaAaaaaaaAaaaa......",
    "...aa.aaaaaaaaa.aa......",
  ],
  [ // 战斗鸡冠
    "..........aaa...........",
    ".........aaaa...........",
    "........aaaaa...........",
    "......aaaaaaaa..........",
    "....aAaaaaaaaAaa........",
  ],
  [ // 后扎马尾
    ".....aaaaaaaaa..........",
    "....aaaaaaaaaaa..aa.....",
    "....aaaaaaaaaaaaaaaa....",
    "....aAaaaaaaaAaa..aa....",
    "....aaaaaaaaaa....a.....",
  ],
];
const TORSOS = [
  [ // 束腰大衣（标准）
    "....jjjjJJjjjj..........",
    "...jjjjjjjjjjjj.........",
    "..jjjjjjjjjjjjjj........",
    "..jjjjjjjjjjjjjj........",
    "..jjj.jjjjjj.jjj........",
    "..jjj.jJJjjj.jjj........",
    "..jjj.jjjjjj.jjj........",
    "..fff.jjjjjj.fff........",
    "......pppppp............",
    "......pppppp............",
    "......pp..pp............",
    "......pp..pp............",
  ],
  [ // 长风衣（下摆开衩）
    "....jjjjJJjjjj..........",
    "...jjjjjjjjjjjj.........",
    "..jjjjjjJJjjjjjj........",
    "..jjjjjjJJjjjjjj........",
    "..jjj.jjJJjj.jjj........",
    "..jjj.jjJJjj.jjj........",
    "..jjj.jjjjjj.jjj........",
    "..fff.jjjjjj.fff........",
    ".....jjjjjjjj...........",
    "....jjj.pp.jjj..........",
    "....jj..pp..jj..........",
    "....j...pp...j..........",
  ],
  [ // 铠甲胸挂
    "....jjjjJJjjjj..........",
    "...jxxxxxxxxxxj.........",
    "..jjxxxxxxxxxxjj........",
    "..jjxxxxggxxxxjj........",
    "..jjj.xxxxxx.jjj........",
    "..jjj.xxxxxx.jjj........",
    "..jjj.xxggxx.jjj........",
    "..fff.xxxxxx.fff........",
    "......pppppp............",
    "......pppppp............",
    "......pp..pp............",
    "......pp..pp............",
  ],
];
const HAIR_TIERS = [
  ["#e9eaf4", "#b7bdd2"], ["#ffd84d", "#caa52e"], ["#ff6b6b", "#c43c3c"], ["#5ad1ff", "#2a93c4"],
  ["#c77dff", "#8a4fd0"], ["#7dff9e", "#3fae6a"], ["#ffe9c9", "#d8a52e"], ["#3a3a4a", "#94203a"],
];
const EYE_TIERS = ["#2cc8ff", "#ffc800", "#ff5a5a", "#7dff9e", "#ff5af0", "#ffffff", "#ffae3a", "#ff2222"];
function heroSVG(w = 0, a = 0, clv = 0) {
  const tier = Math.min(Math.floor(clv / 5), HAIR_TIERS.length - 1);
  const grid = HERO_BASE.map(r => r.split(""));
  // shape recombination: hair swaps EVERY level, coat silhouette every 2 levels
  const hair = HAIRS[clv % HAIRS.length];
  hair.forEach((row, y) => { grid[y] = row.split(""); });
  const torso = TORSOS[Math.floor(clv / 2) % TORSOS.length];
  torso.forEach((row, y) => { grid[10 + y] = row.split(""); });
  const putc = (x, y, ch) => { if (grid[y] && x >= 0 && x < 24) grid[y][x] = ch; };
  if (clv >= 10) { for (const hx of [7, 9, 11, 13]) putc(hx, 0, "g"); } // battle-worn halo studs
  if (a >= 3) { // metal pauldrons
    for (const px of [2, 3, 13, 14]) { putc(px, 12, "x"); putc(px, 13, "x"); }
  }
  if (a >= 5) for (let y = 11; y <= 22; y++) { putc(0, y, "q"); putc(1, y, "q"); } // flowing cape
  if (a >= 7) { // gold trim on the coat
    for (let y = 11; y <= 17; y++) { if (grid[y][6] === "j") putc(6, y, "g"); if (grid[y][9] === "j") putc(9, y, "g"); }
    putc(11, 9, "g"); putc(12, 9, "g");
  }
  // sword SHAPE rotates with combat level (every 2), length with weapon tier,
  // core color with weapon tier, edge highlight with the combat-level palette
  const bladeLen = Math.min(9 + w * 2, 22);
  const sword = HERO_BASE.map(() => "........................".split(""));
  const handY = 17;
  const putS = (x, y, ch) => { if (y >= 0 && y < sword.length && x >= 0 && x < 24) sword[y][x] = ch; };
  const style = Math.floor((clv + 1) / 2) % 4;
  if (style === 0) { // 直刃巨剑
    for (let i = 0; i < bladeLen; i++) {
      putS(17, handY - 2 - i, "s"); putS(18, handY - 2 - i, "s");
      if (i < bladeLen - 2) putS(19, handY - 2 - i, "S");
    }
    putS(18, handY - 2 - bladeLen, "s");
  } else if (style === 1) { // 巨型砍刀（宽体平头）
    for (let i = 0; i < bladeLen - 2; i++) {
      putS(16, handY - 2 - i, "s"); putS(17, handY - 2 - i, "s"); putS(18, handY - 2 - i, "s");
      putS(19, handY - 2 - i, "S");
    }
    putS(17, handY - 1 - bladeLen, "s"); putS(18, handY - 1 - bladeLen, "s");
  } else if (style === 2) { // 层错弯刃（阶梯曲线）
    for (let i = 0; i < bladeLen; i++) {
      const off = Math.floor(i / 4);
      putS(17 + off, handY - 2 - i, "s");
      putS(18 + off, handY - 2 - i, i < bladeLen - 2 ? "S" : "s");
    }
  } else { // 双叉刃（中空双锋）
    for (let i = 0; i < bladeLen - 3; i++) {
      putS(16, handY - 2 - i, "s"); putS(19, handY - 2 - i, "S");
    }
    for (let i = Math.max(0, bladeLen - 3); i < bladeLen; i++) {
      putS(17, handY - 2 - i, "s"); putS(18, handY - 2 - i, "s");
    }
    putS(17, handY - 3, "s"); putS(18, handY - 3, "s");
  }
  for (const gx of [16, 17, 18, 19, 20]) putS(gx, handY - 1, "g");
  putS(18, handY, "m"); putS(18, handY + 1, "m");
  const [am, ad] = ARMOR_TIERS[Math.min(a, ARMOR_TIERS.length - 1)];
  const pal = {
    a: HAIR_TIERS[tier][0], A: HAIR_TIERS[tier][1],
    f: "#f2c9a0", k: EYE_TIERS[tier],
    j: am, J: ad, p: "#262b38", B: "#171c26",
    q: "#6e2433", x: "#aab4c4", g: "#ffc800", m: "#4a3625",
    s: bladeColor(w), S: EYE_TIERS[tier],
  };
  // bucket cells into animatable parts (legs stride, arms swing, face emotes)
  const buckets = { body: [], armL: [], armR: [], legL: [], legR: [] };
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < 24; x++) {
    const ch = grid[y][x];
    if (ch === "." || !pal[ch]) continue;
    if (y === 7 && ch === "k") continue; // eyes live in the face groups
    let b = "body";
    if (y >= 14 && y <= 17 && x <= 4 && "jfx".includes(ch)) b = "armL";
    else if (y >= 14 && y <= 17 && x >= 13 && x <= 16 && "jfx".includes(ch)) b = "armR";
    else if (y >= 18 && "pB".includes(ch)) b = x < 9 ? "legL" : "legR";
    buckets[b].push([x, y, ch]);
  }
  const cellsToRects = cells => cells.map(([x, y, ch]) => `<rect x="${x * 2}" y="${y * 2}" width="2.1" height="2.1" fill="${pal[ch]}"/>`).join("");
  const swordCells = [];
  sword.forEach((row, y) => row.forEach((ch, x) => { if (ch !== "." && pal[ch]) swordCells.push([x, y, ch]); }));
  // face variants drawn at the base eye coordinates (row 7, cols 6-7 & 10-11)
  const k = pal.k, dk = "#181824";
  const px = (x, y, c) => `<rect x="${x * 2}" y="${y * 2}" width="2.1" height="2.1" fill="${c}"/>`;
  const faceNormal = px(6, 7, k) + px(7, 7, k) + px(10, 7, k) + px(11, 7, k);
  const faceHurt = [5, 6, 7].map(x => px(x, 7, dk)).join("") + [9, 10, 11].map(x => px(x, 7, dk)).join("");
  const faceHappy = px(5, 7, dk) + px(6, 6, dk) + px(7, 7, dk) + px(9, 7, dk) + px(10, 6, dk) + px(11, 7, dk);
  const faceAttack = px(6, 7, k) + px(10, 7, k) + px(5, 6, dk) + px(6, 6, dk) + px(11, 6, dk) + px(12, 6, dk);
  return `<svg viewBox="0 0 48 52" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    <g class="prt body">${cellsToRects(buckets.body)}</g>
    <g class="prt armL">${cellsToRects(buckets.armL)}</g>
    <g class="prt armR">${cellsToRects(buckets.armR)}</g>
    <g class="prt legL">${cellsToRects(buckets.legL)}</g>
    <g class="prt legR">${cellsToRects(buckets.legR)}</g>
    <g class="fg fg-normal">${faceNormal}</g>
    <g class="fg fg-hurt">${faceHurt}</g>
    <g class="fg fg-happy">${faceHappy}</g>
    <g class="fg fg-attack">${faceAttack}</g>
    <g class="sword-layer" style="transform-box:fill-box;transform-origin:70% 95%">${cellsToRects(swordCells)}</g>
  </svg>`;
}


const weaponName = w => WEAPONS[Math.min(w, WEAPONS.length - 1)] + (w >= WEAPONS.length ? ` +${w - WEAPONS.length + 1}` : "");
const armorName = a => ARMORS[Math.min(a, ARMORS.length - 1)] + (a >= ARMORS.length ? ` +${a - ARMORS.length + 1}` : "");
// hero gear and boss stats grow on the SAME exponential base (1.35/1.3):
// keep gear roughly at the boss floor and every kill stays well under 5 min
const atkOf = w => Math.round(12 * Math.pow(1.35, w));
const maxHpOf = a => Math.round(120 * Math.pow(1.3, a));
const weaponCost = w => Math.round(180 * Math.pow(1.35, w));
const armorCost = a => Math.round(150 * Math.pow(1.3, a));
const POTION_COST = 30;
const BASE_CLEAR_REWARD = 60; // finishing the base daily quests pays by itself
// idle-battle economy: battle TIME is earned by practicing, feathers only buy gear.
// 1 item = +30s of auto-battle → a 25-min session (~20 items) funds ~10 min of battle.
// Feathers can NOT buy battle time, so boss drops can't be farmed without practicing.
const ENERGY_PER_ITEM = 30, ENERGY_CAP = 7200;
// 4 hits/sec for juicy combat; per-hit damage is ATK/4, boss counter is /8 per
// hit, so per-second numbers stay sane while the screen stays busy
const ATTACK_PERIOD_S = 0.25;
const bossOf = n => {
  const a = bossAssetOf(n);
  return { icon: a.icon, name: (a.vName || "") + a.species, lvl: n };
};
const bossMaxHp = n => Math.round(500 * Math.pow(1.35, n));
const bossAtk = n => Math.round(8 * Math.pow(1.25, n));
const killReward = n => Math.round(100 * Math.pow(1.35, n)); // one kill ≈ 0.55 weapon upgrades
// 打怪升级: combat level (separate from practice XP) — kills feed it, it feeds
// hero stats AND the hero's generated look
const killCxp = n => Math.round(50 * Math.pow(1.35, n));
const cxpNeed = lv => Math.round(120 * Math.pow(1.4, lv));
// 称号随战斗等级进阶（每 3 级一换）
// 称号随勇者形态阶梯演进，与立绘一致（夜读 → 重甲 → 剑皇）
const titleOf = g => {
  const f = heroFormFor(g), clv = (g && g.clv) || 0;
  return f.titles[Math.min(Math.floor((clv - f.min) / 3), f.titles.length - 1)];
};
const REBIRTH_FLOOR = 25; // reaching this floor unlocks rebirth — numbers never exceed ~百万
const effAtk = g => Math.round(atkOf(g.weapon) * (1 + 0.05 * (g.clv || 0)) * (1 + 0.25 * (g.reborn || 0)));
const heroMaxHp = g => Math.round(maxHpOf(g.armor) * (1 + 0.04 * (g.clv || 0)));
const towerReward = t => 80 + 50 * (t - 1) + 15 * (t - 1) * (t - 1); // t1:80 t2:145 t3:240 t4:365 …
// keep huge numbers readable: 12.3万 / 1.08亿
function fmtNum(n) {
  n = Math.round(n);
  if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, "") + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, "") + "万";
  return String(n);
}

function getGame() {
  const g = Object.assign(
    { coins: 0, weapon: 0, armor: 0, hp: 100, bossIndex: 0, bossHp: 120, kills: [], day: "", towerClaimed: 0, blog: [], energy: 0, clv: 0, cxp: 0, reborn: 0 },
    JSON.parse(localStorage.getItem("det_game") || "{}"));
  // curve migration: clamp legacy boss HP onto the new (much flatter) curve
  if (g.bossHp > bossMaxHp(g.bossIndex)) g.bossHp = bossMaxHp(g.bossIndex);
  const today = dayKey(Date.now());
  if (g.day !== today) { // new day: free full heal + tower resets
    g.day = today; g.hp = maxHpOf(g.armor); g.towerClaimed = 0;
    saveGame(g);
  }
  if (g.hp <= 0) g.hp = heroMaxHp(g); // legacy stuck-down saves revive on load
  return g;
}
function saveGame(g) { localStorage.setItem("det_game", JSON.stringify(g)); }
function blogPush(g, msg) { g.blog.unshift(msg); g.blog = g.blog.slice(0, 8); }

// ───────────────────── sentence-structure challenges ─────────────────────
const STRUCTURES = [
  { name: "让步 Although", tpl: "Although + 从句, 主句", ex: "Although I was tired, I finished the report." },
  { name: "虚拟条件 If I were", tpl: "If I were …, I would …", ex: "If I were the mayor, I would build more parks." },
  { name: "非限定从句 which", tpl: "…, which + 补充说明", ex: "I cook at home, which saves me a lot of money." },
  { name: "强调句 It is … that", tpl: "It is X that …", ex: "It is consistency that matters most." },
  { name: "Not only 倒装", tpl: "Not only does …, but it also …", ex: "Not only does it save time, but it also reduces stress." },
  { name: "分词状语", tpl: "V-ing …, 主句", ex: "Living in a big city, I rely on the subway every day." },
  { name: "The more … the more", tpl: "The more …, the more …", ex: "The more I practice, the more confident I become." },
  { name: "What 主语从句", tpl: "What I value most is …", ex: "What I value most is honesty." },
  { name: "Despite + 名词", tpl: "Despite + n., 主句", ex: "Despite the high cost, I think it is worth it." },
  { name: "would rather … than", tpl: "I would rather … than …", ex: "I would rather cook at home than eat out." },
  { name: "so … that", tpl: "so + adj. + that …", ex: "The lecture was so engaging that nobody left early." },
  { name: "Instead of + V-ing", tpl: "Instead of V-ing, …", ex: "Instead of complaining, we proposed a solution." },
  { name: "Only when 倒装", tpl: "Only when … do/did I …", ex: "Only when I moved abroad did I understand independence." },
  { name: "As long as", tpl: "As long as …, …", ex: "As long as I plan ahead, I rarely miss deadlines." },
  { name: "Take … for example", tpl: "Take … for example. …", ex: "Take my roommate for example. He studies with music on." },
  { name: "While 对比", tpl: "While some people …, others …", ex: "While some people enjoy crowds, others need quiet." },
];
function pickChallenge() { return pick(STRUCTURES); }
function challengeHTML(c) {
  return `<div class="prompt-box" style="font-size:14px;border:1px dashed var(--warn)">🎯 <b>句式挑战</b>：${esc(c.name)} — ${esc(c.tpl)}<br><span class="muted">例：${esc(c.ex)}</span></div>`;
}
const challengeClause = c => `\n本题给考生的句式挑战是：${c.name}（${c.tpl}，例：${c.ex}）。请在点评末尾单独加一节 **句式挑战**：判断考生是否用上了这个句式；若没用或用错，用考生自己的内容示范一句正确用法。`;

// transcript box (editable so a failed auto-transcription can be fixed by hand)
function transcriptBox(parent, text) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p class="muted" style="margin-top:10px">语音转写（可手动修正后再点 AI 点评）：</p>
    <textarea class="transcript" style="min-height:90px">${esc(text || "")}</textarea>`;
  parent.appendChild(wrap);
  return wrap.querySelector("textarea");
}

// ───────────────────── generic speaking task runner ─────────────────────
// cfg: {view, title, sub, prepSec, speakSec, renderPrompt(box)→cleanup?, audioPrompt(text)?, logName}
function speakingTask(cfg) {
  const view = $(`#view-${cfg.view}`);
  let cancelFns = [];
  const cancelAll = () => { cancelFns.forEach(f => f()); cancelFns = []; stopSpeak(); };

  function idle() {
    cancelAll();
    view.innerHTML = `
      <h2>${cfg.title}</h2>
      <p class="subtitle">${cfg.sub}</p>
      <div class="card">
        <div id="sp-prompt"></div>
        <button class="primary" id="sp-start">开始一题 ▶</button>
        ${cfg.extraIdleHtml || ""}
      </div>
      <div id="sp-history"></div>`;
    $("#sp-start", view).onclick = run;
    if (cfg.genKey) attachGenUI(view, cfg.genKey, cfg.baseArr);
  }

  async function run() {
    cancelAll();
    const item = cfg.nextItem();
    view.innerHTML = `
      <h2>${cfg.title}</h2>
      <div class="card">
        <div id="sp-prompt"></div>
        <div class="timer-label" id="sp-label"></div>
        <div class="timer" id="sp-timer">--:--</div>
        <div class="progress-bar"><div id="sp-bar"></div></div>
        <div style="text-align:center">
          <button class="ghost" id="sp-stop">提前结束本题</button>
        </div>
      </div>`;
    const promptBox = $("#sp-prompt", view), label = $("#sp-label", view),
          timerEl = $("#sp-timer", view), bar = $("#sp-bar", view);
    let aborted = false, stream = null;
    const challenge = cfg.structureChallenge ? pickChallenge() : null;
    $("#sp-stop", view).onclick = () => { aborted = true; cancelAll(); stopStream(stream); finish(item, null, "", challenge); };

    // mic first so permission prompt doesn't eat prep time
    let micFailed = false;
    try { stream = await getMic(); }
    catch { micFailed = true; }
    if (aborted) { stopStream(stream); return; }

    // 1) present prompt (may speak it aloud); wait for photos so prep isn't wasted
    const hideDuringPrep = await cfg.renderPrompt(promptBox, item);
    if (challenge) promptBox.insertAdjacentHTML("beforeend", challengeHTML(challenge));
    if (micFailed) promptBox.insertAdjacentHTML("afterbegin", `<div class="banner-warn">无法访问麦克风——请用 HTTPS 地址打开并允许麦克风权限。本题将只计时不录音。</div>`);
    await waitImgs(promptBox);
    if (aborted) return;

    // 2) prep countdown
    if (cfg.prepSec) {
      label.textContent = "准备时间";
      const t = runTimer(timerEl, cfg.prepSec, { cls: "prep", barEl: bar });
      cancelFns.push(t.cancel);
      const finished = await t.promise;
      if (!finished || aborted) return;
    }
    if (hideDuringPrep) hideDuringPrep();

    // 3) record (+ live transcription for AI feedback)
    label.textContent = "🔴 正在录音 — 一直说，不要停！";
    let recorder = null, tr = null;
    if (stream) { recorder = startRecording(stream); tr = startTranscript(); }
    const t2 = runTimer(timerEl, cfg.speakSec, { cls: "go", barEl: bar });
    cancelFns.push(t2.cancel);
    $("#sp-stop", view).onclick = () => { t2.cancel(); };
    await t2.promise;
    let blob = null, transcript = "";
    if (recorder) { recorder.stop(); blob = await recorder.done; }
    if (tr) transcript = await tr.stop();
    stopStream(stream);
    finish(item, blob, transcript, challenge);
  }

  function finish(item, blob, transcript, challenge) {
    logPractice(cfg.logName, cfg.itemLabel ? cfg.itemLabel(item) : "");
    view.innerHTML = `
      <h2>${cfg.title}</h2>
      <div class="card">
        <h3>✅ 完成！回听一下自己：</h3>
        <div id="sp-prompt-after"></div>
        ${blob ? `<audio controls src="${URL.createObjectURL(blob)}"></audio>` : `<p class="muted">（本题未录音）</p>`}
        <div id="sp-extra"></div>
        <p class="muted" style="margin-top:10px">自查 6 项：内容量 / 连贯 / 流利（停顿？um?）/ 语法 / 词汇 / 发音。<b>说满时间</b>是第一目标。</p>
        <button class="primary" id="sp-again">再来一题 ▶</button>
        <button class="ghost" id="sp-back">返回</button>
      </div>`;
    if (cfg.renderAfter) cfg.renderAfter($("#sp-prompt-after", view), item);
    const extra = $("#sp-extra", view);
    if (challenge) extra.insertAdjacentHTML("beforeend", challengeHTML(challenge));
    const ta = transcriptBox(extra, transcript);
    if (!transcript) fillTranscriptFromServer(ta, blob);
    aiFeedbackButton(extra, "AI 点评（DeepSeek）", () => ({
      system: SPEAK_RATER,
      user: `题型：${cfg.title}（限时 ${cfg.speakSec} 秒）\n题目：${cfg.promptText ? cfg.promptText(item) : "(看图描述)"}\n考生回答（语音转写）：\n${ta.value.trim() || "(空)"}${challenge ? challengeClause(challenge) : ""}`,
      maxTokens: 3200,
    }));
    $("#sp-again", view).onclick = run;
    $("#sp-back", view).onclick = idle;
  }

  return { idle, run };
}

// ───────────────────── Interactive Speaking (adaptive topic session) ─────────────────────
const IS_EXAMINER = `You are the examiner in the Duolingo English Test "Interactive Speaking" task.
Given the topic and the candidate's previous answers (speech transcripts, may contain transcription errors), ask ONE natural follow-up question (max 22 words) that digs deeper into what the candidate just said — exactly like the real adaptive test.
Reply with ONLY the question. No quotes, no preamble.`;

function setupIS() {
  const view = $("#view-is");
  const TOTAL = 4;
  let session = null; // {topic, history: [{q, a}]}

  function idle() {
    stopSpeak();
    view.innerHTML = `
      <h2>即兴问答 Interactive Speaking</h2>
      <p class="subtitle">考试中最重要的口语题（6–8 题）。问题<b>只朗读一次</b>，读完立即开始 35 秒计时录音。
      一轮 = 1 个话题 × ${TOTAL} 题，<b>追问由 DeepSeek 根据你刚才说的内容实时生成</b>——和真实考试的自适应追问一样。</p>
      <div class="card">
        <button class="primary" id="is-start">开始一轮（${TOTAL} 题）▶</button>
        <p class="muted" style="margin-top:8px">技巧：直接回答 + 一个理由 + 一个例子，说满 35 秒。听不清也不要沉默，围绕话题继续说。</p>
      </div>`;
    $("#is-start", view).onclick = () => {
      session = { topic: drawFrom("istopic", DATA.interactiveSpeaking), history: [] };
      ask(session.topic.questions[0]);
    };
  }

  async function nextQuestion() {
    const lastAns = session.history[session.history.length - 1]?.a || "";
    if (lastAns.split(/\s+/).filter(Boolean).length >= 5) {
      try {
        const convo = session.history.map((h, i) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a || "(no transcript)"}`).join("\n");
        const q = (await aiChat(IS_EXAMINER, `Topic: ${session.topic.topic}\n${convo}\nNext follow-up question:`, 600)).trim().replace(/^["']|["']$/g, "");
        if (q && q.length < 200) return q;
      } catch {}
    }
    // fallback: unused bank question from this topic
    const used = new Set(session.history.map(h => h.q));
    return session.topic.questions.find(q => !used.has(q)) || pick(session.topic.questions);
  }

  async function ask(q) {
    const num = session.history.length + 1;
    view.innerHTML = `
      <h2>即兴问答 · 第 ${num}/${TOTAL} 题 <span class="muted" style="font-size:14px">话题：${esc(session.topic.topic)}</span></h2>
      <div class="card">
        <div class="prompt-box" id="is-q">🔊 听仔细——问题只读一遍…</div>
        <div class="timer-label" id="is-label">正在朗读问题</div>
        <div class="timer prep" id="is-timer">--:--</div>
        <div class="progress-bar"><div id="is-bar"></div></div>
        <div style="text-align:center"><button class="ghost" id="is-quit">结束本轮</button></div>
      </div>`;
    let quit = false, stream = null;
    $("#is-quit", view).onclick = () => { quit = true; stopSpeak(); stopStream(stream); idle(); };

    try { stream = await getMic(); } catch {}
    if (quit) { stopStream(stream); return; }

    await speak(q);
    if (quit) return;

    $("#is-label", view).textContent = "🔴 正在录音 — 35 秒说满！";
    let recorder = stream ? startRecording(stream) : null;
    let tr = stream ? startTranscript() : null;
    const t = runTimer($("#is-timer", view), 35, { cls: "go", barEl: $("#is-bar", view) });
    $("#is-quit", view).onclick = () => t.cancel();
    await t.promise;
    let blob = null, transcript = "";
    if (recorder) { recorder.stop(); blob = await recorder.done; }
    if (tr) transcript = await tr.stop();
    stopStream(stream);
    session.history.push({ q, a: transcript });
    logPractice("is", `${session.topic.topic} Q${num}`);

    const last = num >= TOTAL;
    view.innerHTML = `
      <h2>即兴问答 · 第 ${num}/${TOTAL} 题完成</h2>
      <div class="card">
        <p class="muted">刚才的问题是：</p>
        <div class="prompt-box">${esc(q)}</div>
        ${blob ? `<audio controls src="${URL.createObjectURL(blob)}"></audio>` : `<p class="muted">（未录音）</p>`}
        <div id="is-extra"></div>
        <button class="primary" id="is-next">${last ? "本轮结束 🎉 再来一轮 ▶" : "下一个追问 ▶"}</button>
        <button class="ghost" id="is-back">返回</button>
      </div>`;
    const extra = $("#is-extra", view);
    const ta = transcriptBox(extra, transcript);
    ta.oninput = () => { session.history[session.history.length - 1].a = ta.value.trim(); };
    if (!transcript) fillTranscriptFromServer(ta, blob); // input event also syncs session history for AI follow-ups
    aiFeedbackButton(extra, "AI 点评这一答（DeepSeek）", () => ({
      system: SPEAK_RATER,
      user: `题型：Interactive Speaking（35 秒即兴问答）\n问题：${q}\n考生回答（语音转写）：\n${ta.value.trim() || "(空)"}`,
      maxTokens: 3200,
    }));
    $("#is-next", view).onclick = async () => {
      if (last) { session = { topic: drawFrom("istopic", DATA.interactiveSpeaking), history: [] }; ask(session.topic.questions[0]); return; }
      const btn = $("#is-next", view);
      btn.disabled = true; btn.textContent = "🤖 考官正在想追问…";
      ask(await nextQuestion());
    };
    $("#is-back", view).onclick = idle;
  }
  idle();
  return idle;
}

// ───────────────────── Listen and Type ─────────────────────
function setupLT() {
  const view = $("#view-lt");
  function idle() {
    view.innerHTML = `
      <h2>听写句子 Listen and Type</h2>
      <p class="subtitle">考试 6–9 题，每题 1 分钟，最多听 3 遍，<b>部分计分</b>（拼写、单复数、时态都算）。计入 Listening。</p>
      <div class="card"><button class="primary" id="lt-start">开始 ▶</button></div>`;
    $("#lt-start", view).onclick = run;
    attachGenUI(view, "lt", DATA.listenAndType);
  }
  function run() {
    const sentence = drawFrom("lt", DATA.listenAndType);
    let plays = 0;
    view.innerHTML = `
      <h2>听写句子</h2>
      <div class="card">
        <div style="text-align:center;margin-bottom:10px">
          <button class="secondary" id="lt-play">🔊 播放（剩 3 次）</button>
        </div>
        <div class="timer-label">作答时间</div>
        <div class="timer go" id="lt-timer">--:--</div>
        <input type="text" id="lt-input" placeholder="听到什么就输入什么，注意拼写和标点" autocomplete="off">
        <div style="margin-top:12px">
          <button class="primary" id="lt-submit">提交</button>
          <button class="ghost" id="lt-back">返回</button>
        </div>
      </div>`;
    const playBtn = $("#lt-play", view);
    playBtn.onclick = () => {
      if (plays >= 3) return;
      plays++;
      playBtn.textContent = `🔊 播放（剩 ${3 - plays} 次）`;
      if (plays >= 3) playBtn.disabled = true;
      speak(sentence);
    };
    playBtn.click();
    const t = runTimer($("#lt-timer", view), 60);
    t.promise.then(done => { if (done) grade(); });
    function grade() {
      t.cancel(); stopSpeak();
      const ans = $("#lt-input", view).value.trim();
      const norm = s => s.toLowerCase().replace(/[^a-z0-9' ]/g, "").split(/\s+/).filter(Boolean);
      const target = norm(sentence), got = norm(ans);
      const correct = target.filter((w, i) => got[i] === w).length;
      const pct = Math.round((correct / target.length) * 100);
      logPractice("lt", `${pct}%`, pct >= 80);
      const gotSet = new Set(got);
      const missed = [...new Set(target.filter(w => w.length >= 4 && !gotSet.has(w)))].slice(0, 3);
      const nAdded = addVocab(missed, "听写", sentence);
      if (pct < 80) addWrong("lt", sentence, ans || "(空)", sentence);
      view.innerHTML = `
        <h2>听写句子 · 结果</h2>
        <div class="card">
          <p>词序匹配：<span class="${pct >= 80 ? "result-good" : "result-bad"}">${correct}/${target.length}（${pct}%）</span></p>
          ${vocabNote(nAdded)}
          <p class="muted" style="margin-top:8px">原句：</p>
          <div class="prompt-box">${esc(sentence)}</div>
          <p class="muted">你写的：</p>
          <div class="prompt-box">${esc(ans) || "（空）"}</div>
          <button class="primary" id="lt-again">下一句 ▶</button>
          <button class="ghost" id="lt-back2">返回</button>
        </div>`;
      $("#lt-again", view).onclick = run;
      $("#lt-back2", view).onclick = idle;
    }
    $("#lt-submit", view).onclick = grade;
    $("#lt-back", view).onclick = () => { t.cancel(); stopSpeak(); idle(); };
    $("#lt-input", view).focus();
  }
  idle();
  return idle;
}

// ───────────────────── Summarize the Conversation ─────────────────────
function setupSUM() {
  const view = $("#view-sum");
  function idle() {
    view.innerHTML = `
      <h2>对话摘要 Summarize the Conversation</h2>
      <p class="subtitle">听一段校园对话（只放一遍），然后 <b>75 秒</b>写摘要。<b>同时计入 Listening 和 Writing 两个单项</b>。
      抓三点：谁、什么问题、什么建议/结果。</p>
      <div class="card"><button class="primary" id="sum-start">开始 ▶</button></div>`;
    $("#sum-start", view).onclick = run;
    attachGenUI(view, "sum", DATA.summarize);
  }
  async function run() {
    const conv = drawFrom("sum", DATA.summarize);
    view.innerHTML = `
      <h2>对话摘要</h2>
      <div class="card">
        <div class="prompt-box" id="sum-status">🔊 正在播放对话（只放一遍，认真听）…</div>
        <div style="text-align:center"><button class="ghost" id="sum-skip">跳过播放（调试用）</button></div>
      </div>`;
    let skipped = false;
    $("#sum-skip", view).onclick = () => { skipped = true; stopSpeak(); };
    for (const [who, line] of conv.lines) {
      if (skipped) break;
      $("#sum-status", view).textContent = `🔊 ${who} 正在说…`;
      await speak(line, { pitch: who.includes("Student") && !who.includes("B") ? 1.15 : 0.85 });
    }
    write(conv);
  }
  function write(conv) {
    view.innerHTML = `
      <h2>对话摘要 · 写下来</h2>
      <div class="card">
        <div class="timer-label">75 秒</div>
        <div class="timer go" id="sum-timer">--:--</div>
        <textarea id="sum-text" placeholder="Summarize: who talked, what was the problem, what was suggested or decided."></textarea>
        <div class="wordcount" id="sum-wc">0 词</div>
        <button class="primary" id="sum-done">提交</button>
      </div>`;
    const ta = $("#sum-text", view);
    ta.oninput = () => $("#sum-wc", view).textContent = `${ta.value.trim().split(/\s+/).filter(Boolean).length} 词`;
    const t = runTimer($("#sum-timer", view), 75);
    const finish = () => {
      t.cancel();
      const words = ta.value.trim().split(/\s+/).filter(Boolean).length;
      logPractice("sum", `${conv.title} ${words}w`);
      view.innerHTML = `
        <h2>对话摘要 · 完成</h2>
        <div class="card">
          <p>你写了 <b>${words}</b> 词。对照原文检查要点：</p>
          <div class="prompt-box" style="font-size:15px">${conv.lines.map(l => `<b>${esc(l[0])}:</b> ${esc(l[1])}`).join("<br>")}</div>
          <p class="muted">你的摘要：</p>
          <div class="prompt-box" style="font-size:15px">${esc(ta.value) || "（空）"}</div>
          <div id="sum-extra"></div>
          <button class="primary" id="sum-again">再来一段 ▶</button>
          <button class="ghost" id="sum-back">返回</button>
        </div>`;
      aiFeedbackButton($("#sum-extra", view), "AI 点评（DeepSeek）", () => ({
        system: WRITE_RATER + "\n本题是 Summarize the Conversation（75 秒听完对话写摘要，同时计入 Listening 和 Writing）。content 维度重点看是否抓住：谁、什么问题、什么建议/结果。",
        user: `对话原文：\n${conv.lines.map(l => `${l[0]}: ${l[1]}`).join("\n")}\n\n考生摘要：\n${ta.value.trim() || "(空)"}`,
      }));
      $("#sum-again", view).onclick = run;
      $("#sum-back", view).onclick = idle;
    };
    t.promise.then(done => { if (done) finish(); });
    $("#sum-done", view).onclick = finish;
    ta.focus();
  }
  idle();
  return idle;
}

// ───────────────────── Read and Select ─────────────────────
function setupRS() {
  const view = $("#view-rs");
  function idle() {
    view.innerHTML = `
      <h2>真假词 Read and Select</h2>
      <p class="subtitle">考试 15–18 题，每题 <b>5 秒</b>：判断是不是真实英文单词。假词答 Yes 会扣分——<b>不确定就选 No</b>。一轮 10 题。</p>
      <div class="card"><button class="primary" id="rs-start">开始一轮 ▶</button></div>`;
    $("#rs-start", view).onclick = () => round(0, 0, []);
  }
  function round(i, score, history) {
    if (i >= 10) return result(score, history);
    const isReal = Math.random() < 0.5;
    const word = isReal ? drawFrom("realw", DATA.realWords) : drawFrom("fakew", DATA.fakeWords);
    view.innerHTML = `
      <h2>真假词 · ${i + 1}/10</h2>
      <div class="card">
        <div class="timer go" id="rs-timer" style="font-size:24px">0:05</div>
        <div class="big-word">${esc(word)}</div>
        <p style="text-align:center" class="muted">这是一个真实的英文单词吗？</p>
        <div class="choice-row">
          <button class="primary" id="rs-yes">Yes</button>
          <button class="ghost" id="rs-no">No</button>
        </div>
      </div>`;
    const t = runTimer($("#rs-timer", view), 5);
    const answer = ans => {
      t.cancel();
      const correct = ans === isReal;
      history.push({ word, isReal, ans, correct });
      round(i + 1, score + (correct ? 1 : 0), history);
    };
    t.promise.then(done => { if (done) answer(null); });
    $("#rs-yes", view).onclick = () => answer(true);
    $("#rs-no", view).onclick = () => answer(false);
  }
  function result(score, history) {
    logPractice("rs", `${score}/10`, score >= 6);
    history.filter(h => !h.correct).forEach(h =>
      addWrong("rs", h.word, h.ans === null ? "超时未答" : (h.ans ? "判为真词" : "判为假词"), h.isReal ? "真词" : "假词"));
    const missedReal = history.filter(h => h.isReal && !h.correct).map(h => h.word);
    const nAdded = addVocab(missedReal, "真假词");
    view.innerHTML = `
      <h2>真假词 · 结果：<span class="${score >= 8 ? "result-good" : "result-bad"}">${score}/10</span></h2>
      <div class="card">
        ${history.map(h => `<div class="log-entry">${h.correct ? "✅" : "❌"} <b>${esc(h.word)}</b> — ${h.isReal ? "真词" : "假词"}${h.ans === null ? "（超时）" : ""}</div>`).join("")}
        ${vocabNote(nAdded)}
        <div id="rs-extra"></div>
        <button class="primary" id="rs-again" style="margin-top:12px">再来一轮 ▶</button>
        <button class="ghost" id="rs-back">返回</button>
      </div>`;
    if (missedReal.length) aiFeedbackButton($("#rs-extra", view), "AI 讲解我不认识的真词", () => ({
      system: VOCAB_COACH,
      user: `单词：${missedReal.join(", ")}`,
    }));
    $("#rs-again", view).onclick = () => round(0, 0, []);
    $("#rs-back", view).onclick = idle;
  }
  idle();
  return idle;
}

// ───────────────────── Fill in the Blanks ─────────────────────
function setupFB() {
  const view = $("#view-fb");
  function idle() {
    view.innerHTML = `
      <h2>补全单词 Fill in the Blanks</h2>
      <p class="subtitle">考试 6–9 题，每题 <b>20 秒</b>：句子里有个词只给前半部分，补全剩下的字母。计入 Reading。</p>
      <div class="card"><button class="primary" id="fb-start">开始 ▶</button></div>`;
    $("#fb-start", view).onclick = run;
    attachGenUI(view, "fb", DATA.fillBlanks);
  }
  function run() {
    const item = drawFrom("fb", DATA.fillBlanks);
    const shown = item.w.slice(0, Math.ceil(item.w.length / 2));
    const missing = item.w.slice(shown.length);
    view.innerHTML = `
      <h2>补全单词</h2>
      <div class="card">
        <div class="timer go" id="fb-timer" style="font-size:28px">0:20</div>
        <div class="prompt-box">${esc(item.s)}
          <b>${esc(shown)}</b><input type="text" class="ctest-input" id="fb-input" size="${Math.max(missing.length, 2)}" maxlength="${missing.length + 3}" autocomplete="off">.
        </div>
        <button class="primary" id="fb-submit">提交</button>
        <button class="ghost" id="fb-back">返回</button>
      </div>`;
    const t = runTimer($("#fb-timer", view), 20);
    const grade = () => {
      t.cancel();
      const got = $("#fb-input", view).value.trim().toLowerCase();
      const ok = got === missing;
      logPractice("fb", ok ? "✓" : "✗", ok);
      const nAdded = ok ? 0 : addVocab([item.w], "补全单词", item.s + " ___");
      if (!ok) addWrong("fb", item.s + " ___", shown + (got || "(空)"), item.w);
      view.innerHTML = `
        <h2>补全单词 · ${ok ? '<span class="result-good">正确 ✅</span>' : '<span class="result-bad">错误 ❌</span>'}</h2>
        <div class="card">
          <div class="prompt-box">${esc(item.s)} <b class="${ok ? "result-good" : "result-bad"}">${esc(item.w)}</b>.</div>
          ${ok ? "" : `<p class="muted">你写的是：${esc(shown)}<b>${esc(got) || "（空）"}</b></p>`}
          ${vocabNote(nAdded)}
          <button class="primary" id="fb-again">下一题 ▶</button>
          <button class="ghost" id="fb-back2">返回</button>
        </div>`;
      $("#fb-again", view).onclick = run;
      $("#fb-back2", view).onclick = idle;
    };
    t.promise.then(done => { if (done) grade(); });
    $("#fb-submit", view).onclick = grade;
    $("#fb-back", view).onclick = () => { t.cancel(); idle(); };
    $("#fb-input", view).focus();
  }
  idle();
  return idle;
}

// ───────────────────── Read and Complete (C-test) ─────────────────────
function setupCT() {
  const view = $("#view-ct");
  function idle() {
    view.innerHTML = `
      <h2>补全段落 Read and Complete</h2>
      <p class="subtitle">考试 3–6 段，每段 <b>3 分钟</b>：从第二句开始隔词挖掉后半字母，靠语感补全。计入 Reading。难词权重更高。</p>
      <div class="card"><button class="primary" id="ct-start">开始一段 ▶</button></div>`;
    $("#ct-start", view).onclick = run;
    attachGenUI(view, "ct", DATA.cTest);
  }
  function damage(passage) {
    // keep first sentence intact; in the rest, hide the second half of every other word (length>=3)
    const sentences = passage.match(/[^.!?]+[.!?]/g) || [passage];
    const first = sentences[0];
    let toggle = false;
    const rest = sentences.slice(1).join(" ").split(/\s+/).map(tok => {
      const m = tok.match(/^([A-Za-z]+)([^A-Za-z]*)$/);
      if (!m || m[1].length < 3) return { text: tok };
      toggle = !toggle;
      if (!toggle) return { text: tok };
      const w = m[1], shown = w.slice(0, Math.ceil(w.length / 2));
      return { shown, missing: w.slice(shown.length).toLowerCase(), punct: m[2] };
    });
    return { first, rest };
  }
  function run() {
    const passage = drawFrom("ct", DATA.cTest);
    const { first, rest } = damage(passage);
    let html = `<span>${esc(first)}</span> `;
    let idx = 0;
    for (const tok of rest) {
      if (tok.missing !== undefined) {
        html += `<span class="ctest-word">${esc(tok.shown)}<input class="ctest-input" data-i="${idx}" data-ans="${esc(tok.missing)}" data-full="${esc(tok.shown + tok.missing)}" size="${Math.max(tok.missing.length, 1)}" autocomplete="off">${esc(tok.punct)}</span> `;
        idx++;
      } else html += `${esc(tok.text)} `;
    }
    view.innerHTML = `
      <h2>补全段落</h2>
      <div class="card">
        <div class="timer go" id="ct-timer" style="font-size:28px">3:00</div>
        <div class="prompt-box ctest-passage">${html}</div>
        <button class="primary" id="ct-submit">提交</button>
        <button class="ghost" id="ct-back">返回</button>
      </div>`;
    const t = runTimer($("#ct-timer", view), 180);
    const grade = () => {
      t.cancel();
      const inputs = [...view.querySelectorAll(".ctest-input")];
      let ok = 0;
      inputs.forEach(inp => {
        const correct = inp.value.trim().toLowerCase() === inp.dataset.ans;
        inp.classList.add(correct ? "ok" : "bad");
        if (!correct) {
          addWrong("ct", `…${inp.dataset.full}…（${passage.slice(0, 70)}…）`, inp.previousSibling ? inp.parentNode.textContent.split(" ")[0] + (inp.value.trim() || "(空)") : (inp.value.trim() || "(空)"), inp.dataset.full);
          inp.value = inp.dataset.ans;
        }
        inp.disabled = true;
        if (correct) ok++;
      });
      const pct = Math.round((ok / inputs.length) * 100);
      logPractice("ct", `${ok}/${inputs.length}`, pct >= 60);
      const wrongWords = inputs.filter(i => i.classList.contains("bad")).map(i => i.dataset.full);
      const nAdded = addVocab(wrongWords, "补全段落");
      $("#ct-submit", view).outerHTML = `<p style="margin-top:10px">得分：<span class="${pct >= 80 ? "result-good" : "result-bad"}">${ok}/${inputs.length}（${pct}%）</span>（红色框中已填入正确答案）</p>
        ${vocabNote(nAdded)}<div id="ct-extra"></div>
        <button class="primary" id="ct-again">再来一段 ▶</button><button class="ghost" id="ct-back2">返回</button>`;
      if (wrongWords.length) aiFeedbackButton($("#ct-extra", view), "AI 讲解本段（线索 + 词义）", () => ({
        system: READ_COACH,
        user: `段落：\n${passage}\n\n考生填错的词：${wrongWords.join(", ")}`,
      }));
      $("#ct-again", view).onclick = run;
      $("#ct-back2", view).onclick = idle;
    };
    t.promise.then(done => { if (done) grade(); });
    $("#ct-submit", view).onclick = grade;
    $("#ct-back", view).onclick = () => { t.cancel(); idle(); };
    const firstInput = view.querySelector(".ctest-input");
    if (firstInput) firstInput.focus();
  }
  idle();
  return idle;
}

// ───────────────────── Writing tasks ─────────────────────
function writingTask({ view: vid, title, sub, seconds, getPrompt, renderPrompt, promptText, minWords, logName, twoPart, genKey, baseArr, structureChallenge }) {
  const view = $(`#view-${vid}`);
  function idle() {
    view.innerHTML = `
      <h2>${title}</h2>
      <p class="subtitle">${sub}</p>
      <div class="card"><button class="primary" id="w-start">开始 ▶</button></div>`;
    $("#w-start", view).onclick = () => run();
    if (genKey) attachGenUI(view, genKey, baseArr);
  }
  let challenge = null;
  function run() {
    const item = getPrompt();
    challenge = structureChallenge ? pickChallenge() : null;
    part(item, 1, "");
  }
  async function part(item, partNo, firstText) {
    const isFollow = partNo === 2;
    const secs = isFollow ? 180 : seconds;
    view.innerHTML = `
      <h2>${title}${twoPart ? ` · 第 ${partNo}/2 段` : ""}</h2>
      <div class="card">
        <div id="w-prompt"></div>
        <div class="timer-label">写作时间</div>
        <div class="timer go" id="w-timer">--:--</div>
        <textarea id="w-text" placeholder="开始写——内容量优先，写满时间。"></textarea>
        <div class="wordcount" id="w-wc">0 词</div>
        <button class="primary" id="w-done">${twoPart && !isFollow ? "提交第一段 ▶" : "提交"}</button>
      </div>`;
    renderPrompt($("#w-prompt", view), item, partNo);
    if (challenge) $("#w-prompt", view).insertAdjacentHTML("beforeend", challengeHTML(challenge));
    await waitImgs($("#w-prompt", view));
    const ta = $("#w-text", view);
    ta.oninput = () => {
      const n = ta.value.trim().split(/\s+/).filter(Boolean).length;
      $("#w-wc", view).textContent = `${n} 词${minWords ? `（建议 ≥ ${minWords}）` : ""}`;
    };
    const t = runTimer($("#w-timer", view), secs);
    const finish = () => {
      t.cancel();
      const words = ta.value.trim().split(/\s+/).filter(Boolean).length;
      if (twoPart && !isFollow) { part(item, 2, ta.value); return; }
      logPractice(logName, `${words}w`);
      view.innerHTML = `
        <h2>${title} · 完成</h2>
        <div class="card">
          <p>${twoPart ? "第二段" : "本题"}写了 <b>${words}</b> 词。${minWords && words < minWords ? `<span class="result-bad">少于建议的 ${minWords} 词，内容量是第一权重！</span>` : '<span class="result-good">不错，保持内容量。</span>'}</p>
          ${firstText ? `<p class="muted">第一段：</p><div class="prompt-box" style="font-size:15px">${esc(firstText)}</div>` : ""}
          <p class="muted">${twoPart ? "第二段" : "你的回答"}：</p>
          <div class="prompt-box" style="font-size:15px">${esc(ta.value) || "（空）"}</div>
          <div id="w-extra"></div>
          <p class="muted">自查 4 项：content（切题+内容量）/ coherence（衔接词）/ grammar / lexis（换词，别重复）。</p>
          <button class="primary" id="w-again">再来一题 ▶</button>
          <button class="ghost" id="w-back">返回</button>
        </div>`;
      aiFeedbackButton($("#w-extra", view), "AI 点评（DeepSeek）", () => ({
        system: WRITE_RATER,
        user: `题型：${title}（限时 ${Math.round(seconds / 60)} 分钟${twoPart ? "，两段式" : ""}）\n题目：${promptText ? promptText(item) : "(看图写作，图片内容你看不到，只评语言质量)"}\n${firstText ? `第一段回答：\n${firstText}\n追问的第二段回答：\n` : "考生回答：\n"}${ta.value.trim() || "(空)"}${challenge ? challengeClause(challenge) : ""}`,
      }));
      $("#w-again", view).onclick = run;
      $("#w-back", view).onclick = idle;
    };
    t.promise.then(done => { if (done) finish(); });
    $("#w-done", view).onclick = finish;
    ta.focus();
  }
  idle();
  return idle;
}

// ───────────────────── photos ─────────────────────
const photoURL = seed => `https://picsum.photos/seed/${seed}/900/600`;

// ───────────────────── dashboard ─────────────────────
// ───────────────────── daily quests + gamification ─────────────────────
function calcStreak(days, today) {
  let streak = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    const k = d.toLocaleDateString("sv");
    if (days.has(k)) streak++;
    else if (k === today) continue; // today not practiced yet doesn't break streak
    else break;
  }
  return streak;
}

// answer accuracy today = crit chance in battle (practice well → hit hard)
function todayAccuracy() {
  const t = getLog().filter(e => dayKey(e.t) === dayKey(Date.now()));
  if (!t.length) return 0.5;
  return t.filter(e => !e.h).length / t.length;
}

const LEVELS = [
  { xp: 0, name: "鸟蛋", icon: "🥚" },
  { xp: 150, name: "破壳雏鸟", icon: "🐣" },
  { xp: 400, name: "学舌小鸮", icon: "🐥" },
  { xp: 800, name: "夜读之鸮", icon: "🦉" },
  { xp: 1400, name: "流利之翼", icon: "🪽" },
  { xp: 2200, name: "考场猎手", icon: "🦅" },
  { xp: 3200, name: "Speaking 130 预定", icon: "🏆" },
  { xp: 4500, name: "鸮中之神", icon: "👑" },
];
const getPerfect = () => JSON.parse(localStorage.getItem("det_perfect") || "[]");
const xpTotal = () => getLog().reduce((s, e) => s + (e.h ? 5 : 10), 0) + getPerfect().length * 100;
function levelInfo(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1];
  return { ...cur, lv: i + 1, next, pct: next ? Math.round(((xp - cur.xp) / (next.xp - cur.xp)) * 100) : 100 };
}

// one small, rotating quest list per day — covers all skills over the week,
// and the load creeps up with the prep-plan week number
function questsForToday() {
  const now = new Date();
  const dow = now.getDay();
  const start = new Date(DATA.planStart + "T00:00:00");
  const dayN = Math.max(0, Math.floor((now - start) / 86400000));
  const lvl = Math.min(Math.floor(dayN / 7), 4); // intensity 0..4, +1 step per week
  const todayLog = getLog().filter(e => dayKey(e.t) === dayKey(Date.now()));
  const cnt = keys => todayLog.filter(e => keys.includes(e.task)).length;
  const Q = [];
  // speaking core (every day, type rotates by weekday)
  if ([1, 3, 5].includes(dow)) {
    Q.push({ icon: "🎤", label: "即兴问答（AI 追问）", view: "is", keys: ["is"], n: 4 + lvl, time: 5 + lvl });
  } else if ([2, 4].includes(dow)) {
    Q.push({ icon: "🎤", label: "读题演讲（带句式挑战）", view: "rts", keys: ["rts"], n: 1 + Math.ceil(lvl / 2), time: 4 * (1 + Math.ceil(lvl / 2)) });
    Q.push({ icon: "🎬", label: "压轴长答 3 分钟", view: "ss", keys: ["ss"], n: 1, time: 5 });
  } else {
    Q.push({ icon: "📷", label: "看图说话", view: "sap", keys: ["sap"], n: 1 + Math.ceil(lvl / 2), time: 3 * (1 + Math.ceil(lvl / 2)) });
    Q.push({ icon: "🎬", label: "压轴长答（录完回看视频感）", view: "ss", keys: ["ss"], n: 1, time: 5 });
  }
  // daily guided speaking-coach session (targets the real weakness: real-time organization)
  Q.push({ icon: "🎓", label: "口语教练特训", view: "coach", keys: ["coach"], n: 1, time: 12 });
  // listening / reading slot (rotates daily)
  const rot = dayN % 4;
  if (rot === 0) Q.push({ icon: "🎧", label: "听写句子", view: "lt", keys: ["lt"], n: 3 + lvl, time: 4 + lvl });
  if (rot === 1) Q.push({ icon: "📖", label: "补全段落", view: "ct", keys: ["ct"], n: 1 + Math.ceil(lvl / 2), time: 4 + 2 * Math.ceil(lvl / 2) });
  if (rot === 2) Q.push({ icon: "📝", label: "对话摘要（听力+写作双算）", view: "sum", keys: ["sum"], n: 1 + Math.floor(lvl / 2), time: 4 });
  if (rot === 3) {
    Q.push({ icon: "⚡", label: "真假词（一轮 10 题）", view: "rs", keys: ["rs"], n: 1, time: 2 });
    Q.push({ icon: "🔤", label: "补全单词", view: "fb", keys: ["fb"], n: 2 + lvl, time: 2 });
  }
  // writing slot (every other day, type rotates)
  if (dayN % 2 === 0) {
    const wrot = ["wap", "ws", "iw"][Math.floor(dayN / 2) % 3];
    const wmeta = { wap: ["✍️", "看图写作", 2], ws: ["✍️", "写作样本", 6], iw: ["✍️", "互动写作（两段）", 9] }[wrot];
    Q.push({ icon: wmeta[0], label: wmeta[1], view: wrot, keys: [wrot], n: 1, time: wmeta[2] });
  }
  // vocab review (only when the notebook has material)
  if (getVocab().filter(x => !x.known).length >= 3) {
    Q.push({ icon: "📒", label: "生词本复习（朗读或标记掌握）", view: "vocab", keys: ["vocabreview"], n: 5, time: 3 });
  }
  return Q.map(q => ({ ...q, done: Math.min(cnt(q.keys), q.n) }));
}

// settle base-clear + tower rewards; safe to call from anywhere, any number of times
function settleTower() {
  const today = dayKey(Date.now());
  const Q = questsForToday();
  const B = Q.reduce((s, q) => s + q.n, 0);
  const totalToday = getLog().filter(e => dayKey(e.t) === today).length;
  const allDone = Q.length > 0 && Q.every(q => q.done >= q.n);
  const g = getGame();
  const perfect = getPerfect();
  if (allDone && !perfect.includes(today)) {
    perfect.push(today);
    localStorage.setItem("det_perfect", JSON.stringify(perfect));
    g.coins += BASE_CLEAR_REWARD;
    blogPush(g, `✅ 基础打卡完成 +${BASE_CLEAR_REWARD} 🪶`);
    confetti();
    toast(`🎉 今日全勤 +100 XP · +${BASE_CLEAR_REWARD} 🪶`);
  }
  const extra = Math.max(0, totalToday - B);
  if (allDone && B > 0) {
    const earnedTiers = Math.floor(extra / B);
    let delay = 900;
    while (g.towerClaimed < earnedTiers) {
      g.towerClaimed++;
      const f = towerReward(g.towerClaimed);
      g.coins += f;
      blogPush(g, `🗼 进阶 Tier ${g.towerClaimed} 达成，+${f} 🪶`);
      const tier = g.towerClaimed;
      setTimeout(() => { toast(`🗼 进阶 Tier ${tier} 达成 +${f} 🪶`); confetti(".stage"); }, delay);
      delay += 900;
    }
  }
  saveGame(g);
  return { Q, B, totalToday, allDone, extra, g };
}

// circular progress ring with content in the center
function ringHTML(pct, inner, { size = 92, stroke = 7, color = "var(--accent2)" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<div class="ring-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--panel3)" stroke-width="${stroke}" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"
        transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dashoffset .5s ease"/>
    </svg>
    <div class="ring-center">${inner}</div>
  </div>`;
}

function confetti(scopeSel) { // 不带参数=全屏庆祝；带选择器=只在该容器内下彩纸（战斗庆祝禁止越出战场矩形）
  const host = scopeSel ? document.querySelector(scopeSel) : document.body;
  if (!host) return;
  const emo = ["🎉", "✨", "🦉", "⭐", "💚", "🎊"];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement("span");
    s.className = "confetti" + (scopeSel ? " confetti-local" : "");
    s.textContent = pick(emo);
    s.style.left = Math.random() * 100 + (scopeSel ? "%" : "vw");
    s.style.animationDelay = (Math.random() * 0.8) + "s";
    s.style.fontSize = (16 + Math.random() * 22) + "px";
    host.appendChild(s);
    setTimeout(() => s.remove(), 3600);
  }
}

// ── 目标设定：分数 + 考试日期由用户自己定（det_goal，跨设备同步）──
function getGoal() { return J(localStorage.getItem("det_goal")); }
function openGoalSetup() {
  document.getElementById("goal-modal")?.remove();
  const g = getGoal() || {};
  const wrap = document.createElement("div");
  wrap.id = "goal-modal";
  wrap.innerHTML = `<div class="goal-card card">
    <h3>🎯 设定你的目标</h3>
    <p class="muted">写下目标分数和考试日期，首页会为你倒计时。之后点侧栏顶部的目标行随时可改。</p>
    <label class="goal-row">目标 Speaking 分数 <input type="number" id="goal-score" min="10" max="160" step="5" value="${g.score || 120}"></label>
    <label class="goal-row">考试日期 <input type="date" id="goal-date" value="${g.date || ""}"></label>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="primary" id="goal-save">保存</button>
      <button class="ghost" id="goal-skip">先逛逛</button>
    </div></div>`;
  document.body.appendChild(wrap);
  $("#goal-save", wrap).onclick = () => {
    const score = Math.max(10, Math.min(160, +$("#goal-score", wrap).value || 120));
    const date = $("#goal-date", wrap).value;
    localStorage.setItem("det_goal", JSON.stringify({ score, date }));
    wrap.remove();
    renderGoalLine(); renderDashboard();
    toast("🎯 目标已设定，冲！");
  };
  $("#goal-skip", wrap).onclick = () => { sessionStorage.setItem("goalskip", "1"); wrap.remove(); };
}
function renderGoalLine() {
  const el = document.getElementById("goal-line");
  if (!el) return;
  const demo = location.search.includes("demo"); // 演示/截图模式：不暴露个人目标日期
  const g = getGoal();
  el.textContent = demo
    ? "目标 Speaking ≥ 130"
    : g && g.date
    ? `目标 Speaking ≥ ${g.score} · ${g.date.slice(5).replace("-", "/")} 前`
    : g ? `目标 Speaking ≥ ${g.score}` : "🎯 点击设定目标";
  el.style.cursor = "pointer";
  el.title = "点击修改目标";
  el.onclick = openGoalSetup;
}

// ═══════════ ⏰ 冲刺计划（Planning）：倒计时 + 压力仪表盘 + 每日打卡 ═══════════
const getPlan = () => J(localStorage.getItem("det_plan")) || { exam1: "2026-06-15", exam2: "2026-08-04", deadline: "2026-08-07" };
const savePlan = p => localStorage.setItem("det_plan", JSON.stringify(p));

function cdParts(dateStr, endOfDay) {
  const target = new Date(dateStr + (endOfDay ? "T23:59:59" : "T09:00:00"));
  const ms = target - Date.now();
  const days = Math.floor(ms / 86400000);
  const h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
  return { ms, days, txt: ms <= 0 ? "已到" : days >= 3 ? `${days} 天` : `${days}天 ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` };
}
function tickPlan() {
  document.querySelectorAll("[data-cd]").forEach(el => {
    const { txt } = cdParts(el.dataset.cd, el.dataset.eod === "1");
    const n = el.querySelector(".cd-num");
    if (n && n.textContent !== txt) n.textContent = txt;
  });
}
setInterval(tickPlan, 1000);

// ── DET Speaking ≥130 前置条件（逐条锚定官方 130-150 段描述，可勾选，det_prereq 同步）──
const PREREQS = [
  { id: "fill", cat: "内容", txt: "任何题型都能把时间说满：35s 不冷场，90s/3min 结构完整收尾", how: "即兴问答 + 压轴长答，每天各来一轮" },
  { id: "detail", cat: "内容", txt: "每个观点必配一个具体例子或细节（官方：fully support the main ideas）", how: "口语教练的范文结构照着练" },
  { id: "connect", cat: "组织", txt: "连接手段 ≥4 类自然使用（however / for example / which means / on top of that / if…then）", how: "AI 点评盯 coherence 星级" },
  { id: "tpl", cat: "组织", txt: "结构模板内化：观点→理由1+例→理由2+例→收尾，不用想就出口", how: "口语教练关键词复述环节" },
  { id: "wpm", cat: "流利", txt: "语速稳定 ≥110-120 wpm，不再 somewhat slow", how: "微练口语的语速读数" },
  { id: "pause", cat: "流利", txt: "停顿只落在意群边界；无 >2 秒空白；每 30 秒重启 ≤1 次", how: "听自己录音回放数一遍" },
  { id: "variety", cat: "语法", txt: "每答自然带出 ≥3 种结构：条件句 / 定语从句 / 被动 / 情态 / 让步", how: "句式挑战 + AI 点评 grammar 行" },
  { id: "err", cat: "语法", txt: "个人高频错清零：三单 have→has、过去时 prepare→prepared；小错 ≤1 个/分钟", how: "荧光笔标注就是你的错误清单" },
  { id: "chunk", cat: "词汇", txt: "活用口语搭配 ≥300 条，告别 very + 泛词（官方：collocations + idiomatic）", how: "口语好词自动进生词本，每天复习" },
  { id: "para", cat: "词汇", txt: "同话题关键词会即时同义替换，不重复用词", how: "AI 点评 lexis 行给替换建议" },
  { id: "stress", cat: "发音", txt: "词重音不出致命错，句子有重音节奏", how: "每天 5 分钟跟读任意英文播客" },
  { id: "score", cat: "终检", txt: "AI 终判连续一周稳定 ≥130（微练 + 大题双线）", how: "作战室今日口语均分连看 7 天" },
];
const getPrereq = () => J(localStorage.getItem("det_prereq")) || {};
function renderPrereqCard() {
  const pq = getPrereq();
  const done = PREREQS.filter(p => pq[p.id]).length;
  return `
  <div class="card prereq-card">
    <h3>🎯 Speaking 130 前置条件 <span class="muted" style="font-size:13px">${done}/${PREREQS.length} 达成 · 全绿再上考场</span></h3>
    <div class="progress-bar" style="height:10px;margin:10px 0"><div style="width:${Math.round(done / PREREQS.length * 100)}%;background:linear-gradient(90deg,var(--accent2),var(--accent))"></div></div>
    ${PREREQS.map(p => `
      <label class="pq-row ${pq[p.id] ? "pq-done" : ""}">
        <input type="checkbox" data-pq="${p.id}" ${pq[p.id] ? "checked" : ""}>
        <span class="pq-cat">${p.cat}</span>
        <span class="pq-txt">${p.txt}<span class="pq-how muted">怎么练：${p.how}</span></span>
      </label>`).join("")}
    <p class="muted" style="font-size:12px;margin-top:8px">逐条锚定官方评分指南 130-150 段描述。自己达标了才勾——这是给考场的承诺，不是给我看的。</p>
  </div>`;
}

function renderPlan() {
  const view = $("#view-plan");
  if (!view) return;
  const p = getPlan();
  const { Q, B, allDone, extra, g } = settleTower();
  const doneCnt = Q.filter(q => q.done >= q.n).length;
  const totalMin = Q.reduce((s, q) => s + q.time, 0);
  const log = getLog();
  const today = dayKey(Date.now());
  const todayItems = log.filter(e => dayKey(e.t) === today).length;
  const days = new Set(log.map(e => dayKey(e.t)));
  const streak = calcStreak(days, today);
  const xp = xpTotal(), lv = levelInfo(xp);
  const sph = (J(localStorage.getItem("det_sphist")) || []).filter(e => e.t && dayKey(e.t) === today);
  const spAvg = sph.length ? Math.round(sph.reduce((a, e) => a + (e.score || 0), 0) / sph.length) : null;
  const spBest = sph.length ? Math.max(...sph.map(e => e.score || 0)) : null;

  // 时间压力：今天已流逝 vs 打卡完成度
  const dayFrac = (Date.now() - new Date(today + "T07:00:00")) / (16 * 3600000); // 7:00-23:00 算作战窗口
  const df = Math.max(0, Math.min(1, dayFrac));
  const qf = Q.length ? doneCnt / Q.length : 1;
  const hourNow = new Date().getHours();
  let status, statusCls;
  if (allDone) { status = "✅ 今日任务已清零——去边打边刷或休息"; statusCls = "ok"; }
  else if (hourNow >= 21) { status = "🚨 今晚必须清零！还剩 " + (Q.length - doneCnt) + " 项"; statusCls = "danger"; }
  else if (qf >= df - 0.08) { status = "⏱ 进度跟得上，别松"; statusCls = "warn"; }
  else { status = "⚠️ 你落后于今天的时间了——现在开始"; statusCls = "danger"; }

  const cds = [
    { label: "距首考", date: p.exam1, eod: 0 },
    { label: "距二考", date: p.exam2, eod: 0 },
    { label: "距提交死线", date: p.deadline, eod: 1 },
  ].map(c => {
    const { ms, days: d, txt } = cdParts(c.date, !!c.eod);
    const urg = ms <= 0 ? "past" : d < 3 ? "danger" : d < 10 ? "warn" : "calm";
    return { ...c, txt, urg, d };
  });

  const nextQ = Q.find(q => q.done < q.n);
  const phases = [
    { icon: "🔥", name: "冲刺首考", until: p.exam1, focus: "口语教练每天必做 · 至少 1 套限时模拟 · 睡前生词本过一遍" },
    { icon: "🛠", name: "复盘补弱", until: p.exam2, focus: "首考出分后主攻最弱两项 · 错题本清零 · 口语微练保持手感" },
    { icon: "📮", name: "提交冲线", until: p.deadline, focus: "二考出分立即送分 · 备齐并提交全部材料 · 不留到最后一天" },
  ];
  const nowMs = Date.now();
  let cur = phases.findIndex(ph => nowMs <= new Date(ph.until + "T23:59:59"));
  if (cur < 0) cur = phases.length - 1;

  view.innerHTML = `
  <h2>⏰ 冲刺作战室</h2>
  <div class="cd-row">
    ${cds.map(c => `
      <div class="cd-card cd-${c.urg}" data-cd="${c.date}" data-eod="${c.eod}">
        <div class="cd-title">${c.label} <span class="muted">${c.date.slice(5).replace("-", "/")}</span></div>
        <div class="cd-num">${c.txt}</div>
      </div>`).join("")}
  </div>

  <div class="pressure card ${statusCls}">
    <div class="pressure-status">${status}</div>
    <div class="pressure-bars">
      <div class="pb-line"><span>今天时间</span><div class="progress-bar"><div style="width:${Math.round(df * 100)}%;background:linear-gradient(90deg,#ff9c2b,#ff5a5a)"></div></div><b>${Math.round(df * 100)}%</b></div>
      <div class="pb-line"><span>打卡完成</span><div class="progress-bar"><div style="width:${Math.round(qf * 100)}%;background:linear-gradient(90deg,var(--accent2),var(--accent))"></div></div><b>${doneCnt}/${Q.length}</b></div>
    </div>
    ${nextQ ? `<button class="primary next-action" data-view="${nextQ.view}">🎯 现在就做：${nextQ.label.split("（")[0]}（还差 ${nextQ.n - nextQ.done} 题）▶</button>`
            : `<button class="primary next-action" data-view="battle">⚡ 全部清零！去边打边刷攒能量 ▶</button>`}
  </div>

  <div class="card">
    <h3>📋 今日打卡 <span class="muted" style="font-size:13px">${doneCnt}/${Q.length} 项 · 约 ${totalMin} 分钟</span></h3>
    <div class="quest-grid" style="margin-top:12px">
      ${Q.map(q => {
        const done = q.done >= q.n;
        const short = q.label.split("（")[0];
        return `
        <div class="qtile ${done ? "qtile-done" : ""}" data-view="${q.view}" role="button">
          ${ringHTML(q.done / q.n, done ? "✅" : q.icon, { size: 66, stroke: 6, color: done ? "var(--accent)" : "var(--accent2)" })}
          <b>${short}</b>
          <span class="muted">${q.done}/${q.n} · ${q.time} 分钟</span>
        </div>`;
      }).join("")}
    </div>
    ${allDone ? `<p class="muted" style="margin-top:10px">🗼 进阶塔已解锁：多刷 ${B - (allDone && B > 0 ? Math.min(extra - g.towerClaimed * B, B) : 0)} 题再爬一层。</p>` : ""}
    ${[0, 6].includes(new Date().getDay()) ? `<p class="muted" style="margin-top:8px">🧪 周末加餐：<a href="https://englishtest.duolingo.com/practice" target="_blank" style="color:var(--accent2)">官方免费模拟</a>一次，记下估分。</p>` : ""}
  </div>

  <div class="plan-stats card">
    <h3>📊 我的进展</h3>
    <div class="ps-grid">
      <div class="ps-cell"><b>${streak}</b><span>连击天数</span></div>
      <div class="ps-cell"><b>${todayItems}</b><span>今日题数</span></div>
      <div class="ps-cell"><b>${spAvg != null ? spAvg : "—"}</b><span>今日口语均分</span></div>
      <div class="ps-cell"><b>${spBest != null ? spBest : "—"}</b><span>今日口语最佳</span></div>
      <div class="ps-cell"><b>${days.size}</b><span>累计天数</span></div>
      <div class="ps-cell"><b>${log.length}</b><span>累计题数</span></div>
      <div class="ps-cell"><b>Lv.${lv.lv}</b><span>${lv.name}</span></div>
      <div class="ps-cell"><b>${getWrong().length}</b><span>错题待复盘</span></div>
    </div>
  </div>

  ${renderPrereqCard()}

  <div class="card">
    <h3>🗺 作战阶段</h3>
    <div class="phase-row">
      ${phases.map((ph, i) => `
        <div class="phase ${i === cur ? "phase-cur" : i < cur ? "phase-done" : ""}">
          <div class="ph-head">${ph.icon} ${ph.name} <span class="muted">→ ${ph.until.slice(5).replace("-", "/")}</span>${i === cur ? ' <span class="ph-now">进行中</span>' : ""}</div>
          <div class="ph-focus muted">${ph.focus}</div>
        </div>`).join("")}
    </div>
    <details class="plan-dates">
      <summary>📅 修改考试 / 截止日期（自动保存）</summary>
      <label>首考 <input type="date" id="pd-exam1" value="${p.exam1}"></label>
      <label>二考 <input type="date" id="pd-exam2" value="${p.exam2}"></label>
      <label>提交死线 <input type="date" id="pd-deadline" value="${p.deadline}"></label>
    </details>
  </div>`;

  view.querySelectorAll("[data-view]").forEach(el => {
    el.onclick = () => document.querySelector(`.nav-item[data-view="${el.dataset.view}"]`).click();
  });
  view.querySelectorAll("[data-pq]").forEach(cb => cb.onchange = () => {
    const pq = getPrereq(); pq[cb.dataset.pq] = cb.checked;
    localStorage.setItem("det_prereq", JSON.stringify(pq));
    renderPlan();
    if (cb.checked) toast("🎯 又一条达成！");
  });
  ["exam1", "exam2", "deadline"].forEach(k => {
    const inp = view.querySelector("#pd-" + k);
    if (inp) inp.onchange = () => { const np = getPlan(); np[k] = inp.value; savePlan(np); renderPlan(); toast("📅 日期已更新"); };
  });
}

function renderDashboard() {
  const view = $("#view-dashboard");
  const log = getLog();
  const today = dayKey(Date.now());
  const days = new Set(log.map(e => dayKey(e.t)));
  const streak = calcStreak(days, today);
  const goal = getGoal();
  const daysLeft = goal && goal.date && !location.search.includes("demo") ? Math.ceil((new Date(goal.date + "T00:00:00") - Date.now()) / 86400000) : null;
  const { Q, B, allDone, extra, g } = settleTower();
  const doneCnt = Q.filter(q => q.done >= q.n).length;
  const totalMin = Q.reduce((s, q) => s + q.time, 0);
  const xp = xpTotal();
  const lv = levelInfo(xp);
  const nextTier = g.towerClaimed + 1;
  const tierProgress = allDone && B > 0 ? Math.min(extra - g.towerClaimed * B, B) : 0;

  const totalItems = log.length;
  const speakCnt = log.filter(e => ["is", "sap", "rts", "ss"].includes(e.task)).length;
  const badges = [
    { icon: "🔥", name: "3 天连击", ok: streak >= 3 },
    { icon: "🚀", name: "7 天连击", ok: streak >= 7 },
    { icon: "🌙", name: "30 天连击", ok: streak >= 30 },
    { icon: "💯", name: "百题斩", ok: totalItems >= 100 },
    { icon: "⚔️", name: "五百题", ok: totalItems >= 500 },
    { icon: "🎤", name: "口语 100 题", ok: speakCnt >= 100 },
    { icon: "📒", name: "词汇猎人 ×30", ok: getVocab().length >= 30 },
    { icon: "⭐", name: "完美打卡 ×7", ok: getPerfect().length >= 7 },
  ];

  const dow = new Date().getDay();
  view.innerHTML = `
  <div class="dash">
    <div class="hero">
      <div class="hero-streak">🔥 ${streak}<div class="lbl">连续天数</div></div>
      <div class="hero-level">
        <div class="lv-name">${lv.icon} <b>Lv.${lv.lv}</b> · ${lv.name}</div>
        <div class="xp-bar"><div style="width:${lv.pct}%"></div></div>
        <div class="lbl">${lv.next ? `还差 ${lv.next.xp - xp} XP 升级` : "满级！"} · 共 ${xp} XP</div>
      </div>
      <div class="hero-coins" id="hero-coins" title="去打怪塔花掉它">🪶 ${fmtNum(g.coins)}<div class="lbl">羽币</div></div>
      <div class="hero-deadline" style="cursor:pointer" data-view="plan" title="查看冲刺计划">${(d => d != null ? `${d}<div class="lbl">天后死线</div>` : `🎯<div class="lbl">设定目标</div>`)(Math.ceil((new Date(getPlan().deadline + "T23:59:59") - Date.now()) / 86400000))}</div>
    </div>

    ${allDone ? `<div class="card dash-banner" style="border-color:var(--accent);background:#16240f;padding:12px 20px"><b>🎉 今日全勤！+100 XP · +${BASE_CLEAR_REWARD} 🪶</b> <span class="muted">进阶塔已解锁——多刷的题都在爬塔。</span></div>` : ""}

    <div class="dash-main">
      <div class="card plan-cta" data-view="plan" role="button">
        <h3>⏰ 冲刺作战室</h3>
        <p class="muted" style="margin:6px 0 10px">今日打卡 <b style="color:var(--accent)">${doneCnt}/${Q.length}</b> · 倒计时、作战阶段、每日任务都在这里</p>
        <button class="primary" style="width:100%;margin:0">进入作战室 ▶</button>
      </div>
    </div>

    <div class="dash-col">
      <div class="card">
        <h3>⚔️ 打怪塔</h3>
        <div class="dash-boss-row">
          ${(a => { if (!a) return bossSVG(g.bossIndex);
            const f = getFx(), sc = (f.scaleB[a.key] || 1), tf = `transform:scale(${f.flipB[a.key] ? -sc : sc}, ${sc});transform-origin:center bottom`;
            return `<img class="boss-img boss-img-dash${a.smooth ? "" : " pixel"}" src="mon/${a.key}_battle_0.png" style="${a.filter ? `filter:${a.filter};` : ""}${tf}">`; })(bossAssetOf(g.bossIndex))}
          <div style="flex:1;min-width:0">
            <b style="font-size:13.5px">${esc(bossOf(g.bossIndex).name)}</b> <span class="muted" style="font-size:11px">Lv.${g.bossIndex}</span>
            <div class="hp-bar"><div class="hp-boss" style="width:${Math.round((g.bossHp / bossMaxHp(g.bossIndex)) * 100)}%"></div></div>
            <span class="muted" style="font-size:11px">❤️ ${g.bossHp} / ${bossMaxHp(g.bossIndex)} · ⚡ ${fmt(Math.ceil(g.energy || 0))}</span>
          </div>
        </div>
        <p class="muted" style="margin:8px 0 4px;font-size:12.5px">🗼 ${allDone ? `Tier ${nextTier}：还差 <b style="color:var(--warn)">${B - tierProgress}</b> 题 → +${towerReward(nextTier)} 🪶` : "完成基础打卡解锁进阶塔"}</p>
        <div class="progress-bar" style="height:8px;margin:0 0 10px"><div style="width:${B ? Math.round((tierProgress / B) * 100) : 0}%;background:linear-gradient(90deg,var(--warn),#ff9c2b)"></div></div>
        <button class="secondary" data-view="battle" style="width:100%;margin:0">进入战场 ▶</button>
      </div>
      <div class="card">
        <h3>📊 累积</h3>
        <div class="dash-stat-row"><span>今天完成</span><b>${log.filter(e => dayKey(e.t) === today).length} 题</b></div>
        <div class="dash-stat-row"><span>累计练习</span><b>${days.size} 天 · ${totalItems} 题</b></div>
        <div class="dash-stat-row" data-view="vocab" role="button" style="cursor:pointer"><span>📒 生词待掌握</span><b>${getVocab().filter(x => !x.known).length}</b></div>
        <div class="dash-stat-row" data-view="wrong" role="button" style="cursor:pointer"><span>📕 错题本</span><b>${getWrong().length}</b></div>
      </div>
      <div class="card">
        <h3>🏅 徽章</h3>
        <div class="badge-mini">
          ${badges.map(b => `<span class="${b.ok ? "on" : ""}" title="${b.name}">${b.icon}</span>`).join("")}
        </div>
      </div>
    </div>


  </div>`;

  view.querySelectorAll("[data-view]").forEach(el => {
    el.onclick = () => document.querySelector(`.nav-item[data-view="${el.dataset.view}"]`).click();
  });
}

// ───────────────────── scores reference ─────────────────────
function renderScores() {
  $("#view-scores").innerHTML = `
    <h2>计分规则（官方 2026 Scoring Guide）</h2>
    <p class="subtitle">DET 是自适应考试：<b>没有"每题固定多少分"</b>——答对越难的题，对分数贡献越大。
    每道题归属一个（或两个）单项；<b>总分 = 四个单项的平均值，向上取整到 5 的倍数</b>。各单项均为 10–160 分。</p>

    <div class="card">
      <h3>🎯 你的 Speaking 单项（目标 ≥130）由这 9–11 道录音题决定</h3>
      <table class="score-table">
        <tr><th>题型</th><th>题数</th><th>时长</th><th>自适应</th><th>占比（按题数）</th></tr>
        <tr><td class="hl">即兴问答 Interactive Speaking</td><td>6–8</td><td>35 秒/题</td><td>✅ 唯一自适应口语题</td><td class="hl">≈ 2/3 的口语题量</td></tr>
        <tr><td>看图说话 Speak About the Photo</td><td>1</td><td>90 秒</td><td>—</td><td rowspan="3">其余 3 题各占一票，<br>但单题时间长、样本足，<br>权重不低</td></tr>
        <tr><td>读题演讲 Read Then Speak</td><td>1</td><td>90 秒</td><td>—</td></tr>
        <tr><td>压轴长答 Speaking Sample</td><td>1</td><td>3 分钟</td><td>—</td></tr>
      </table>
      <p class="muted" style="margin-top:10px">全部按 6 项评分：content（内容量）、coherence（连贯）、fluency（流利）、grammar、lexis（词汇）、pronunciation。
      Speaking Sample <b>计分</b>且视频会发给学校。</p>
    </div>

    <div class="card">
      <h3>其余三个单项的构成</h3>
      <table class="score-table">
        <tr><th>单项</th><th>题型</th><th>题数</th><th>计分方式</th></tr>
        <tr><td rowspan="4"><b>Reading</b></td><td>真假词 Read and Select</td><td>15–18</td><td>对/错</td></tr>
        <tr><td>补全单词 Fill in the Blanks</td><td>6–9</td><td>对/错</td></tr>
        <tr><td>补全段落 Read and Complete</td><td>3–6 段</td><td>逐词对/错，难词权重高</td></tr>
        <tr><td>互动阅读 Interactive Reading（5 小题型）</td><td>2 篇</td><td>对/错（划答案题部分计分）</td></tr>
        <tr><td rowspan="3"><b>Listening</b></td><td>听写句子 Listen and Type</td><td>6–9</td><td>0–1 部分计分</td></tr>
        <tr><td>互动听力：Listen and Complete</td><td>2×(3–4)</td><td>0–1 部分计分</td></tr>
        <tr><td>互动听力：Listen and Respond</td><td>2×(5–6)</td><td>对/错</td></tr>
        <tr><td rowspan="3"><b>Writing</b></td><td>看图写作 Write About the Photo</td><td>3</td><td rowspan="3">写作 4 项标准：content、<br>coherence、grammar、lexis</td></tr>
        <tr><td>互动写作 Interactive Writing</td><td>1×2 段</td></tr>
        <tr><td>写作样本 Writing Sample</td><td>1</td></tr>
        <tr><td><b>Listening + Writing</b></td><td>对话摘要 Summarize the Conversation</td><td>2</td><td>写作 4 项标准（双重计入）</td></tr>
      </table>
    </div>

    <div class="card">
      <h3>组合分数（学校也会看到）</h3>
      <p class="muted">每个组合分数 = 两个单项的平均：Literacy = (R+W)/2 · Conversation = (S+L)/2 · Comprehension = (R+L)/2 · Production = (S+W)/2。
      所以你的 Speaking 同时拉动 Conversation 和 Production。</p>
    </div>

    <div class="card">
      <h3>分数换算</h3>
      <table class="score-table">
        <tr><th>DET</th><th>IELTS</th><th>TOEFL</th><th>CEFR</th></tr>
        <tr><td class="hl">130（你的目标）</td><td>7.0</td><td>98–105</td><td>B2+/C1</td></tr>
        <tr><td>120</td><td>6.5</td><td>87–92</td><td>B2</td></tr>
        <tr><td>130</td><td>7</td><td>98–103</td><td>C1</td></tr>
      </table>
    </div>`;
}

// ───────────────────── speaking coach (daily guided session) ─────────────────────
const COACH_GEN = `你是 DET 口语教练。考生：非母语，目标 Speaking 单项 ≥130（官方 130-150 段）。核心弱点是实时组织：想法太多、句子越说越长、语法随之不稳。
训练理念（必须遵守）：
1) 不训练议论文腔；2) 不堆砌不自然的"高级语法"（如过度正式的定语从句）；3) 只要自然口语、清晰结构、准确语法、稳定的句子控制；4) 提供可复用的口语句型；5) 目标是听起来清晰、有条理、成熟，而不是背诵感或机器人腔。
生成一节今日特训。只输出一个合法 JSON 对象（双引号，无 markdown 围栏，无解释）：
{"question":"一道 DET 风格口语题（观点/个人经历/偏好/对比解释/未来计划 中随机一类）",
"sample":"100-140 词的高质量范文：自然口语、清晰结构、含少量自然的复杂句但不像作文，避免夸张空洞或背诵感的表达",
"structure":["用约 5 条拆解范文结构，每条格式：标签——对应的范文句子片段，标签如 直接观点/理由1/例子/对比或条件/结论"],
"patterns":["从范文提取 5-8 个可复用句型（英文，可在括号内加一句中文说明）"],
"keywords":["5-8 个关键词或短语，供考生脱稿复述用"]}`;

const COACH_EVAL = `你是 DET 口语教练（考生目标 Speaking 单项 ≥130，官方 130-150 段，非母语）。输入是考生回答的语音转写，可能含转写错误——明显的转写错误不要纠结。
${DET_RUBRIC}
只关注考生真实的口语问题：组织条理、句子边界（是否越说越长收不住）、语法稳定性、用词、清晰度、自然度。不要逐个挑小错。
输出格式（中文讲解，英文例句保留英文，直接务实、不奉承）：
**原文标注**：完整还原考生整段转写原文（不许改写、缩短或省略），把每一处真实语言错误用 [[错误原文=>正确表达]] 标记包裹；疑似转写错误不要标，除标记外不加任何点评文字
**最重要的 3 个问题**：每个问题引用考生原话片段 + 为什么是问题 + 怎么改
**分数区间**：严格按上面的官方分数段锚点定段（给出区间 + 定段证据），并注明"非官方 DET 分数，仅供参考"
**版本 A · 最小修正**：保留考生原意和说话风格，只修主要的语法/用词/结构硬伤
**版本 B · 130 目标版**：按官方 130-150 段的下沿写——发展充分、结构多样但依然口语化自然（不是作文腔），现实可模仿
**版本 C · 应急短版**：只有 5-6 句，结构强、低风险、好记，压力下可直接套用
**明日练习**：3 句值得反复朗读的句子 + 3 个该记住的句型 + 1 个明天要避免的错误
不要轻易建议"用更高级的词汇"，除非真的必要。稳定、干净、有条理的输出 > 花哨表达。`;

const getCoach = () => JSON.parse(localStorage.getItem("det_coach") || "null");
const saveCoach = c => localStorage.setItem("det_coach", JSON.stringify(c));

async function coachNewLesson() {
  const raw = await aiChat(COACH_GEN, "生成今日特训。今天的日期种子：" + dayKey(Date.now()) + "。题目类型和话题要随种子变化，不要总出同类题。", 7000);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 没有返回 JSON");
  const lesson = JSON.parse(m[0]);
  if (!lesson.question || !lesson.sample || !Array.isArray(lesson.patterns)) throw new Error("生成结果不完整");
  return lesson;
}

function renderCoach() {
  const view = $("#view-coach");
  let c = getCoach();
  if (c && c.date !== dayKey(Date.now())) c = null; // a new day = a new lesson

  if (!c) {
    view.innerHTML = `
      <h2>🎓 口语教练</h2>
      <p class="subtitle">针对你的核心弱点——<b>实时组织</b>（想法太多、句子收不住、语法跟着不稳）。
      每天一题：看范文学结构 → 记关键词脱稿复述 → 正式作答 45-60 秒 → AI 抓 3 个最重要的问题 + 三版改写。
      目标不是像母语者，是<b>清晰、可控、高分</b>。</p>
      <div class="card">
        <button class="primary" id="co-start">开始今日特训 ▶</button>
        <span class="muted" id="co-status"></span>
      </div>`;
    $("#co-start", view).onclick = async () => {
      const btn = $("#co-start", view);
      btn.disabled = true; btn.textContent = "🤖 教练出题中…（约 1 分钟）";
      try {
        const lesson = await coachNewLesson();
        saveCoach({ date: dayKey(Date.now()), lesson, transcript: "", feedback: "" });
        renderCoach();
      } catch (e) {
        btn.disabled = false; btn.textContent = "开始今日特训 ▶";
        $("#co-status", view).textContent = "出题失败：" + String(e.message || e);
      }
    };
    return;
  }

  const L = c.lesson;
  view.innerHTML = `
    <h2>🎓 口语教练 <span class="muted" style="font-size:13px">${c.date}</span></h2>
    <div class="card">
      <h3>① 今日题目</h3>
      <div class="prompt-box">${esc(L.question)}</div>
    </div>
    <details class="card" ${c.transcript ? "" : "open"}>
      <summary style="cursor:pointer"><b>② 范文 + 结构 + 可复用句型</b>（先学后练，答题前收起来）</summary>
      <div class="prompt-box" style="font-size:15.5px;margin-top:10px">${esc(L.sample)}</div>
      <p class="muted" style="margin:8px 0 4px"><b>结构拆解：</b></p>
      ${(L.structure || []).map(s => `<div class="log-entry">${esc(s)}</div>`).join("")}
      <p class="muted" style="margin:10px 0 4px"><b>可复用句型（背这些）：</b></p>
      ${(L.patterns || []).map(p => `<div class="log-entry">🧩 ${esc(p)}</div>`).join("")}
    </details>
    <div class="card">
      <h3>③ 关键词脱稿复述（热身）</h3>
      <p>${(L.keywords || []).map(k => `<span class="pill" style="font-size:13.5px">${esc(k)}</span>`).join("")}</p>
      <p class="muted">只看关键词，把范文的意思自己说一遍（出声即可，不用录音）。卡住了再回去看一眼范文。</p>
    </div>
    <div class="card">
      <h3>④ 正式作答 <span class="muted" style="font-size:12px">45-60 秒，像考试一样</span></h3>
      <button class="primary" id="co-rec">🎙 开始录音（最长 60 秒，再点结束）</button>
      <p class="muted" style="margin-top:8px">转写结果（可手动修正后再点评）：</p>
      <textarea id="co-text" class="transcript" style="min-height:110px">${esc(c.transcript || "")}</textarea>
    </div>
    <div class="card">
      <h3>⑤ 教练点评</h3>
      ${c.feedback
        ? `<div class="ai-box">${mdLite(c.feedback)}</div>
           <button class="ghost" id="co-reeval" style="margin-top:10px">修正转写后重新点评</button>`
        : `<button class="secondary" id="co-eval">🤖 提交点评（3 个最重要的问题 + 三版改写 + 明日练习）</button>
           <span class="muted" id="co-eval-status"></span>`}
    </div>
    <p class="muted" style="text-align:right"><a href="#" id="co-redo" style="color:var(--muted)">换一题重来</a></p>`;

  // recording: click to start, click again (or 60s timeout) to stop
  const recBtn = $("#co-rec", view);
  let recorder = null, stream = null, timer = null, secs = 0;
  recBtn.onclick = async () => {
    if (recorder) {
      clearInterval(timer);
      recBtn.disabled = true; recBtn.textContent = "🤖 转写中…";
      recorder.stop();
      const blob = await recorder.done;
      stopStream(stream);
      recorder = null;
      try {
        const text = await serverTranscribe(blob);
        const cc = getCoach();
        cc.transcript = text;
        saveCoach(cc);
        logPractice("coach", `${text.split(/\s+/).filter(Boolean).length}w`);
        renderCoach();
      } catch (e) {
        recBtn.disabled = false; recBtn.textContent = `转写失败（${String(e.message || e).slice(0, 30)}），点击重录`;
      }
      return;
    }
    try { stream = await getMic(); }
    catch { recBtn.textContent = "无法访问麦克风——请用 HTTPS 地址并授权"; return; }
    recorder = startRecording(stream);
    secs = 60;
    recBtn.textContent = `🔴 录音中 ${secs}s — 说够 45 秒再点结束`;
    timer = setInterval(() => {
      secs--;
      recBtn.textContent = `🔴 录音中 ${secs}s — ${secs > 15 ? "继续说" : "可以收尾了"} — 再点结束`;
      if (secs <= 0) recBtn.onclick();
    }, 1000);
  };

  const evalBtn = $("#co-eval", view);
  if (evalBtn) evalBtn.onclick = async () => {
    const transcript = $("#co-text", view).value.trim();
    if (!transcript) { $("#co-eval-status", view).textContent = "先录音或手动输入回答"; return; }
    evalBtn.disabled = true; evalBtn.textContent = "🤖 教练分析中…（约 1 分钟）";
    try {
      const fb = await aiChat(COACH_EVAL, `题目：${L.question}\n\n考生回答（语音转写，约 ${transcript.split(/\s+/).filter(Boolean).length} 词）：\n${transcript}`, 7000);
      const cc = getCoach();
      cc.transcript = transcript; cc.feedback = fb;
      saveCoach(cc);
      renderCoach();
    } catch (e) {
      evalBtn.disabled = false; evalBtn.textContent = "🤖 提交点评";
      $("#co-eval-status", view).textContent = "失败：" + String(e.message || e);
    }
  };
  const reevalBtn = $("#co-reeval", view);
  if (reevalBtn) reevalBtn.onclick = () => { const cc = getCoach(); cc.feedback = ""; saveCoach(cc); renderCoach(); };
  $("#co-redo", view).onclick = e => {
    e.preventDefault();
    if (confirm("放弃今天这题，重新生成一题？")) { localStorage.removeItem("det_coach"); renderCoach(); }
  };
}

// ───────────────────── vocab notebook view ─────────────────────
function renderVocab() {
  const view = $("#view-vocab");
  const v = getVocab();
  const unknown = v.filter(x => !x.known);
  const list = v.slice().reverse();
  view.innerHTML = `
    <h2>📒 生词本</h2>
    <p class="subtitle">做题时自动收集：真假词答错的真词、补全段落/单词写错的词、听写漏掉的词、AI 点评推荐的表达。
    共 <b>${v.length}</b> 条，未掌握 <b>${unknown.length}</b> 条。背熟一个就点 ✓。</p>
    <div class="card">
      <div id="vb-extra"></div>
      ${unknown.length ? "" : '<p class="muted">生词本是空的（或都掌握了）——去做题，错的词会自动出现在这里。</p>'}
    </div>
    <div class="card" id="vb-list">
      ${list.map(x => `
        <div class="log-entry" data-w="${esc(x.w)}">
          <button class="ghost vb-say" style="padding:2px 10px" title="朗读">🔊</button>
          <b style="${x.known ? "text-decoration:line-through;opacity:.5" : ""}">${esc(x.w)}</b>
          <span class="pill">${esc(x.src)}</span>
          ${x.ctx ? `<span class="muted" style="font-size:12px">${esc(x.ctx)}</span>` : ""}
          <span style="float:right">
            <button class="ghost vb-known" style="padding:2px 10px" title="标记掌握">${x.known ? "↩︎" : "✓"}</button>
            <button class="ghost vb-del" style="padding:2px 10px" title="删除">🗑</button>
          </span>
        </div>`).join("") || '<p class="muted">暂无记录。</p>'}
    </div>`;
  if (unknown.length) aiFeedbackButton($("#vb-extra", view), `AI 讲解未掌握的 ${Math.min(unknown.length, 10)} 个词`, () => ({
    system: VOCAB_COACH,
    user: `单词：${unknown.slice(-10).map(x => x.w).join(", ")}`,
    maxTokens: 3500, // 10 个词的讲解 + 推理模型的思考开销
  }));
  $("#vb-list", view).onclick = e => {
    const entry = e.target.closest(".log-entry");
    if (!entry) return;
    const w = entry.dataset.w;
    if (e.target.classList.contains("vb-say")) { speak(w, { rate: 0.85 }); logPractice("vocabreview", w); }
    if (e.target.classList.contains("vb-known")) {
      const all = getVocab();
      const it = all.find(x => x.w === w);
      if (it) { it.known = !it.known; saveVocab(all); if (it.known) logPractice("vocabreview", w + " ✓"); renderVocab(); }
    }
    if (e.target.classList.contains("vb-del")) {
      saveVocab(getVocab().filter(x => x.w !== w));
      renderVocab();
    }
  };
}

// ───────────────────── battle view ─────────────────────
function setFace(sel, face, ms) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.dataset.face = face;
  clearTimeout(el._faceT);
  if (ms) el._faceT = setTimeout(() => { el.dataset.face = "normal"; }, ms);
}

// 受击特效锚点：定位到该立绘「非透明像素质心」(hit:[fx,fy])，特效不再落在容器中心而偏离角色
const spotOf = sel => (sel === "#hero-sprite" ? ".spot-hero" : ".spot-boss");
// 文字锚点：挂在不旋转的 .spot 上、定位到角色脚底（质心x，靠下96%），所以伤害/招式字在脚底且回旋斩不跟转
function footFx(sel) {
  const spot = document.querySelector(spotOf(sel));
  const sprite = document.querySelector(sel);
  if (!spot || !sprite) return null;
  const img = sprite.querySelector("img");
  let a = spot.querySelector(":scope > .fx-foot");
  if (!a) { a = document.createElement("div"); a.className = "fx-foot"; spot.appendChild(a); }
  if (img) {
    const hit = (sel === "#hero-sprite" ? (HERO_CUR && HERO_CUR.hit) : (MON.cfg && MON.cfg.hit)) || [0.5, 0.6];
    a.style.left = (sprite.offsetLeft + img.offsetLeft + hit[0] * img.offsetWidth) + "px";
    a.style.top = (sprite.offsetTop + img.offsetTop + 0.96 * img.offsetHeight) + "px";
  }
  return a;
}
function spriteFxHost(sel) {
  const host = document.querySelector(sel);
  if (!host) return null;
  const img = host.querySelector("img");
  let anchor = host.querySelector(":scope > .fx-anchor");
  if (!anchor) { anchor = document.createElement("div"); anchor.className = "fx-anchor"; host.appendChild(anchor); }
  if (img) {
    const hit = (sel === "#hero-sprite" ? (HERO_CUR && HERO_CUR.hit) : (MON.cfg && MON.cfg.hit)) || [0.5, 0.58];
    anchor.style.left = (img.offsetLeft + hit[0] * img.offsetWidth) + "px";
    anchor.style.top = (img.offsetTop + hit[1] * img.offsetHeight) + "px";
  }
  return anchor;
}
function hitFx(sel, cls) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
function floatDmg(text, crit, sel = "#boss-sprite") {
  const sprite = document.querySelector(sel);
  const host = footFx(sel); // 伤害数字落在脚底，不在头上
  if (!host) return;
  const s = document.createElement("span");
  s.className = "dmg-float" + (crit ? " dmg-crit" : "");
  s.textContent = text;
  host.appendChild(s);
  if (sprite) { sprite.classList.remove("boss-hit"); void sprite.offsetWidth; sprite.classList.add("boss-hit"); }
  setTimeout(() => s.remove(), 700);
}

// quick-drill state survives battle re-renders (attack clicks etc.)
const MINI = { mode: "rs", q: null, last: null };

// anti-grind: 5 consecutive items of one mode → that mode cools down 5 minutes
const MINI_LIMIT = 5, MINI_COOL_MS = 5 * 60 * 1000;
const MINI_MODES = ["rs", "fb", "lt", "ct2", "vb", "sp"];
const getCool = () => J(localStorage.getItem("minicool")) || { last: "", count: 0, until: {} };
const coolLeft = m => Math.max(0, ((getCool().until || {})[m] || 0) - Date.now());
const vbHasWords = () => getVocab().some(x => !x.known && !x.w.includes(" "));
function noteMiniDone(mode) {
  const c = getCool();
  c.count = c.last === mode ? (c.count || 0) + 1 : 1;
  c.last = mode;
  if (c.count >= MINI_LIMIT) {
    c.until = c.until || {};
    c.until[mode] = Date.now() + MINI_COOL_MS;
    c.count = 0;
    toast("⏳ 这个题型冷却 5 分钟——换一种练！");
  }
  _origSet("minicool", JSON.stringify(c)); // device-local
}

// speaking ladder: small → big; 3 wins in a row promotes a level
// ladder controls SIZE only; the task TYPE rotates through all four real
// DET speaking formats in micro form (细碎、潜移默化)
const SPEAK_STAGES = [
  { name: "热身 · 一两句话", time: 12, words: 10 },
  { name: "进阶 · 半分钟", time: 20, words: 18 },
  { name: "完整 · 考试节奏", time: 32, words: 28 },
];
const SP_TYPES = {
  is: "🎤 即兴问答微练（只听一遍）",
  sap: "📷 看图微说",
  rts: "🗣️ 读题微讲",
  ss: "🎬 微观点（压轴题型）",
};
// instant "DET-feel" score (0-132, calibrated so a solid answer ≈ 124):
// computed locally in ms from the transcript — the TikTok loop must not wait for AI
const SP_CONNECTORS = ["because", "so", "but", "although", "though", "however", "for example", "first", "second", "also", "actually", "when", "if", "which", "instead", "that's why", "and then"];
function spScore(text, dur, stageIdx) {
  const stage = SPEAK_STAGES[stageIdx];
  const words = text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
  const n = words.length;
  if (!n) return { score: 0, parts: { 内容量: 0, 流利度: 0, 词汇多样: 0, 结构连接: 0 } };
  const wpm = (n / Math.max(dur, 3)) * 60;
  const volume = Math.min(n / stage.words, 1.3) / 1.3;
  const fluency = Math.min(wpm / 110, 1.1) / 1.1;
  const ttr = new Set(words).size / n;
  const variety = Math.max(0, Math.min((ttr - 0.4) / 0.4, 1));
  const lc = " " + text.toLowerCase() + " ";
  const hits = SP_CONNECTORS.filter(c => lc.includes(" " + c + " ")).length;
  const structure = Math.min(hits / (stageIdx + 1.5), 1);
  const score = Math.min(132, Math.round(48 + 34 * volume + 24 * fluency + 13 * variety + 13 * structure));
  return { score, parts: { 内容量: volume, 流利度: fluency, 词汇多样: variety, 结构连接: structure } };
}
const spPassNeed = stageIdx => 85 + stageIdx * 10;

// the local score is only a 1-second provisional estimate; a DeepSeek judge
// re-scores asynchronously and corrects the card + history when it lands
const SP_AI_RUBRIC = `你是 DET 口语评分官，严格按下面的官方评分体系打分。
${DET_RUBRIC}
本题是微型口语练习（限时仅 12-32 秒）：内容展开空间天然有限，按比例评判——短回答只要切题、结构清楚、语法稳、有具体词汇，照样可以进 115-130 段；不要因为短就压分，也不要因为流利的废话给高分（跑题/空洞按 60-85 段）。
只输出 JSON（无代码块）：{"score":10到145的整数,"why":"一句中文点评，点出定段理由，≤40字"}`;
async function aiSpJudge(question, text, stageIdx) {
  const raw = await aiChat(SP_AI_RUBRIC, `题目：${question}\n限时：${SPEAK_STAGES[stageIdx].time} 秒\n考生转写：${text || "(空)"}`, 1600, 0.15); // 低温打分
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json");
  const j = JSON.parse(m[0]);
  return { score: Math.max(40, Math.min(132, Math.round(+j.score || 0))), why: String(j.why || "").slice(0, 60) };
}
const getSpHist = () => J(localStorage.getItem("det_sphist")) || [];
function pushSpHist(score, ty) {
  const h = getSpHist();
  const t = Date.now();
  h.push({ t, s: score, ty });
  localStorage.setItem("det_sphist", JSON.stringify(h.slice(-200))); // synced
  return t;
}
function spScoreCard(score, parts, passNeed, prevBest, combo, text) {
  const bars = Object.entries(parts).map(([k, v]) => `
    <div class="sp-bar-row"><span>${k}</span><div class="sp-bar"><div style="width:${Math.round(v * 100)}%"></div></div></div>`).join("");
  const headline = score >= 130 ? "🏆 130 水准！" : score >= passNeed ? `离 130 还差 ${130 - score}` : `没过线（本级需 ≥${passNeed}）`;
  const judging = `<div class="muted" id="sp-judging" style="font-size:11.5px;margin-top:4px">🤖 AI 终判中…（速估先看，不挡下一题）</div>`;
  return `<div class="sp-score ${score >= passNeed ? "sp-pass" : "sp-fail"}">
    <div class="sp-num" data-target="${score}">0</div>
    <div class="sp-meta"><span class="muted" style="font-size:11px">⚡速估</span> ${headline} · ${score > prevBest && prevBest > 0 ? "🎉 新纪录！" : prevBest > 0 ? `历史最佳 ${prevBest}` : "首个记录"}${combo >= 2 ? ` · 🔥 连击 x${combo}` : ""}</div>
    <div class="sp-bars">${bars}</div>
    <p class="muted" style="margin-top:6px">你说的：“${esc(text.slice(0, 90))}${text.length > 90 ? "…" : ""}”</p>
    ${judging}
  </div>`;
}
function countUp(el) {
  const target = +el.dataset.target || 0;
  const t0 = performance.now();
  const step = now => {
    const p = Math.min((now - t0) / 650, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const getSpeakLadder = () => Object.assign({ stage: 0, streak: 0 }, JSON.parse(localStorage.getItem("det_speakladder") || "{}"));
const saveSpeakLadder = l => localStorage.setItem("det_speakladder", JSON.stringify(l));

function nextMiniQ() {
  if (MINI.mode === "rs") {
    const isReal = Math.random() < 0.5;
    MINI.q = { isReal, word: isReal ? drawFrom("realw", DATA.realWords) : drawFrom("fakew", DATA.fakeWords) };
  } else if (MINI.mode === "fb") {
    const item = drawFrom("fb", DATA.fillBlanks);
    MINI.q = { item, shown: item.w.slice(0, Math.ceil(item.w.length / 2)) };
  } else if (MINI.mode === "sp") {
    const stage = getSpeakLadder().stage;
    const type = pick(Object.keys(SP_TYPES));
    const q = { stage, type };
    if (type === "is") q.text = drawFrom("isq", DATA.interactiveSpeaking.flatMap(t => t.questions));
    if (type === "sap") q.seed = Math.random().toString(36).slice(2, 9);
    if (type === "rts") { const it = drawFrom("rts", DATA.readThenSpeak); q.text = it.prompt; q.bullet = it.bullets[0]; }
    if (type === "ss") q.text = drawFrom("ss", DATA.speakingSample);
    MINI.q = q;
  } else if (MINI.mode === "ct2") {
    const sentence = drawFrom("ct2", DATA.listenAndType);
    const toks = sentence.split(" ");
    const cand = toks.map((w, i) => ({ clean: w.replace(/[^A-Za-z]/g, ""), i })).filter(x => x.clean.length >= 4);
    const at = [Math.floor(cand.length / 3), Math.floor((cand.length * 2) / 3)];
    const seenIdx = new Set();
    const parts = at.map(a => cand[a]).filter(p => p && !seenIdx.has(p.i) && seenIdx.add(p.i))
      .map(p => ({ i: p.i, full: p.clean, shown: p.clean.slice(0, Math.ceil(p.clean.length / 2)) }));
    MINI.q = { sentence, toks, parts };
  } else if (MINI.mode === "vb") {
    const unk = getVocab().filter(x => !x.known && !x.w.includes(" "));
    if (!unk.length) { MINI.mode = "rs"; return nextMiniQ(); }
    const it = unk[Math.floor(Math.random() * unk.length)];
    MINI.q = { word: it.w, ctx: (it.ctx || "").replace(new RegExp(it.w.replace(/[.*+?^${}()|[\]\\]/g, ""), "ig"), "_____"), src: it.src };
  } else {
    MINI.q = { sentence: drawFrom("lt", DATA.listenAndType), plays: 0 };
  }
}

const BATTLE = { timer: null };
function stopAutoBattle() {
  setTimeout(() => heroAnim("idle"), 0);
  BATTLE.running = false;
  stopBgm();
  const stg = document.querySelector(".stage");
  if (stg) stg.classList.remove("scrolling");
  clearInterval(BATTLE.biomeT);
  const b = document.querySelector("#bt-auto");
  if (b) b.textContent = "▶ 开始自动战斗";
}
function startAutoBattle(view) {
  if (BATTLE.running) return;
  BATTLE.running = true;
  BATTLE.koPause = false; // never start wedged
  startBgm();
  const stg = document.querySelector(".stage");
  if (stg) { stg.style.setProperty("--tileW", stg.clientHeight + "px"); stg.classList.add("scrolling"); }
  clearInterval(BATTLE.biomeT);
  BATTLE.biomeT = setInterval(advanceBiome, 22000);
  heroAnim("run"); // march!
  combatLoop(view);
  const b = $("#bt-auto", view);
  if (b) b.textContent = "⏸ 暂停自动战斗";
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── synthesized SFX (Web Audio, no assets) ──
const SFX = { on: localStorage.getItem("sfxoff") !== "1", ctx: null };

// retro chiptune battle BGM (Juhani Junkala, CC0), seamless loop
const BGM = { on: localStorage.getItem("bgmoff") !== "1", el: null };
const BGM_TRACKS = ["bgm_battle.wav", "bgm_battle2.wav", "bgm_battle3.wav",
  "bgm_battle4.wav", "bgm_battle5.wav", "bgm_battle6.wav", "bgm_battle7.wav"]; // 击杀渐变轮播
const BGM_VOL = 0.22;
let _bgmIdx = (Math.random() * BGM_TRACKS.length) | 0;
function bgmPlayTrack(f, fadeIn) {
  const c = actx();
  loadBuf(f).then(buf => {
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = c.createGain();
    g.gain.value = fadeIn ? 0.0001 : BGM_VOL;
    src.connect(g); g.connect(c.destination); src.start();
    if (fadeIn) g.gain.linearRampToValueAtTime(BGM_VOL, c.currentTime + 1.8);
    if (AC.bgmSrc) { // crossfade the old track out
      const os = AC.bgmSrc, og = AC.bgmGain;
      og.gain.linearRampToValueAtTime(0.0001, c.currentTime + (fadeIn ? 1.8 : 0.15));
      setTimeout(() => { try { os.stop(); } catch {} }, fadeIn ? 1950 : 200);
    }
    AC.bgmSrc = src; AC.bgmGain = g;
  }).catch(() => {});
}
function startBgm() {
  if (!BGM.on) return;
  if (AC.bgmSrc) { actx(); return; }
  bgmPlayTrack(BGM_TRACKS[_bgmIdx], false);
}
function nextBgm() { // 击杀奖励之耳朵篇：渐变切到下一首
  _bgmIdx = (_bgmIdx + 1) % BGM_TRACKS.length;
  if (!BGM.on || !AC.bgmSrc) return;
  bgmPlayTrack(BGM_TRACKS[_bgmIdx], true);
}
function stopBgm() {
  if (AC.bgmSrc) { try { AC.bgmSrc.stop(); } catch {} AC.bgmSrc = null; AC.bgmGain = null; }
}

// asset-based SFX (Kenney CC0 packs, converted to WAV for Safari) with
// per-type variation pools; the synth below stays as a fallback
const SFX_FILES = {
  whoosh: ["swing1.wav", "swing2.wav", "swing3.wav"],          // real sword swooshes (OGA RPG pack, CC0)
  hit: ["knifeSlice.wav", "knifeSlice2.wav", "impactPunch_heavy_001.wav"], // blade cuts + meaty thud
  crit: ["chop.wav"],                                           // heavy chop + punch layered below
  clang: ["impactMetal_heavy_000.wav", "impactMetal_heavy_002.wav", "metal-ringing.wav"], // SHIELD BLOCK ONLY
  hurt: ["hurt_grunt1.wav", "hurt_grunt2.wav", "hurt_grunt3.wav"], // 男性受击痛哼（替掉原 impactSoft 水滴声）
  cast: ["cast_magic.wav"], castfire: ["cast_fire.wav"],
  kill: ["coin1.wav", "coin3.wav"],
  potion: ["bottle.wav", "bubble2.wav"],
  unsheathe: ["unsheathe1.wav", "unsheathe2.wav"],
};
// monster voices, picked per boss shape
const GROWLS = {
  slime: ["gr_slime1.wav", "gr_slime3.wav", "gr_slime5.wav", "gr_slime7.wav", "gr_slime9.wav"],
  ghost: ["gr_shade1.wav", "gr_shade4.wav", "gr_shade7.wav", "gr_shade10.wav", "gr_shade13.wav"],
  troll: ["gr_ogre1.wav", "gr_ogre2.wav", "gr_ogre3.wav", "gr_ogre4.wav", "gr_ogre5.wav"],
  bat: ["gr_mnstr1.wav", "gr_mnstr4.wav", "gr_mnstr7.wav"],
  kraken: ["gr_mnstr10.wav", "gr_mnstr13.wav", "gr_mnstr4.wav"],
  dragon: ["gr_giant1.wav", "gr_giant2.wav", "gr_giant3.wav"],
  shadow: ["gr_shade4.wav", "gr_shade10.wav", "gr_shade13.wav"],
  owlking: ["gr_giant2.wav", "gr_giant3.wav", "gr_ogre2.wav"],
  kaiju: ["gr_giant1.wav", "gr_ogre2.wav", "gr_giant3.wav"],
  serpent: ["gr_mnstr7.wav", "gr_mnstr10.wav", "gr_mnstr1.wav"],
  golem: ["gr_ogre2.wav", "gr_shade4.wav", "gr_giant1.wav"],
};
function bossShapeOf(n) {
  const a = bossAssetOf(n);
  if (a) return a.growl;
  const named = ["slime", "ghost", "troll", "bat", "kraken", "dragon", "shadow", "owlking",
    "kaiju", "dragon", "serpent", "golem", "dragon", "kaiju", "kaiju", "kraken"];
  return n < named.length ? named[n] : ["troll", "kaiju", "kraken", "dragon", "serpent", "golem", "slime", "ghost"][n % 8];
}
function playGrowl(n) {
  if (!SFX.on) return;
  const pool = GROWLS[bossShapeOf(n)] || GROWLS.troll;
  playFile(pool[(Math.random() * pool.length) | 0], 0.4);
}
// —— ALL audio goes through WebAudio: HTMLAudio registers with macOS Now Playing
// (MediaRemote), which crashes Chrome on macOS 27 beta; AudioContext does not ——
const AC = { ctx: null, buf: {}, bgmSrc: null, bgmGain: null };
function actx() {
  if (!AC.ctx) AC.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.ctx.state === "suspended") AC.ctx.resume();
  return AC.ctx;
}
function loadBuf(f) {
  if (!AC.buf[f]) AC.buf[f] = fetch("sfx/" + f).then(r => r.arrayBuffer()).then(ab => actx().decodeAudioData(ab));
  return AC.buf[f];
}
function playFile(f, vol) {
  try {
    const c = actx();
    loadBuf(f).then(buf => {
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = vol == null ? 0.5 : vol;
      src.connect(g); g.connect(c.destination);
      src.start();
    }).catch(() => {});
  } catch {}
}
const SFX_VOL = { whoosh: 0.4, hit: 0.5, crit: 0.6, clang: 0.5, hurt: 0.45, kill: 0.55, potion: 0.45, unsheathe: 0.45 };
const _sfxCache = {};
function playSfx(type) {
  if (!SFX.on) return;
  const files = SFX_FILES[type];
  if (files) {
    playFile(files[(Math.random() * files.length) | 0], SFX_VOL[type] || 0.5);
    if (type === "crit") playFile("impactPunch_heavy_004.wav", 0.45); // meaty layered slam (metal belongs to blocks only)
    if (type === "kill") playSfxSynth("kill");               // victory arpeggio over the coin
    return;
  }
  playSfxSynth(type);
}
function playSfxSynth(type) {
  if (!SFX.on) return;
  try {
    if (!SFX.ctx) SFX.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const c = SFX.ctx;
    if (c.state === "suspended") c.resume();
    const note = (wave, f0, f1, dur, vol, at) => {
      const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + (at || 0);
      o.type = wave; o.connect(g); g.connect(c.destination);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    };
    if (type === "whoosh") note("sawtooth", 150, 520, 0.14, 0.045);
    if (type === "hit") note("square", 210, 55, 0.1, 0.085);
    if (type === "crit") { note("square", 420, 70, 0.16, 0.11); note("sawtooth", 800, 120, 0.12, 0.05, 0.02); }
    if (type === "clang") { note("triangle", 920, 340, 0.16, 0.09); note("triangle", 1380, 600, 0.1, 0.045, 0.01); }
    if (type === "hurt") note("sine", 140, 50, 0.16, 0.1);
    if (type === "kill") { note("square", 392, 392, 0.09, 0.07); note("square", 523, 523, 0.09, 0.07, 0.09); note("square", 784, 784, 0.16, 0.08, 0.18); }
  } catch {}
}

// ── procedural VFX helpers ──
function spawnCallout(sel, text, cls) {
  const host = footFx(sel); // 招式名落在脚底；挂在 .spot 上，回旋斩旋转时文字不跟着转
  if (!host) return;
  const d = document.createElement("div");
  d.className = "callout " + (cls || "");
  d.textContent = text;
  host.appendChild(d);
  setTimeout(() => d.remove(), 750);
}
function spawnDust(sel) {
  const host = document.querySelector(sel);
  if (!host) return;
  for (let i = 0; i < 4; i++) {
    const d = document.createElement("div");
    d.className = "dust";
    d.style.left = (32 + Math.random() * 32) + "%";
    d.style.setProperty("--dx", (Math.random() * 40 - 20) + "px");
    d.innerHTML = `<img src="fx/${Math.random() < 0.5 ? "smoke_03.png" : "smoke_05.png"}" alt="">`;
    host.appendChild(d);
    setTimeout(() => d.remove(), 520);
  }
}
function spawnGhosts(spotSel, spriteSel) {
  const spot = document.querySelector(spotSel), spr = document.querySelector(spriteSel);
  if (!spot || !spr) return;
  for (let i = 0; i < 2; i++) {
    setTimeout(() => {
      const g = document.createElement("div");
      g.className = "ghost-img";
      g.innerHTML = spr.innerHTML;
      spot.appendChild(g);
      setTimeout(() => g.remove(), 360);
    }, i * 90);
  }
}
function spawnSparks(sel, color, n) {
  const host = spriteFxHost(sel);
  if (!host) return;
  for (let i = 0; i < (n || 7); i++) {
    const s = document.createElement("div");
    s.className = "spark";
    s.style.background = color;
    const a = Math.random() * Math.PI * 2;
    s.style.setProperty("--sx", Math.cos(a) * (26 + Math.random() * 26) + "px");
    s.style.setProperty("--sy", Math.sin(a) * (20 + Math.random() * 22) + "px");
    s.style.setProperty("--rot", (Math.random() * 80 - 40) + "deg");
    host.appendChild(s);
    setTimeout(() => s.remove(), 380);
  }
}
function spawnShockwave(sel) {
  const host = spriteFxHost(sel);
  if (!host) return;
  const d = document.createElement("div");
  d.className = "shockwave";
  host.appendChild(d);
  setTimeout(() => d.remove(), 420);
}

// ── boss intent telegraph + status chips ──
// —— 战斗微调（手动翻转/位置/间距，存档记住，跨设备同步）——
let FX_FINE = false; // 步长精/粗
const getFx = () => { const d = J(localStorage.getItem("det_combatfx")) || {}; return { flipH: d.flipH || {}, flipB: d.flipB || {}, scaleH: d.scaleH || {}, scaleB: d.scaleB || {}, hx: d.hx || 0, hy: d.hy || 0, bx: d.bx || 0, by: d.by || 0 }; };
const saveFx = f => localStorage.setItem("det_combatfx", JSON.stringify(f));
function applyCombatFx() {
  const f = getFx(), g = getGame();
  const hk = (HERO_CUR && HERO_CUR.key) || "hero";
  const ba = bossAssetOf(g.bossIndex), bk = ba && ba.key;
  const hImg = document.getElementById("hero-img"), bImg = document.getElementById("boss-img");
  const tf = (flip, sc) => `scale(${flip ? -sc : sc}, ${sc})`; // 翻转 + 缩放合一，origin 在脚底(CSS)
  if (hImg) hImg.style.transform = tf(f.flipH[hk], f.scaleH[hk] || 1);
  if (bImg) bImg.style.transform = tf(bk && f.flipB[bk], (bk && f.scaleB[bk]) || 1);
  const hs = document.querySelector(".spot-hero"), bs = document.querySelector(".spot-boss");
  if (hs) { hs.style.marginLeft = (f.hx || 0) + "px"; hs.style.marginBottom = (f.hy || 0) + "px"; } // 站位框 bottom 锚定→用 margin-bottom 上下移
  if (bs) { bs.style.marginRight = (f.bx || 0) + "px"; bs.style.marginBottom = (f.by || 0) + "px"; }
}
function bindCombatFx(view) {
  view.querySelectorAll("[data-fx]").forEach(btn => btn.onclick = () => {
    const f = getFx(), g = getGame();
    const hk = (HERO_CUR && HERO_CUR.key) || "hero";
    const ba = bossAssetOf(g.bossIndex), bk = ba && ba.key, a = btn.dataset.fx;
    const S = FX_FINE ? 4 : 12, SC = FX_FINE ? 0.05 : 0.12;
    if (a === "step") { FX_FINE = !FX_FINE; btn.textContent = "步长:" + (FX_FINE ? "精" : "粗"); return; }
    if (a === "fliphero") f.flipH[hk] = !f.flipH[hk];
    else if (a === "flipboss") { if (bk) f.flipB[bk] = !f.flipB[bk]; }
    else if (a === "h-left") f.hx -= S; else if (a === "h-right") f.hx += S;
    else if (a === "h-up") f.hy += S; else if (a === "h-down") f.hy -= S;
    else if (a === "h-big") f.scaleH[hk] = Math.min(2.6, (f.scaleH[hk] || 1) + SC);
    else if (a === "h-small") f.scaleH[hk] = Math.max(0.4, (f.scaleH[hk] || 1) - SC);
    else if (a === "b-left") f.bx += S; else if (a === "b-right") f.bx -= S;
    else if (a === "b-up") f.by += S; else if (a === "b-down") f.by -= S;
    else if (a === "b-big") { if (bk) f.scaleB[bk] = Math.min(2.6, (f.scaleB[bk] || 1) + SC); }
    else if (a === "b-small") { if (bk) f.scaleB[bk] = Math.max(0.4, (f.scaleB[bk] || 1) - SC); }
    else if (a === "closer") { f.hx += S; f.bx += S; }
    else if (a === "farther") { f.hx -= S; f.bx -= S; }
    else if (a === "reset") { f.flipH = {}; f.flipB = {}; f.scaleH = {}; f.scaleB = {}; f.hx = f.hy = f.bx = f.by = 0; }
    saveFx(f); applyCombatFx();
  });
}
function showIntent(move, s) {
  const el = document.querySelector("#boss-intent");
  if (!el) return;
  const est = Math.round(bossAtk(s.bossIndex) * move.hits.reduce((a, h) => a + h.mult, 0));
  const nm = (MON.cfg && MON.cfg.skill) || move.name; // 显示怪物真实技能名
  el.innerHTML = `⚠ ${nm} <b>~${fmtNum(est)}</b>`;
  el.classList.remove("hidden");
  // 下回合意图预告放到怪物脚底（不在头上）
  const sprite = document.querySelector("#boss-sprite"), img = sprite && sprite.querySelector("img");
  if (img && img.offsetWidth) {
    const hit = (MON.cfg && MON.cfg.hit) || [0.5, 0.55];
    el.style.left = (sprite.offsetLeft + img.offsetLeft + hit[0] * img.offsetWidth) + "px";
    el.style.top = (sprite.offsetTop + img.offsetTop + img.offsetHeight + 4) + "px";
    el.style.bottom = "auto";
  }
}
function hideIntent() {
  const el = document.querySelector("#boss-intent");
  if (el) el.classList.add("hidden");
}
// statuses are {s: stacks (cap 5), t: rounds left}; refreshed to 5 rounds on every proc
function addStatus(which, label) {
  const cur = BATTLE[which] && BATTLE[which].t > 0 ? BATTLE[which] : { s: 0, t: 0 };
  cur.s = Math.min(5, cur.s + 1);
  cur.t = 5;
  BATTLE[which] = cur;
  renderStatuses();
}
function tickStatuses() {
  ["heroBuff", "bossVuln"].forEach(k => {
    const st = BATTLE[k];
    if (st && st.t > 0 && --st.t <= 0) BATTLE[k] = 0;
  });
  renderStatuses();
}
const stStacks = which => (BATTLE[which] && BATTLE[which].t > 0 ? BATTLE[which].s : 0);
function renderStatuses() {
  const h = document.querySelector("#st-hero"), b = document.querySelector("#st-boss");
  if (h) h.innerHTML = stStacks("heroBuff") ? `<span class="st-chip st-buff">🔥斗志+${15 * BATTLE.heroBuff.s}% · ${BATTLE.heroBuff.t}回合</span>` : "";
  if (b) b.innerHTML = stStacks("bossVuln") ? `<span class="st-chip st-vuln">💔破绽+${25 * BATTLE.bossVuln.s}% · ${BATTLE.bossVuln.t}回合</span>` : "";
}

// ── designed move sets: hand-tuned timing, trail and impact per move ──
const HERO_MOVES = [
  { id: "heng", anim: "atk1", name: "横劈", dur: 950, hits: [{ at: 470, mult: 1.0, trail: "hslash" }] },
  { id: "shu", anim: "atk2", name: "竖劈", dur: 980, hits: [{ at: 500, mult: 1.0, trail: "vslash" }] },
  { id: "xie", anim: "atk3", name: "交叉斩", dur: 1080, hits: [{ at: 430, mult: 0.52, trail: "diag1" }, { at: 640, mult: 0.52, trail: "diag2" }] },
  { id: "ci", anim: "atk1", name: "突刺", dur: 860, hits: [{ at: 420, mult: 1.0, trail: "thrust" }] },
  { id: "lian", anim: "atk3", name: "连斩", dur: 1180, hits: [{ at: 380, mult: 0.26, trail: "mini1" }, { at: 520, mult: 0.26, trail: "mini2" }, { at: 660, mult: 0.26, trail: "mini1" }, { at: 800, mult: 0.26, trail: "mini2" }] },
  { id: "hui", anim: "atk2", name: "回旋斩", dur: 1020, hits: [{ at: 560, mult: 1.08, trail: "circle" }] },
];
const BOSS_MOVES = [
  { id: "zhuang", name: "撞击", dur: 820, hits: [{ at: 430, mult: 1.0, trail: "slam" }] },
  { id: "zhua", name: "爪击", dur: 900, hits: [{ at: 430, mult: 0.55, trail: "claw" }, { at: 620, mult: 0.5, trail: "claw" }] },
];

// sword-light trails: Kenney CC0 slash textures, mask-tinted to the blade color
const TRAIL_TEX = {
  hslash: { tex: "slash_01.png", rot: 0, sx: 1.3, sy: 1.05 },
  vslash: { tex: "slash_02.png", rot: 90, sx: 1.25, sy: 1.0 },
  diag1: { tex: "slash_03.png", rot: 38, sx: 1.25, sy: 1.0 },
  diag2: { tex: "slash_03.png", rot: -38, sx: -1.25, sy: 1.0 },
  thrust: { tex: "trace_01.png", rot: 90, sx: 1.7, sy: 0.5 },
  mini1: { tex: "slash_04.png", rot: 26, sx: 0.85, sy: 0.85 },
  mini2: { tex: "slash_04.png", rot: -26, sx: -0.85, sy: 0.85 },
  circle: { tex: "twirl_01.png", rot: 0, sx: 1.45, sy: 1.45 },
  claw: { tex: "scratch_01.png", rot: 8, sx: 1.3, sy: 1.3 },
  slam: { tex: "muzzle_04.png", rot: 0, sx: 1.5, sy: 1.5 },
};
function spawnProjectile(fromSel, toSel, type) {
  return new Promise(resolve => {
    const stage = document.querySelector(".stage");
    const fImg = document.querySelector(fromSel + " img"), tImg = document.querySelector(toSel + " img");
    if (!stage || !fImg || !tImg || !fImg.offsetWidth) { setTimeout(resolve, 220); return; }
    const sr = stage.getBoundingClientRect(), fr = fImg.getBoundingClientRect(), tr = tImg.getBoundingClientRect();
    const fHit = (MON.cfg && MON.cfg.hit) || [0.5, 0.55], tHit = (HERO_CUR && HERO_CUR.hit) || [0.5, 0.6];
    const x0 = fr.left + fHit[0] * fr.width - sr.left, y0 = fr.top + fHit[1] * fr.height - sr.top;
    const x1 = tr.left + tHit[0] * tr.width - sr.left, y1 = tr.top + tHit[1] * tr.height - sr.top;
    const colors = { fire: "#ff7b2b", shadow: "#b15ff0", arcane: "#7ff7ff", beam: "#ff4d4d", arrow: "#dfeaff" };
    const p = document.createElement("div");
    p.className = "projectile proj-" + type;
    p.style.setProperty("--pc", colors[type] || "#fff");
    p.style.left = x0 + "px"; p.style.top = y0 + "px";
    if (type === "arrow") p.style.transform = `rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)`;
    stage.appendChild(p);
    const dur = 360;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      p.style.transition = `left ${dur}ms linear, top ${dur}ms linear`;
      p.style.left = x1 + "px"; p.style.top = y1 + "px";
    }));
    setTimeout(() => { p.remove(); resolve(); }, dur + 20);
  });
}
function spawnTrail(sel, type, color) {
  const host = spriteFxHost(sel);
  const cfg = TRAIL_TEX[type];
  if (!host || !cfg) return;
  const d = document.createElement("div");
  d.className = "fx-tex";
  d.style.setProperty("--rot", cfg.rot + "deg");
  d.style.setProperty("--fsx", cfg.sx);
  d.style.setProperty("--fsy", cfg.sy);
  d.style.setProperty("--glow", color);
  d.innerHTML = `<img src="fx/${cfg.tex}" alt="">`;
  host.appendChild(d);
  setTimeout(() => d.remove(), 330);
}

function spawnShield(sel, side, holdMs) {
  const host = document.querySelector(sel);
  if (!host) return;
  const d = document.createElement("div");
  d.className = "shield-fx2" + (side < 0 ? " s-left" : "");
  d.innerHTML = `<svg viewBox="0 0 24 30"><path d="M12 1 L23 5 L23 16 Q23 25 12 29 Q1 25 1 16 L1 5 Z" fill="#aab4c4" stroke="#5d6675" stroke-width="2"/><path d="M12 5 L19 7.5 L19 15 Q19 21 12 24 Q5 21 5 15 L5 7.5 Z" fill="#ffc800"/></svg>`;
  host.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("up"))); // swing UP into guard
  const hold = Math.max(420, holdMs || 600);
  setTimeout(() => d.classList.add("down"), hold);        // lower it after the attacker recovers
  setTimeout(() => d.remove(), hold + 340);
}

// procedurally generated journey backdrop, split into FAR (sky/hills, slow)
// and NEAR (pseudo-3D ground, fast) tiles; biome index drifts the palette and
// terrain so the duo naturally walks into new lands. All animation is GPU
// transform/opacity — no per-frame JS, no repaints.
// —— 场景库：程序生成的地球各地景观（户外/蓝天/废墟/沙漠/雪原/都市）——
const SCENE_ORDER = ["outdoor", "sky", "ruins", "desert", "snow", "city"];
const SCENES = {
  outdoor: { name: "户外", icon: "🌲", day: true, h: 115, gh: 105 },
  sky: { name: "蓝天白云", icon: "☁️", day: true, bright: true, h: 205, gh: 110 },
  ruins: { name: "废墟", icon: "🏛️", day: false, desat: true, h: 30, gh: 32 },
  desert: { name: "沙漠", icon: "🏜️", day: true, h: 42, gh: 40 },
  snow: { name: "雪原", icon: "❄️", day: true, pale: true, h: 210, gh: 212 },
  city: { name: "都市夜景", icon: "🌃", day: false, h: 228, gh: 230 },
};
function sceneFor(n, b) {
  const pref = localStorage.getItem("scenepref") || "auto";
  const key = SCENES[pref] ? pref : SCENE_ORDER[((b % SCENE_ORDER.length) + SCENE_ORDER.length) % SCENE_ORDER.length];
  return Object.assign({ key }, SCENES[key]);
}

function stageFarBG(n, b) {
  const sc = sceneFor(n, b);
  const R = prng(n * 131 + b * 977 + 7);
  const hue = sc.h, sat = sc.desat ? 14 : sc.pale ? 20 : 45;
  const Ls = sc.bright ? [74, 68, 62, 56] : sc.pale ? [78, 72, 66, 60] : sc.day ? [60, 53, 46, 40] : [10, 14, 18, 23];
  // base rect FIRST — the backdrop must never be see-through
  let parts = `<rect x="0" y="0" width="100" height="100" fill="hsl(${hue},${sat}%,${Ls[3]}%)"/>`;
  Ls.forEach((L, i) => { parts += `<rect x="0" y="${i * 15}" width="100" height="15" fill="hsl(${hue},${sat}%,${L}%)"/>`; });
  if (sc.day) { // pixel sun
    const sx = 12 + R() * 72;
    parts += `<rect x="${sx}" y="6" width="7" height="7" fill="hsl(48,96%,82%)"/><rect x="${sx + 1.5}" y="4.2" width="4" height="10.5" fill="hsl(48,96%,82%)"/>`;
  } else {
    for (let i = 0; i < 18; i++) parts += `<rect x="${(R() * 96).toFixed(0)}" y="${(R() * 36).toFixed(0)}" width="1" height="1" fill="hsl(${hue},60%,82%)" opacity="${(0.3 + R() * 0.5).toFixed(2)}"/>`;
  }
  const cn = sc.key === "sky" ? 5 : 2 + (b % 2); // 蓝天白云 gets a full cloud parade
  for (let c = 0; c < cn; c++) {
    const cx = R() * 80, cy = 4 + R() * 25, cw = 10 + R() * (sc.key === "sky" ? 16 : 8);
    const cl = sc.day ? `hsl(${hue},35%,${93 - (R() * 5 | 0)}%)` : `hsl(${hue},28%,${30 + R() * 12 | 0}%)`;
    parts += `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="3.6" fill="${cl}"/>
      <rect x="${(cx + 2).toFixed(1)}" y="${(cy - 2.2).toFixed(1)}" width="${(cw - 4).toFixed(1)}" height="2.6" fill="${cl}"/>`;
  }
  if (sc.key === "snow") for (let i = 0; i < 16; i++)
    parts += `<rect x="${(R() * 98).toFixed(1)}" y="${(R() * 70).toFixed(1)}" width="1.1" height="1.1" fill="#fff" opacity="${(0.5 + R() * 0.5).toFixed(2)}"/>`;
  if (sc.key === "city") { // skyline with lit windows instead of hills
    for (let i = 0; i < 10; i++) {
      const bw = 6 + R() * 7, bx = i * 10 - 2 + R() * 4, bh = 16 + R() * 26, by = 100 - 26 - bh;
      parts += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${(bh + 26).toFixed(1)}" fill="hsl(${hue},24%,${9 + (i % 3)}%)"/>`;
      for (let wy = by + 2; wy < 96; wy += 4) for (let wx = bx + 1.2; wx < bx + bw - 1.4; wx += 2.6)
        if (R() < 0.3) parts += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="1.1" height="1.5" fill="hsl(45,90%,${60 + R() * 18 | 0}%)"/>`;
    }
  } else {
    const hillL = sc.pale ? [62, 74] : sc.day ? [24, 31] : [7, 12];
    const hillSat = sc.desat ? 10 : sc.pale ? 14 : 26;
    for (let L = 0; L < 2; L++) {
      const base = 64 + L * 9, amp = (sc.key === "desert" ? 7 : b % 3 === 1 ? 22 : 14) - L * 4;
      const K = sc.key === "desert" ? 7 : 12, hs = [];
      for (let k = 0; k < K; k++) hs.push(base - R() * amp);
      hs.push(hs[0]);
      let pts = "";
      for (let k = 0; k <= K; k++) pts += `${((k * 100) / K).toFixed(1)},${hs[k].toFixed(0)} `;
      parts += `<polygon points="0,100 ${pts}100,100" fill="hsl(${sc.h},${hillSat}%,${hillL[L]}%)"/>`;
    }
    if (sc.key === "outdoor") for (let i = 0; i < 7; i++) { // pines on the ridge
      const tx = R() * 94, ty = 62 + R() * 6;
      parts += `<polygon points="${tx},${ty} ${(tx + 2.6).toFixed(1)},${(ty - 7).toFixed(1)} ${(tx + 5.2).toFixed(1)},${ty}" fill="hsl(120,30%,${13 + R() * 6 | 0}%)"/>
        <rect x="${(tx + 2.2).toFixed(1)}" y="${ty}" width="1.2" height="2.2" fill="hsl(25,30%,18%)"/>`;
    }
    if (sc.key === "ruins") for (let i = 0; i < 6; i++) { // broken pillars + fallen slabs
      const px = 4 + i * 16 + R() * 6, ph = 10 + R() * 14, broken = R() < 0.6;
      parts += `<rect x="${px.toFixed(1)}" y="${(78 - ph).toFixed(1)}" width="3.6" height="${ph.toFixed(1)}" fill="hsl(35,10%,${26 + R() * 8 | 0}%)"/>
        <rect x="${(px - 0.8).toFixed(1)}" y="${(78 - ph - (broken ? 0 : 2)).toFixed(1)}" width="${broken ? 2.2 : 5.2}" height="2" fill="hsl(35,10%,${30 + R() * 8 | 0}%)"/>
        <rect x="${(px + 4.5).toFixed(1)}" y="76" width="${(2 + R() * 4).toFixed(1)}" height="2" fill="hsl(35,8%,22%)"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" shape-rendering="crispEdges">${parts}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function stageNearBG(n, b) {
  const sc = sceneFor(n, b);
  const R = prng(n * 313 + b * 661 + 3);
  const gh = sc.gh, gs = sc.desat ? 12 : sc.pale ? 10 : 24;
  const gL = sc.pale ? [74, 65] : sc.bright ? [30, 24] : sc.day ? [17, 12] : sc.key === "city" ? [13, 9] : [12, 9];
  // opaque base from the horizon down — the floor can never be see-through again
  let parts = `<rect x="0" y="56" width="100" height="44" fill="hsl(${gh},${gs}%,${gL[1]}%)"/>`;
  // pseudo-3D: contiguous bands thickening toward the camera (no gaps)
  const rows = [[56, 2], [58, 2], [60, 3], [63, 4], [67, 5], [72, 6], [78, 7], [85, 8], [93, 7]];
  rows.forEach(([y, h], i) => {
    if (i % 2 === 0) parts += `<rect x="0" y="${y}" width="100" height="${h}" fill="hsl(${gh},${gs}%,${gL[0]}%)"/>`;
  });
  if (sc.key === "city") { // asphalt lane dashes
    for (let x = 2; x < 100; x += 13) parts += `<rect x="${x}" y="74" width="6" height="1.6" fill="hsl(50,40%,55%)" opacity="0.7"/>`;
  }
  for (let i = 0; i < 16; i++) { // depth-scaled per-scene debris
    const y = 58 + R() * 38, scd = (y - 56) / 44;
    const x = (R() * 97).toFixed(1);
    if (sc.key === "outdoor") parts += `<rect x="${x}" y="${(y - scd * 2).toFixed(1)}" width="${(0.7 + scd).toFixed(1)}" height="${(0.8 + scd * 2.2).toFixed(1)}" fill="hsl(115,35%,${20 + scd * 12 | 0}%)"/>`;
    else if (sc.key === "sky") parts += `<rect x="${x}" y="${y.toFixed(1)}" width="${(0.6 + scd).toFixed(1)}" height="${(0.6 + scd).toFixed(1)}" fill="hsl(${R() < 0.5 ? 50 : 0},80%,${70 + scd * 12 | 0}%)"/>`;
    else if (sc.key === "snow") parts += `<rect x="${x}" y="${y.toFixed(1)}" width="${(1.4 + scd * 2.6).toFixed(1)}" height="${(0.5 + scd).toFixed(1)}" fill="#fff" opacity="${(0.35 + scd * 0.4).toFixed(2)}"/>`;
    else if (sc.key === "ruins") parts += `<rect x="${x}" y="${y.toFixed(1)}" width="${(0.9 + scd * 2.4).toFixed(1)}" height="${(0.7 + scd * 1.4).toFixed(1)}" fill="hsl(35,8%,${20 + scd * 10 | 0}%)"/>`;
    else if (sc.key === "desert") parts += `<rect x="${x}" y="${y.toFixed(1)}" width="${(2 + scd * 4).toFixed(1)}" height="${(0.4 + scd * 0.6).toFixed(1)}" fill="hsl(${gh},30%,${24 + scd * 10 | 0}%)"/>`;
    else parts += `<rect x="${x}" y="${y.toFixed(1)}" width="${(0.6 + scd * 2).toFixed(1)}" height="${(0.4 + scd).toFixed(1)}" fill="hsl(${gh},16%,${16 + scd * 8 | 0}%)"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" shape-rendering="crispEdges">${parts}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function applyBiome(layerEl, n, b) {
  if (!layerEl) return;
  const far = layerEl.querySelector(".bg-far"), near = layerEl.querySelector(".bg-near");
  if (far) far.style.backgroundImage = stageFarBG(n, b);
  if (near) near.style.backgroundImage = stageNearBG(n, b);
}

// every ~22s of marching the inactive layer loads the NEXT biome and the two
// crossfade — a one-off SVG string + a GPU opacity transition, nothing more
function advanceBiome() {
  const stg = document.querySelector(".stage");
  if (!stg) return;
  BATTLE.biome = (BATTLE.biome || 0) + 1;
  const a = stg.querySelector("#bg-a"), bEl = stg.querySelector("#bg-b");
  if (!a || !bEl) return;
  const showB = a.classList.contains("bg-on");
  const incoming = showB ? bEl : a, outgoing = showB ? a : bEl;
  applyBiome(incoming, getGame().bossIndex, BATTLE.biome);
  incoming.classList.add("bg-on");
  outgoing.classList.remove("bg-on");
}

// one fully-resolved hit; returns true when the exchange must stop
function resolveHit(view, side, mult, trail, blocked) {
  const s = getGame();
  if (!BATTLE.running || BATTLE.koPause) return true;
  if (side === "hero") {
    const crit = Math.random() < todayAccuracy();
    const bonus = 1 + 0.15 * stStacks("heroBuff") + 0.25 * stStacks("bossVuln");
    let dmg = Math.max(1, Math.round(effAtk(s) * mult * bonus * (0.9 + Math.random() * 0.2))) * (crit ? 2 : 1);
    if (blocked) dmg = Math.max(1, Math.round(dmg * 0.25));
    s.bossHp -= dmg;
    spawnTrail("#boss-sprite", trail, bladeColor(s.weapon));
    if (blocked) {
      playSfx("clang");
      floatDmg("🛡格挡 -" + fmtNum(dmg), false, "#boss-sprite");
      spawnSparks("#boss-sprite", "#ffe9a0", 9);
    } else {
      playSfx(crit ? "crit" : "hit");
      if (crit) addStatus("heroBuff"); // 暴击叠斗志
      playHurt("#boss-sprite", 1);
      spawnImpact("#boss-sprite", crit ? "var(--warn)" : "var(--accent2)", crit);
      spawnShards("#boss-sprite", crit ? "#ffc800" : "#9adfff", crit ? 9 : 5);
      if (crit || mult >= 1) spawnShockwave("#boss-sprite");
      floatDmg((crit ? "暴击 -" : "-") + fmtNum(dmg), crit, "#boss-sprite");
      hitStop(crit ? 95 : 55);
      if (crit) stageShake();
    }
    if (s.bossHp <= 0) {
      s.bossHp = 0;
      const reward = killReward(s.bossIndex);
      const slain = bossOf(s.bossIndex);
      s.coins += reward; s.kills.push(s.bossIndex);
      blogPush(s, `🏆 击败 ${slain.name}！掉落 +${fmtNum(reward)} 🪶`);
      s.cxp = (s.cxp || 0) + killCxp(s.bossIndex);
      let leveled = 0;
      while (s.cxp >= cxpNeed(s.clv || 0)) { s.cxp -= cxpNeed(s.clv || 0); s.clv = (s.clv || 0) + 1; leveled++; }
      if (leveled) {
        setTimeout(() => { spawnCallout("#hero-sprite", `⚔️ 战斗等级 Lv.${s.clv}!`, "co-kill"); playSfxSynth("kill"); }, 350);
        blogPush(s, `⚔️ 战斗等级提升至 Lv.${s.clv}！当前称号「${titleOf(s)}」。攻击 +5%/级，体魄 +4%/级，外观进化。`);
      }
      s.bossIndex++; s.bossHp = bossMaxHp(s.bossIndex);
      saveGame(s);
      BATTLE.koPause = true;
      BATTLE.heroBuff = 0; BATTLE.bossVuln = 0;
      playSfx("kill");
      nextBgm();
      spawnShockwave("#boss-sprite");
      spawnShards("#boss-sprite", "#ffc800", 14);
      spawnCallout("#boss-sprite", "击破!", "co-kill");
      applyAnim("#boss-sprite", ["ko"], 700);
      assetBossAnim("die", true);
      applyAnim("#hero-sprite", ["victory"], 820);
      setFace("#hero-sprite", "happy", 900);
      setTimeout(() => {
        BATTLE.koPause = false;
        renderBattle();
        hitFx("#boss-sprite", "spawn");
        spawnDust(".spot-boss");
        spawnCallout("#boss-sprite", bossOf(getGame().bossIndex).name + " 出现!", "co-spawn");
        confetti(".stage"); toast(`🏆 击败 ${slain.name} +${fmtNum(reward)} 🪶`);
      }, 760);
      return true;
    }
    saveGame(s);
    battlePatchLive(view, s, null, false);
  } else {
    let dmg = Math.max(1, Math.round(bossAtk(s.bossIndex) * mult * (0.9 + Math.random() * 0.2)));
    if (blocked) dmg = Math.max(1, Math.round(dmg * 0.25));
    const pMax = heroMaxHp(s);
    s.hp = Math.max(0, s.hp - dmg);
    if (s.hp <= 0) { // 先扣血后复活：哪怕一击超过血量上限也照样爬起来，绝不卡死
      if (s.coins >= POTION_COST) {
        s.coins -= POTION_COST; s.hp = pMax;
        playSfx("potion");
        blogPush(s, "🧪 被打倒的瞬间灌下药水，满血爬起！");
      } else {
        s.hp = pMax;
        s.energy = Math.max(0, (s.energy || 0) - 45);
        blogPush(s, "💪 没钱买药，硬扛着爬了起来（-45 秒能量）。");
      }
    } else if (s.hp <= pMax * 0.15 && s.coins >= POTION_COST) { // 血线 15% 自动续药
      s.coins -= POTION_COST; s.hp = pMax;
      playSfx("potion");
      blogPush(s, "🧪 血量跌破 15%，自动喝下药水。");
    }
    spawnTrail("#hero-sprite", trail, "#ff7b6b");
    if (blocked) {
      playSfx("clang");
      floatDmg("🛡格挡 -" + fmtNum(dmg), false, "#hero-sprite");
      spawnSparks("#hero-sprite", "#ffe9a0", 9);
    } else {
      playSfx("hurt");
      playHurt("#hero-sprite", -1);
      spawnImpact("#hero-sprite", "var(--danger)");
      spawnShards("#hero-sprite", "#ff8080", 6);
      floatDmg("-" + fmtNum(dmg), false, "#hero-sprite");
      hitStop(60);
    }
    if (s.hp <= 0) blogPush(s, `💀 ${bossOf(s.bossIndex).name} 把你打倒了！${s.coins < POTION_COST ? "羽币不够买药水——明天免费满血。" : ""}`);
    saveGame(s);
    battlePatchLive(view, s, null, false);
  }
  return false;
}

function setDashVars(sel, fromSel, toSel, sign) {
  const el = document.querySelector(sel);
  if (!el) return;
  // 以「角色质心」算位移：冲到防守者质心前约一个武器身位，刀就真正接触到敌人（修隔空挥刀）
  const aImg = document.querySelector(sel + " img");
  const dImg = document.querySelector((sign > 0 ? "#boss-sprite" : "#hero-sprite") + " img");
  if (aImg && dImg && aImg.offsetWidth && dImg.offsetWidth) {
    const ar = aImg.getBoundingClientRect(), dr = dImg.getBoundingClientRect();
    const heroHit = (HERO_CUR && HERO_CUR.hit) || [0.5, 0.6];
    const bossHit = (MON.cfg && MON.cfg.hit) || [0.5, 0.55];
    const aHit = sign > 0 ? heroHit : bossHit, dHit = sign > 0 ? bossHit : heroHit;
    const aX = ar.left + aHit[0] * ar.width, aY = ar.top + aHit[1] * ar.height;
    const dX = dr.left + dHit[0] * dr.width, dY = dr.top + dHit[1] * dr.height;
    const gap = 56; // 停在防守者质心前一个武器身位
    const dx = (dX - aX) + (sign > 0 ? -gap : gap);
    el.style.setProperty("--dashX", (sign > 0 ? Math.max(20, dx) : Math.min(-20, dx)) + "px");
    el.style.setProperty("--dashY", (dY - aY) + "px");
    return;
  }
  // 兜底：容器边缘估算
  const v = dashVec(fromSel, toSel);
  if (!v) return;
  if (sign > 0) {
    el.style.setProperty("--dashX", Math.max(30, v.dx * 0.92) + "px");
    el.style.setProperty("--dashY", Math.min(-8, v.dy * 0.92) + "px");
  } else {
    el.style.setProperty("--dashX", Math.min(-30, v.dx * 0.9 + 40) + "px");
    el.style.setProperty("--dashY", Math.max(8, v.dy * 0.9) + "px");
  }
}

async function performMove(view, side, move) {
  const sel = side === "hero" ? "#hero-sprite" : "#boss-sprite";
  const defSel = side === "hero" ? "#boss-sprite" : "#hero-sprite";
  const spotSel = side === "hero" ? ".spot-hero" : ".spot-boss";
  const ranged = side === "boss" && MON.cfg && MON.cfg.ranged; // 法师/弓手/吐息：发射投射物，不贴脸近战
  spawnCallout(sel, side === "hero" ? move.name : (MON.cfg && MON.cfg.skill) || move.name, side === "hero" ? "co-hero" : "co-boss");
  if (side === "hero") playSfx("whoosh");
  else { playGrowl(getGame().bossIndex); if (ranged) playSfx(ranged === "fire" ? "castfire" : ranged === "arrow" ? "whoosh" : "cast"); }
  if (!ranged) {
    setDashVars(sel, side === "hero" ? ".spot-hero" : ".spot-boss", side === "hero" ? ".spot-boss" : ".spot-hero", side === "hero" ? 1 : -1);
    spawnDust(spotSel);
    spawnGhosts(spotSel, sel);
    applyAnim(sel, ["mv-" + move.id], move.dur);
  } else {
    applyAnim(sel, ["cast-pose"], move.dur); // 原地施法
  }
  if (side === "hero") {
    setFace("#hero-sprite", "attack", move.dur); // gritted look mid-move
    heroAnim(move.anim || "atk1", true); // 动作绑定招式名（横劈/竖劈/突刺…），不再随机
  } else assetBossAnim(MON.cfg && MON.cfg.anims.atk2 && Math.random() < 0.5 ? "atk2" : "atk", true);
  const blocked = Math.random() < (side === "hero" ? 0.12 : 0.15); // defender raises the shield
  let t = 0;
  for (const h of move.hits) {
    await wait(h.at - t); t = h.at;
    if (!BATTLE.running || BATTLE.koPause) return { stop: true, blocked };
    if (ranged) {
      await spawnProjectile(sel, defSel, ranged); // 法球飞抵勇者，命中瞬间才结算伤害
      if (!BATTLE.running || BATTLE.koPause) return { stop: true, blocked };
    }
    if (blocked && h === move.hits[0]) {
      spawnShield(defSel, side === "hero" ? 1 : -1, move.dur - t + 180);
      applyAnim(defSel, ["block-stance"], Math.max(440, move.dur - t)); // full braced pose
    }
    if (resolveHit(view, side, h.mult, h.trail, blocked)) return { stop: true, blocked };
  }
  await wait(move.dur - t + 30); // finish the recovery — the other side starts IMMEDIATELY
  return { stop: false, blocked };
}

// strictly linear: hero move → boss answer → hero move … zero idle gaps
async function combatLoop(view) {
  while (BATTLE.running) {
    const s = getGame();
    if ((s.energy || 0) < 1.9) {
      stopAutoBattle(); patchBattleHUD(view);
      toast("⚡ 能量耗尽——去刷题，每题 +30 秒");
      break;
    }
    if (s.hp <= 0) { stopAutoBattle(); patchBattleHUD(view); break; }
    s.energy -= 1.9; // one full exchange ≈ 1.9s
    saveGame(s);
    battlePatchLive(view, s, null, false);
    // telegraph the boss's planned answer before the hero moves (intent)
    const bossMove = BOSS_MOVES[drawBag("bossMoveBag", BOSS_MOVES.length)];
    showIntent(bossMove, s);
    const r1 = await performMove(view, "hero", HERO_MOVES[drawBag("heroMoveBag", HERO_MOVES.length)]);
    tickStatuses(); // 状态可叠加、持续 5 回合，每个交换回合衰减 1
    if (!BATTLE.running) break;
    if (r1.stop) { await wait(760); continue; } // respawn breath, then next exchange
    hideIntent();
    const r2 = await performMove(view, "boss", bossMove);
    if (r2.blocked) addStatus("bossVuln"); // 格挡反制：怪物破绽可叠加
  }
  hideIntent();
}

function buildVariants(n, maker) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(maker(prng(i * 977 + 13), i));
  return out;
}
const ATK_VARS = buildVariants(64, (R, i) => ({
  f: i % 4, s: (i >> 2) % 4,
  arcY: -(18 + R() * 70), tilt: R() * 24 - 12,
  amp: 38 + R() * 28, dir: R() < 0.5 ? -1 : 1,
}));
const HURT_VARS = buildVariants(64, (R, i) => ({
  f: i % 4, amp: 10 + R() * 18, rot: 4 + R() * 10,
}));
function drawBag(name, size) {
  let bag = BATTLE[name];
  if (!bag || !bag.length) {
    bag = [...Array(size).keys()];
    for (let i = bag.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [bag[i], bag[j]] = [bag[j], bag[i]]; }
    BATTLE[name] = bag;
  }
  return bag.pop();
}
const ANIM_CLASSES = ["mv-heng", "mv-shu", "mv-xie", "mv-ci", "mv-lian", "mv-hui", "mv-zhuang", "mv-zhua", "brace", "block-stance", "victory",
  "atk", "atk-f0", "atk-f1", "atk-f2", "atk-f3", "atk-s0", "atk-s1", "atk-s2", "atk-s3",
  "hurt", "hurt-f0", "hurt-f1", "hurt-f2", "hurt-f3", "flinch", "heroflinch", "dodge-side", "dodge-hop", "batk", "ko", "spawn"];
function applyAnim(sel, classes, durMs) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.classList.remove(...ANIM_CLASSES);
  void el.offsetWidth;
  el.classList.add(...classes);
  clearTimeout(el._animT);
  el._animT = setTimeout(() => el.classList.remove(...classes), durMs);
}
function playHurt(sel, dir) { // shared 64-variant hurt library (hero & monsters)
  setFace(sel, "hurt", 340);
  if (sel === "#boss-sprite") assetBossAnim("hurt", true);
  if (sel === "#hero-sprite") heroAnim("hurt", true);
  const h = HURT_VARS[drawBag("hurtBag", 64)];
  const el = document.querySelector(sel);
  if (!el) return;
  el.style.setProperty("--hAmp", h.amp);
  el.style.setProperty("--hDir", dir);
  el.style.setProperty("--hRot", h.rot);
  applyAnim(sel, ["hurt", "hurt-f" + h.f], 340);
}
function hitStop(ms) { // classic impact freeze
  const st = document.querySelector(".stage");
  if (!st) return;
  st.classList.add("hitstop");
  setTimeout(() => st.classList.remove("hitstop"), ms);
}
function stageShake() {
  const st = document.querySelector(".stage");
  if (!st) return;
  st.classList.remove("shake"); void st.offsetWidth; st.classList.add("shake");
  setTimeout(() => st.classList.remove("shake"), 220);
}
function spawnShards(sel, color, n) {
  const host = spriteFxHost(sel);
  if (!host) return;
  for (let i = 0; i < (n || 6); i++) {
    const s = document.createElement("div");
    s.className = "shard";
    s.style.background = color;
    s.style.setProperty("--sx", (Math.random() * 76 - 38) + "px");
    s.style.setProperty("--sy", (-Math.random() * 54 - 8) + "px");
    host.appendChild(s);
    setTimeout(() => s.remove(), 460);
  }
}

// fire cb the moment the attacker's box overlaps the defender's.
// interval-based (NOT rAF): rAF freezes in hidden tabs, which silently
// disabled all damage; with timers the maxMs fallback still resolves hits.
function onCollision(attSel, defSel, maxMs, cb) {
  const att = document.querySelector(attSel), def = document.querySelector(defSel);
  if (!att || !def) { setTimeout(cb, maxMs / 2); return; }
  const t0 = performance.now();
  const iv = setInterval(() => {
    const a = att.getBoundingClientRect(), d = def.getBoundingClientRect();
    const hit = a.left < d.right - 10 && a.right > d.left + 10 && a.top < d.bottom - 10 && a.bottom > d.top + 10;
    if (hit || performance.now() - t0 > maxMs) { clearInterval(iv); cb(); }
  }, 40);
}
function spawnImpact(sel, color, big) {
  const host = spriteFxHost(sel);
  if (!host) return;
  const r = document.createElement("div");
  r.className = "fx-burst" + (big ? " fx-burst-big" : "");
  r.style.setProperty("--glow", color);
  r.innerHTML = `<img src="fx/${big ? "star_06.png" : "muzzle_01.png"}" alt="">`;
  host.appendChild(r);
  setTimeout(() => r.remove(), 340);
}

function dashVec(fromSel, toSel) {
  const f = document.querySelector(fromSel), t = document.querySelector(toSel);
  if (!f || !t) return null;
  const fr = f.getBoundingClientRect(), tr = t.getBoundingClientRect();
  return { dx: tr.left - fr.right, dy: tr.top - fr.top };
}

function battlePatchLive(view, s, dmg, crit) {
  const pMax = heroMaxHp(s), bMax = bossMaxHp(s.bossIndex);
  const set = (sel, v) => { const el = $(sel, view); if (el) el.textContent = v; };
  set("#bt-myhp", fmtNum(s.hp)); set("#bt-bosshp", fmtNum(s.bossHp));
  set("#bt-coins", fmtNum(s.coins)); set("#bt-energy", fmt(Math.ceil(s.energy || 0)));
  const mb = $("#bt-myhp-bar", view); if (mb) mb.style.width = Math.round((s.hp / pMax) * 100) + "%";
  const bb = $("#bt-bosshp-bar", view); if (bb) bb.style.width = Math.round((s.bossHp / bMax) * 100) + "%";
  if (dmg != null) floatDmg(`-${dmg}`, crit);
}

function renderBattle() {
  const view = $("#battle-pane");
  HERO_CUR = heroFormFor(getGame()); // 勇者形态随战斗等级
  const { Q, B, allDone, extra, g } = settleTower();
  const boss = bossOf(g.bossIndex);
  const bMax = bossMaxHp(g.bossIndex);
  const pMax = heroMaxHp(g);
  const atk = effAtk(g);
  const down = g.hp <= 0;
  const nextTier = g.towerClaimed + 1;
  const tierProgress = allDone && B > 0 ? Math.min(extra - g.towerClaimed * B, B) : 0;
  view.innerHTML = `
    <h2 style="display:flex;justify-content:space-between;align-items:center">⚔️ 打怪塔
      <button class="ghost" id="bt-fold" title="折叠/展开战斗面板"></button></h2>
    <div id="bt-body">
    <p class="subtitle">⚡ <b>战斗能量靠刷题赚：1 题 = ${ENERGY_PER_ITEM} 秒自动战斗</b>（约 25 分钟练习 ≈ 10 分钟战斗）。
    <b>回合制</b>：勇者一整套招式（横劈/竖劈/交叉斩/突刺/连斩/回旋斩）收招瞬间，怪物立刻反击，轮流无间隔；
    防守方有概率<b>盾牌格挡</b>（减伤 75%）；<b>答题正确率 = 暴击率</b>。血少自动喝药水；羽币只买装备。</p>

    <div class="scene-pick">🗺️ 场景：
      <button class="scene-btn ${(localStorage.getItem("scenepref") || "auto") === "auto" ? "on" : ""}" data-scene="auto">🌍 环游世界</button>
      ${SCENE_ORDER.map(k => `<button class="scene-btn ${localStorage.getItem("scenepref") === k ? "on" : ""}" data-scene="${k}">${SCENES[k].icon} ${SCENES[k].name}</button>`).join("")}
    </div>
    <div class="battle-status">
      <div class="plate plate-hero">
        <b>🦉 ${titleOf(g)} <span style="color:var(--warn)">⚔Lv.${g.clv || 0}</span>${(g.reborn || 0) ? ` <span style="color:var(--accent2)">🌀×${g.reborn}</span>` : ""}</b>${down ? ' <span class="result-bad">被打倒</span>' : ""}<button class="fx-flip" data-fx="fliphero" title="左右翻转勇者">🔄</button>
        <div class="hp-bar"><div class="hp-me" id="bt-myhp-bar" style="width:${Math.round((g.hp / pMax) * 100)}%"></div></div>
        <div class="xp-mini" title="经验：${xpTotal()} XP"><div style="width:${levelInfo(xpTotal()).pct}%"></div></div>
        <span class="muted">❤️ <span id="bt-myhp">${fmtNum(g.hp)}</span> / ${fmtNum(pMax)} · 🪶 <b style="color:var(--warn)" id="bt-coins">${fmtNum(g.coins)}</b> · ⚡ <b style="color:var(--accent2)" id="bt-energy">${fmt(Math.ceil(g.energy || 0))}</b></span><span id="st-hero"></span>
        <div class="plate-gear muted">⚔️ ${weaponName(g.weapon)} · 攻击 <b style="color:var(--warn)">${fmtNum(atk)}</b><span class="muted">（基础 ${fmtNum(atkOf(g.weapon))}${(g.clv || 0) ? ` × 等级+${5 * g.clv}%` : ""}${(g.reborn || 0) ? ` × 轮回+${25 * g.reborn}%` : ""}）</span><br>
        🛡 ${armorName(g.armor)} · 💥 暴击率 <b style="color:var(--warn)">${Math.round(todayAccuracy() * 100)}%</b> · 升级还需 ${fmtNum(cxpNeed(g.clv || 0) - (g.cxp || 0))} 击杀经验</div>
      </div>
      <div class="plate plate-boss">
        <b>${esc(boss.name)}</b> <span class="muted">Lv.${boss.lvl}</span><button class="fx-flip" data-fx="flipboss" title="左右翻转怪物">🔄</button>
        <div class="hp-bar"><div class="hp-boss" id="bt-bosshp-bar" style="width:${Math.round((g.bossHp / bMax) * 100)}%"></div></div>
        <span class="muted">❤️ <span id="bt-bosshp">${fmtNum(g.bossHp)}</span> / ${fmtNum(bMax)}</span><span id="st-boss"></span>
        <div class="plate-gear muted">⚔️ 攻击 ~${fmtNum(Math.round(bossAtk(g.bossIndex)))} · 🪶 击杀掉落 +${fmtNum(killReward(g.bossIndex))} · 击杀经验 +${fmtNum(Math.round(killCxp(g.bossIndex)))}</div>
      </div>
    </div>
    <div class="stage">
      <div class="bgs bg-on" id="bg-a"><div class="bg-strip bg-far"></div><div class="bg-strip bg-near"></div></div>
      <div class="bgs" id="bg-b"><div class="bg-strip bg-far"></div><div class="bg-strip bg-near"></div></div>
      <div class="spot spot-boss idle-b"><div class="intent hidden" id="boss-intent"></div><div class="sprite" id="boss-sprite">${bossPortrait(g.bossIndex)}</div></div>
      <div class="spot spot-hero idle-h"><div class="sprite" id="hero-sprite"><img id="hero-img" class="hero-img" src="mon/${HERO_CUR.key}_idle_0.png" style="${HERO_CUR.css};filter:drop-shadow(0 3px 3px rgba(0,0,0,0.45))"></div></div>
    </div>
    <details class="fx-tune">
      <summary>⚙ 战斗微调 · 翻转 / 位置 / 间距（手动调一次，存档永久记住，不再被自动识别搞反）</summary>
      <div class="fx-grid">
        <span>勇者</span><button data-fx="fliphero">🔄翻转</button><button data-fx="h-left" title="左移">◀</button><button data-fx="h-right" title="右移">▶</button><button data-fx="h-up" title="上移">▲</button><button data-fx="h-down" title="下移">▼</button><button data-fx="h-big" title="放大">🔍＋</button><button data-fx="h-small" title="缩小">🔍－</button>
        <span>怪物</span><button data-fx="flipboss">🔄翻转</button><button data-fx="b-left" title="左移">◀</button><button data-fx="b-right" title="右移">▶</button><button data-fx="b-up" title="上移">▲</button><button data-fx="b-down" title="下移">▼</button><button data-fx="b-big" title="放大">🔍＋</button><button data-fx="b-small" title="缩小">🔍－</button>
        <span>全局</span><button data-fx="closer">间距－</button><button data-fx="farther">间距＋</button><button data-fx="step">步长:粗</button><button data-fx="reset">↺ 全部重置</button>
      </div>
    </details>

    <div class="card">
      <button class="primary" id="bt-auto" ${(g.energy || 0) <= 0 ? "disabled" : ""}>${BATTLE.running ? "⏸ 暂停自动战斗" : "▶ 开始自动战斗"}</button>
      <button class="ghost" id="bt-bgm" style="float:right" title="背景音乐开关">${BGM.on ? "🎵" : "🚫🎵"}</button><button class="ghost" id="bt-sfx" style="float:right" title="音效开关">${SFX.on ? "🔊" : "🔇"}</button><button class="secondary" id="bt-potion" ${g.coins < POTION_COST || g.hp >= pMax ? "disabled" : ""}>🧪 药水回满血（-${POTION_COST} 🪶）</button>
      <span class="muted" id="bt-hint">${(g.energy || 0) <= 0 ? "能量耗尽——去刷题，每题 +30 秒战斗时间" : down ? "被打倒了！自动战斗会自动喝药水复活，或明天免费满血" : ""}</span>
    </div>

    ${g.bossIndex >= REBIRTH_FLOOR ? `
    <div class="card" style="border-color:var(--accent2)">
      <h3>🌀 轮回转生</h3>
      <p class="muted">已抵达 ${g.bossIndex} 层。转生将清空装备、羽币并回到第 1 层，但<b>保留战斗等级</b>，并获得<b>永久 +25% 伤害</b>（可叠加，当前 ×${g.reborn || 0}）。数值重回清爽区间，旅途重新开始。</p>
      <button class="secondary" id="bt-rebirth">🌀 转生（攻击永久 +25%）</button>
    </div>` : ""}
    <div class="card">
      <h3>🛒 装备店</h3>
      <div class="shop-row">
        <span>⚔️ <b>${weaponName(g.weapon + 1)}</b> <span class="muted">攻击 ${atk} → ${fmtNum(Math.round(effAtk({ ...g, weapon: g.weapon + 1 })))}</span></span>
        <button class="ghost" id="bt-weapon" ${g.coins < weaponCost(g.weapon) ? "disabled" : ""}>升级（-${fmtNum(weaponCost(g.weapon))} 🪶）</button>
      </div>
      <div class="shop-row">
        <span>🛡 <b>${armorName(g.armor + 1)}</b> <span class="muted">血上限 ${pMax} → ${fmtNum(heroMaxHp({ ...g, armor: g.armor + 1 }))}</span></span>
        <button class="ghost" id="bt-armor" ${g.coins < armorCost(g.armor) ? "disabled" : ""}>升级（-${fmtNum(armorCost(g.armor))} 🪶）</button>
      </div>
    </div>

    <div class="card">
      <h3>📜 战斗日志</h3>
      ${(g.blog || []).map(l => `<div class="log-entry">${esc(l)}</div>`).join("") || '<p class="muted">还没有战斗记录。攒点羽币来砍第一刀！</p>'}
    </div>

    <div class="card">
      <h3>🏆 战利品架</h3>
      <div class="badge-grid">
        ${g.kills.length ? g.kills.map(n => `<div class="badge"><div class="badge-icon">${bossOf(n).icon}</div><div class="lbl">${esc(bossOf(n).name)}</div></div>`).join("") : '<p class="muted">还没有击败任何 BOSS。</p>'}
      </div>
    </div>
    </div>`;

  const stg = $(".stage", view);
  if (stg) {
    stg.style.setProperty("--tileW", (stg.clientHeight || 330) + "px");
    applyBiome($("#bg-a", view), g.bossIndex, BATTLE.biome || 0);
    if (BATTLE.running) stg.classList.add("scrolling"); // a kill re-renders the stage — keep marching
  }
  clearInterval(MON.t);
  MON.cfg = bossAssetOf(g.bossIndex);
  if (MON.cfg) { preloadAssetBoss(MON.cfg); assetBossAnim("battle"); }
  clearInterval(HMON.t);
  preloadHero();
  heroAnim(heroDefaultAnim());

  $("#bt-auto", view).onclick = () => {
    if (BATTLE.running) { stopAutoBattle(); }
    else startAutoBattle(view);
  };
  $("#bt-bgm", view).onclick = () => {
    BGM.on = !BGM.on;
    localStorage.setItem("bgmoff", BGM.on ? "0" : "1");
    $("#bt-bgm", view).textContent = BGM.on ? "🎵" : "🚫🎵";
    if (BGM.on && BATTLE.running) startBgm(); else stopBgm();
  };
  $("#bt-sfx", view).onclick = () => {
    SFX.on = !SFX.on;
    localStorage.setItem("sfxoff", SFX.on ? "0" : "1");
    $("#bt-sfx", view).textContent = SFX.on ? "🔊" : "🔇";
  };
  $("#bt-potion", view).onclick = () => {
    const s = getGame();
    if (s.coins < POTION_COST) return;
    s.coins -= POTION_COST; s.hp = heroMaxHp(s);
    playSfx("potion");
    blogPush(s, "🧪 喝下药水，血量回满。");
    saveGame(s); renderBattle();
  };
  view.querySelectorAll(".scene-btn").forEach(btn => btn.onclick = () => {
    localStorage.setItem("scenepref", btn.dataset.scene);
    renderBattle();
  });
  const rb = $("#bt-rebirth", view);
  if (rb) rb.onclick = () => {
    if (!confirm("确定转生？装备、羽币、楼层清零；保留战斗等级；伤害永久 +25%。")) return;
    const s = getGame();
    s.reborn = (s.reborn || 0) + 1;
    s.weapon = 0; s.armor = 0; s.coins = 0;
    s.bossIndex = 0; s.bossHp = bossMaxHp(0); s.kills = [];
    s.hp = heroMaxHp(s);
    blogPush(s, `🌀 第 ${s.reborn} 次轮回！伤害永久 +${s.reborn * 25}%，旅途重新开始。`);
    saveGame(s);
    stopAutoBattle();
    renderBattle();
    confetti(".stage"); toast(`🌀 轮回 ×${s.reborn} — 永久伤害 +${s.reborn * 25}%`);
  };
  $("#bt-weapon", view).onclick = () => {
    const s = getGame();
    if (s.coins < weaponCost(s.weapon)) return;
    s.coins -= weaponCost(s.weapon); s.weapon++;
    blogPush(s, `⚔️ 入手 ${weaponName(s.weapon)}！攻击提升到 ${atkOf(s.weapon)}。`);
    saveGame(s); renderBattle(); toast("⚔️ 武器升级！");
  };
  $("#bt-armor", view).onclick = () => {
    const s = getGame();
    if (s.coins < armorCost(s.armor)) return;
    s.coins -= armorCost(s.armor); s.armor++; s.hp = maxHpOf(s.armor);
    blogPush(s, `🛡 换上 ${armorName(s.armor)}！血上限提升到 ${maxHpOf(s.armor)}，并回满血。`);
    saveGame(s); renderBattle(); toast("🛡 防具升级！");
  };

  $("#bt-fold", view).onclick = () => {
    localStorage.setItem("battlefold", localStorage.getItem("battlefold") === "1" ? "" : "1");
    applyBattleFold();
  };
  applyBattleFold();
  bindCombatFx(view);
  applyCombatFx();
  patchBattleHUD(view);
}

function applyBattleFold() {
  const pane = $("#battle-pane");
  if (!pane) return;
  const folded = localStorage.getItem("battlefold") === "1";
  pane.classList.toggle("folded", folded);
  const b = $("#bt-fold", pane);
  if (b) b.textContent = folded ? "展开 ▸" : "折叠 ▾";
}

// 右半屏的刷题视图：边打边刷（战斗常驻左侧，刷题在这里）
function renderDrill() {
  const view = $("#view-battle");
  view.innerHTML = `
    <h2>⚡ 边打边刷</h2>
    <p class="subtitle">每题 +10 XP，计入今日爬塔进度。左边的战斗不会停——你刷题赚能量，怪物边上挨揍。</p>
    <div class="card">
      <p class="muted" style="margin:4px 0 10px" id="mini-tower-line"></p>
      <div id="mini-body"></div>
    </div>`;
  renderMiniBody(view);
  patchBattleHUD();
}

// ── partial updates: never re-render the whole battle view per drill answer ──
function patchBattleHUD(view) {
  view = document; // battle pane and drill view live in separate panes — patch globally
  const { Q, B, allDone, extra, g } = settleTower();
  const nextTier = g.towerClaimed + 1;
  const tierProgress = allDone && B > 0 ? Math.min(extra - g.towerClaimed * B, B) : 0;
  const line = $("#mini-tower-line", view);
  if (line) line.innerHTML = allDone
    ? `🗼 Tier ${nextTier}：还差 <b style="color:var(--warn)">${B - tierProgress}</b> 题 → +${towerReward(nextTier)} 🪶（今日已爬 ${g.towerClaimed} 层）`
    : `先完成首页的基础打卡（还差 ${Q.filter(q => q.done < q.n).length} 项）解锁爬塔奖励——这里刷的题也计入总量`;
  const coins = $("#bt-coins", view);
  if (coins) coins.textContent = g.coins;
  const autoBtn = $("#bt-auto", view), potBtn = $("#bt-potion", view);
  if (autoBtn) autoBtn.disabled = (g.energy || 0) <= 0 && !BATTLE.running;
  if (potBtn) potBtn.disabled = g.coins < POTION_COST || g.hp >= heroMaxHp(g);
  const en = $("#bt-energy", view);
  if (en) en.textContent = fmt(Math.ceil(g.energy || 0));
  const wBtn = $("#bt-weapon", view), aBtn = $("#bt-armor", view);
  if (wBtn) wBtn.disabled = g.coins < weaponCost(g.weapon);
  if (aBtn) aBtn.disabled = g.coins < armorCost(g.armor);
}

function renderMiniBody(view) {
  const body = $("#mini-body", view);
  if (!body) return;
  const gate = settleTower();
  if (!gate.allDone) { // the drill is dessert: base quests first
    body.innerHTML = `
      <div class="prompt-box" style="border-left-color:var(--warn);font-size:15px">🔒 边打边刷在<b>完成今日基础打卡</b>后开放（还差 ${gate.Q.filter(q => q.done < q.n).length} 项）。先去把今天的正餐吃完！</div>
      <button class="primary" id="mini-goquest" style="margin-top:4px">去完成今日任务 ▶</button>`;
    $("#mini-goquest", body).onclick = () => document.querySelector('.nav-item[data-view="plan"]').click();
    return;
  }
  if (!MINI.q || coolLeft(MINI.mode) > 0) {
    if (coolLeft(MINI.mode) > 0) {
      const next = MINI_MODES.find(m => coolLeft(m) <= 0 && (m !== "vb" || vbHasWords()));
      if (next) MINI.mode = next;
    }
    nextMiniQ();
  }
  const ladder = getSpeakLadder();
  const spStage = SPEAK_STAGES[ladder.stage];
  body.innerHTML = `
    <div class="mini-tabs">
      ${[["rs", "⚡ 真假词"], ["fb", "🔤 补全单词"], ["lt", "🎧 听写"], ["ct2", "📖 补全微段"], ["vb", "📒 生词听写"], ["sp", "🎤 口语"]].map(([m, label]) => {
        const cl = coolLeft(m);
        const empty = m === "vb" && !vbHasWords();
        return `<button class="ghost mini-tab ${MINI.mode === m ? "mini-tab-on" : ""}" data-mode="${m}" ${cl > 0 || empty ? "disabled" : ""}>${label}${cl > 0 ? ` ⏳${Math.ceil(cl / 60000)}m` : ""}${empty ? "（空）" : ""}</button>`;
      }).join("")}
    </div>
    ${MINI.last ? `<p class="mini-feedback">${MINI.last}</p>` : ""}
    <div id="mini-area">
      ${MINI.mode === "rs" ? `
        <div class="big-word" style="font-size:38px;padding:14px 0 4px">${esc(MINI.q.word)}</div>
        <p class="muted" style="text-align:center">是真实的英文单词吗？</p>
        <div class="choice-row" style="margin:12px 0 4px">
          <button class="primary" id="mini-yes" style="padding:10px 38px">Yes</button>
          <button class="ghost" id="mini-no" style="padding:10px 38px">No</button>
        </div>` : ""}
      ${MINI.mode === "fb" ? `
        <div class="prompt-box" style="font-size:16px">${esc(MINI.q.item.s)}
          <b>${esc(MINI.q.shown)}</b><input type="text" class="ctest-input" id="mini-input" size="6" autocomplete="off">.
        </div>
        <button class="primary" id="mini-submit">提交</button>` : ""}
      ${MINI.mode === "lt" ? `
        <div style="margin:10px 0">
          <button class="secondary" id="mini-play">🔊 播放（剩 ${3 - MINI.q.plays} 次）</button>
        </div>
        <input type="text" id="mini-input" placeholder="听到什么打什么" autocomplete="off">
        <button class="primary" id="mini-submit" style="margin-top:10px">提交</button>` : ""}
      ${MINI.mode === "ct2" ? `
        <p class="muted" style="margin-bottom:4px">补全这句话里残缺的词：</p>
        <div class="prompt-box ctest-passage" style="font-size:16px;line-height:2.1">${MINI.q.toks.map((w, i) => {
          const p = (MINI.q.parts || []).find(x => x.i === i);
          if (!p) return esc(w);
          const punct = w.replace(/^[A-Za-z]+/, "");
          return `${esc(p.shown)}<input class="ctest-input mini-ct2" data-miss="${esc(p.full.slice(p.shown.length))}" data-full="${esc(p.full)}" size="${Math.max(p.full.length - p.shown.length, 2)}" autocomplete="off">${esc(punct)}`;
        }).join(" ")}</div>
        <button class="primary" id="mini-submit">提交</button>` : ""}
      ${MINI.mode === "vb" ? `
        <p class="muted">你生词本里的词（来自「${esc(MINI.q.src || "")}」）。听发音 + 看语境，拼出来：</p>
        ${MINI.q.ctx ? `<div class="prompt-box" style="font-size:15px">${esc(MINI.q.ctx)}</div>` : ""}
        <div style="margin:8px 0"><button class="secondary" id="mini-play">🔊 再听一遍</button></div>
        <input type="text" id="mini-input" placeholder="拼写这个词" autocomplete="off">
        <button class="primary" id="mini-submit" style="margin-top:10px">提交</button>` : ""}
      ${MINI.mode === "sp" ? `
        <p class="muted" style="margin:4px 0 6px">口语微练 <b style="color:var(--accent2)">Lv.${ladder.stage + 1}/3 ${spStage.name}</b>
          · 过线 <b style="color:var(--warn)">≥${spPassNeed(ladder.stage)} 分</b>（${spStage.time} 秒）· 连过 <b>${ladder.streak}/3</b> 升级${ladder.stage >= 2 ? "（已到顶级）" : ""}
          ${(() => { const h = getSpHist(); if (!h.length) return ""; const today = h.filter(e => dayKey(e.t) === dayKey(Date.now())); const avg = today.length ? Math.round(today.reduce((s, e) => s + e.s, 0) / today.length) : 0; return ` · 今日均分 <b>${avg || "--"}</b> · 最佳 <b>${Math.max(...h.map(e => e.s))}</b>`; })()}</p>
        <p style="font-weight:800;margin-bottom:4px">${SP_TYPES[MINI.q.type]}</p>
        ${MINI.q.type === "is" ? `<div class="prompt-box" style="font-size:15px">点录音后，问题只朗读一遍——听完直接开口，和真题一样。</div>` : ""}
        ${MINI.q.type === "sap" ? `<div class="photo-frame"><img src="${photoURL(MINI.q.seed)}" alt="photo" style="max-height:220px"></div>` : ""}
        ${MINI.q.type === "rts" ? `<div class="prompt-box" style="font-size:15px">${esc(MINI.q.text)}<br><span class="muted">· ${esc(MINI.q.bullet)}</span></div>` : ""}
        ${MINI.q.type === "ss" ? `<div class="prompt-box" style="font-size:15px">${esc(MINI.q.text)}<br><span class="muted">说出你的观点 + 一个理由${ladder.stage > 0 ? " + 一个例子" : ""}。</span></div>` : ""}
        <button class="primary" id="mini-rec">${MINI.q.type === "is" ? "🔊 听题并录音" : "🎙 开始录音"}（最长 ${spStage.time} 秒，再点提前结束）</button>
        <div id="sp-ai" style="margin-top:8px"></div>` : ""}
    </div>`;

  const numEl = body.querySelector(".sp-num");
  if (numEl) countUp(numEl);
  if (MINI.mode === "sp" && MINI.lastCtx) {
    aiFeedbackButton($("#sp-ai", body), "AI 详评上一答（可选，不打断节奏）", () => ({
      system: SPEAK_RATER,
      user: `题型：${MINI.lastCtx.type}（口语微练）\n题目：${MINI.lastCtx.q}\n考生回答（语音转写）：\n${MINI.lastCtx.text || "(空)"}`,
      maxTokens: 3200,
    }));
  }
  body.querySelectorAll(".mini-tab").forEach(b => {
    b.onclick = () => { MINI.mode = b.dataset.mode; MINI.q = null; MINI.last = null; renderMiniBody(view); };
  });
  const miniDone = (ok, answerLine, logDetail) => {
    MINI.last = answerLine.startsWith("<") ? answerLine : `${ok ? "✅" : "❌"} ${esc(answerLine)}`;
    logPractice("mini", logDetail, ok);
    noteMiniDone(MINI.mode);
    MINI.q = null;
    renderMiniBody(view);   // only the drill area re-renders…
    patchBattleHUD(view);   // …plus targeted number patches (settles tower → toasts fire)
  };
  if (MINI.mode === "rs") {
    const q = MINI.q;
    const ans = yes => {
      const ok = yes === q.isReal;
      if (q.isReal && !ok) addVocab([q.word], "真假词");
      if (!ok) addWrong("rs", q.word, yes ? "判为真词" : "判为假词", q.isReal ? "真词" : "假词");
      miniDone(ok, `${q.word} 是${q.isReal ? "真词" : "假词"}`, ok ? "✓" : "✗");
    };
    $("#mini-yes", body).onclick = () => ans(true);
    $("#mini-no", body).onclick = () => ans(false);
  }
  if (MINI.mode === "fb") {
    const { item, shown } = MINI.q;
    const grade = () => {
      const got = $("#mini-input", body).value.trim().toLowerCase();
      const ok = got === item.w.slice(shown.length);
      if (!ok) { addVocab([item.w], "补全单词", item.s + " ___"); addWrong("fb", item.s + " ___", shown + (got || "(空)"), item.w); }
      miniDone(ok, `答案：${item.w}`, ok ? "✓" : "✗");
    };
    $("#mini-submit", body).onclick = grade;
    $("#mini-input", body).onkeydown = e => { if (e.key === "Enter") grade(); };
    $("#mini-input", body).focus();
  }
  if (MINI.mode === "lt") {
    const q = MINI.q;
    $("#mini-play", body).onclick = () => {
      if (q.plays >= 3) return;
      q.plays++;
      $("#mini-play", body).textContent = `🔊 播放（剩 ${3 - q.plays} 次）`;
      if (q.plays >= 3) $("#mini-play", body).disabled = true;
      speak(q.sentence);
    };
    const grade = () => {
      stopSpeak();
      const norm = s => s.toLowerCase().replace(/[^a-z0-9' ]/g, "").split(/\s+/).filter(Boolean);
      const target = norm(q.sentence), got = norm($("#mini-input", body).value);
      const correct = target.filter((w, i) => got[i] === w).length;
      const pct = Math.round((correct / target.length) * 100);
      const gotSet = new Set(got);
      addVocab([...new Set(target.filter(w => w.length >= 4 && !gotSet.has(w)))].slice(0, 3), "听写", q.sentence);
      if (pct < 80) addWrong("lt", q.sentence, $("#mini-input", body).value.trim() || "(空)", q.sentence);
      miniDone(pct >= 80, `${pct}% · 原句：${q.sentence}`, `${pct}%`);
    };
    $("#mini-submit", body).onclick = grade;
    $("#mini-input", body).onkeydown = e => { if (e.key === "Enter") grade(); };
  }
  if (MINI.mode === "ct2") {
    const grade = () => {
      const inputs = [...body.querySelectorAll(".mini-ct2")];
      const fails = [];
      inputs.forEach(inp => {
        if (inp.value.trim().toLowerCase() !== inp.dataset.miss.toLowerCase()) {
          fails.push(inp.dataset.full);
          addVocab([inp.dataset.full], "补全微段");
          addWrong("ct2", MINI.q.sentence, (inp.dataset.full.slice(0, inp.dataset.full.length - inp.dataset.miss.length)) + (inp.value.trim() || "(空)"), inp.dataset.full);
        }
      });
      const ok = fails.length === 0;
      miniDone(ok, ok ? `全对 · ${MINI.q.sentence}` : `错了 ${fails.join("、")} · ${MINI.q.sentence}`, ok ? "✓" : "✗");
    };
    $("#mini-submit", body).onclick = grade;
    body.querySelectorAll(".mini-ct2").forEach(i => { i.onkeydown = e => { if (e.key === "Enter") grade(); }; });
    const first = body.querySelector(".mini-ct2");
    if (first) first.focus();
  }
  if (MINI.mode === "vb") {
    const q = MINI.q;
    $("#mini-play", body).onclick = () => speak(q.word, { rate: 0.8 });
    speak(q.word, { rate: 0.8 });
    const grade = () => {
      const got = $("#mini-input", body).value.trim().toLowerCase();
      const ok = got === q.word.toLowerCase();
      if (ok) {
        const all = getVocab();
        const it = all.find(x => x.w === q.word);
        if (it) { it.known = true; saveVocab(all); }
      } else addWrong("vb", `生词听写${q.ctx ? `（语境：${q.ctx}）` : ""}`, got || "(空)", q.word);
      miniDone(ok, `${q.word}${ok ? " · 拼对即标记掌握 ✓" : ""}`, ok ? "✓" : "✗");
    };
    $("#mini-submit", body).onclick = grade;
    $("#mini-input", body).onkeydown = e => { if (e.key === "Enter") grade(); };
    $("#mini-input", body).focus();
  }
  if (MINI.mode === "sp") {
    const q = MINI.q;
    const stage = SPEAK_STAGES[q.stage];
    const btn = $("#mini-rec", body);
    let recorder = null, stream = null, timer = null, secs = 0;
    const stopRec = async () => {
      clearInterval(timer);
      btn.disabled = true; btn.textContent = "🤖 转写中…";
      recorder.stop();
      const blob = await recorder.done;
      stopStream(stream);
      let text = "";
      try { text = await serverTranscribe(blob); }
      catch (e) { btn.disabled = false; btn.textContent = `转写失败（${String(e.message || e).slice(0, 30)}），点击重试`; return; }
      const ladder = getSpeakLadder();
      const dur = Math.max(stage.time - Math.max(secs, 0), 2);
      const { score, parts } = spScore(text, dur, q.stage);
      const passNeed = spPassNeed(q.stage);
      const ok = score >= passNeed;
      const prevBest = Math.max(0, ...getSpHist().map(e => e.s));
      MINI.combo = ok ? (MINI.combo || 0) + 1 : 0;
      const histT = pushSpHist(score, q.type);
      if (score > prevBest && prevBest > 0) confetti();
      MINI.lastCtx = { q: q.type === "sap" ? "(看图描述照片)" : q.text, text, type: SP_TYPES[q.type], t: histT };
      aiSpJudge(MINI.lastCtx.q, text, q.stage).then(({ score: ai, why }) => {
        const h = getSpHist();
        const e = h.find(x => x.t === histT);
        if (e) { e.s = ai; e.ai = 1; localStorage.setItem("det_sphist", JSON.stringify(h)); }
        const num = document.querySelector(".sp-num");
        if (num && MINI.lastCtx && MINI.lastCtx.t === histT) {
          num.dataset.target = ai;
          countUp(num);
          const meta = document.querySelector(".sp-meta");
          if (meta) meta.innerHTML = `🤖 AI 终判 <b>${ai}</b> · ${ai >= 130 ? "🏆 130 水准！" : `离 130 还差 ${130 - ai}`} · ${esc(why)}`;
          const jg = document.querySelector("#sp-judging");
          if (jg) jg.remove();
        } else toast(`🤖 上一答 AI 终判：${ai}`);
      }).catch(() => {
        const jg = document.querySelector("#sp-judging");
        if (jg) jg.textContent = "AI 终判暂不可用，以速估为准";
      });
      const line = spScoreCard(score, parts, passNeed, prevBest, MINI.combo, text || "(空)");
      if (ok) {
        ladder.streak++;
        if (ladder.streak >= 3 && ladder.stage < SPEAK_STAGES.length - 1) {
          ladder.stage++; ladder.streak = 0;
          toast(`🎤 口语阶梯升级 → ${SPEAK_STAGES[ladder.stage].name}！`);
          confetti();
        }
      } else ladder.streak = 0;
      saveSpeakLadder(ladder);
      miniDone(ok, line, `sp ${score}分`, true);
    };
    btn.onclick = async () => {
      if (recorder) { stopRec(); return; } // second click = early stop
      try { stream = await getMic(); }
      catch { btn.textContent = "无法访问麦克风——请用 HTTPS 地址并授权"; return; }
      if (q.type === "is") { // real-test feel: hear the question once, then speak
        btn.disabled = true; btn.textContent = "🔊 听题中…（只读一遍）";
        await speak(q.text);
        btn.disabled = false;
      }
      recorder = startRecording(stream);
      secs = stage.time;
      btn.textContent = `🔴 录音中 ${secs}s — 再点结束`;
      timer = setInterval(() => {
        secs--;
        btn.textContent = `🔴 录音中 ${secs}s — 再点结束`;
        if (secs <= 0) stopRec();
      }, 1000);
    };
  }
}

// ───────────────────── wrong-answer book view ─────────────────────
const WRONG_COACH = `你是英语老师，学生备考 DET。下面是学生做错的题（题面 / 学生答案 / 正确答案）。对每道题输出：
**正确答案为什么对**：一句话（语法/固定搭配/上下文线索）
**学生错在哪**：一句话（如果是超时或空白，就讲该题的核心考点）
**记忆贴士**：一句话
中文讲解，英文保留英文，每题之间空行，直接务实。`;

function renderWrong() {
  const view = $("#view-wrong");
  const w = getWrong().slice().reverse();
  view.innerHTML = `
    <h2>📕 错题本</h2>
    <p class="subtitle">做错的题自动收进来（含打怪塔快速刷题），标注你的答案 vs 正确答案。共 <b>${w.length}</b> 条。
    所有练过的题都不会再出现在抽题里——想复盘只能在这里看。</p>
    <div class="card"><div id="wr-extra"></div>
      ${w.length ? "" : '<p class="muted">还没有错题——保持下去！</p>'}
    </div>
    <div class="card" id="wr-list">
      ${w.slice(0, 80).map(e => `
        <div class="log-entry" data-t="${e.t}">
          <span class="pill">${TASK_NAMES[e.task] || e.task}</span>
          <b>${esc(e.q)}</b><br>
          <span class="result-bad">❌ ${esc(e.ans)}</span> → <span class="result-good">✅ ${esc(e.correct)}</span>
          <span class="muted" style="font-size:11px">　${new Date(e.t).toLocaleString("zh-CN")}</span>
          <button class="ghost wr-del" style="padding:1px 9px;float:right" title="删除">🗑</button>
        </div>`).join("") || ""}
    </div>`;
  if (w.length) aiFeedbackButton($("#wr-extra", view), `AI 讲解最近 ${Math.min(w.length, 8)} 条错题`, () => ({
    system: WRONG_COACH,
    user: w.slice(0, 8).map((e, i) => `${i + 1}. [${TASK_NAMES[e.task] || e.task}] 题面：${e.q}\n   学生答案：${e.ans}\n   正确答案：${e.correct}`).join("\n"),
    maxTokens: 4000,
  }));
  $("#wr-list", view).onclick = ev => {
    if (!ev.target.classList.contains("wr-del")) return;
    const t = +ev.target.closest(".log-entry").dataset.t;
    localStorage.setItem("det_wrong", JSON.stringify(getWrong().filter(x => x.t !== t)));
    renderWrong();
  };
}

// ───────────────────── practice log view ─────────────────────
const TASK_NAMES = { is: "即兴问答", sap: "看图说话", rts: "读题演讲", ss: "压轴长答", lt: "听写句子", sum: "对话摘要", rs: "真假词", fb: "补全单词", ct: "补全段落", wap: "看图写作", iw: "互动写作", ws: "写作样本", vocabreview: "生词复习", mini: "快速刷题", coach: "口语特训", ct2: "补全微段", vb: "生词听写" };
function renderLog() {
  const view = $("#view-log");
  const log = getLog().slice().reverse();
  const byDay = {};
  for (const e of getLog()) { const k = dayKey(e.t); byDay[k] = (byDay[k] || 0) + 1; }
  view.innerHTML = `
    <h2>练习记录</h2>
    <p class="subtitle">共 ${log.length} 题，${Object.keys(byDay).length} 天。记录保存在本浏览器里。</p>
    <div class="card">
      ${Object.entries(byDay).sort().reverse().slice(0, 14).map(([d, n]) => `<span class="pill">${d}：${n} 题</span>`).join("")}
    </div>
    <div class="card">
      ${log.slice(0, 60).map(e => `<div class="log-entry"><b>${TASK_NAMES[e.task] || e.task}</b> ${esc(e.detail || "")} — ${new Date(e.t).toLocaleString("zh-CN")}</div>`).join("") || '<p class="muted">还没有记录，去练一题吧！</p>'}
      ${log.length ? '<button class="ghost" id="log-clear" style="margin-top:12px">清空记录</button>' : ""}
    </div>`;
  const btn = $("#log-clear", view);
  if (btn) btn.onclick = () => { if (confirm("确定清空所有练习记录？")) { localStorage.removeItem("det_log"); renderLog(); } };
}

// ───────────────────── init ─────────────────────
if (!window.isSecureContext) $("#https-banner").classList.remove("hidden");

const refreshers = { plan: renderPlan, dashboard: renderDashboard, scores: renderScores, log: renderLog, vocab: renderVocab, battle: () => { renderBattle(); renderDrill(); }, coach: renderCoach, wrong: renderWrong };

refreshers.is = setupIS();
refreshers.lt = setupLT();
refreshers.sum = setupSUM();
refreshers.rs = setupRS();
refreshers.fb = setupFB();
refreshers.ct = setupCT();

// Speak About the Photo
{
  const task = speakingTask({
    view: "sap", logName: "sap",
    title: "看图说话 Speak About the Photo",
    sub: "看图 <b>20 秒</b>准备，然后<b>说 90 秒</b>（只有一次机会）。模板：位置 → 人物/主体 → 动作 → 细节 → 推测。目标说满 60–90 秒。",
    prepSec: 20, speakSec: 90,
    extraIdleHtml: `<p class="muted" style="margin-top:10px">照片完全随机，题量无限。</p>`,
    nextItem: () => Math.random().toString(36).slice(2, 9),
    renderPrompt: (box, seed) => { box.innerHTML = `<div class="photo-frame"><img src="${photoURL(seed)}" alt="photo"></div>`; },
    renderAfter: (box, seed) => { box.innerHTML = `<div class="photo-frame"><img src="${photoURL(seed)}" alt="photo"></div>`; },
  });
  refreshers.sap = task.idle; task.idle();
}
// Read Then Speak
{
  const task = speakingTask({
    view: "rts", logName: "rts",
    title: "读题演讲 Read Then Speak",
    sub: "<b>20 秒</b>准备 + <b>90 秒</b>作答，题目全程可见。结构：观点 → 理由1+例子 → 理由2+例子 → 总结。这题和 USF 秋季 ITA 评估形式最接近，优先多练。",
    prepSec: 20, speakSec: 90, structureChallenge: true,
    genKey: "rts", baseArr: DATA.readThenSpeak,
    nextItem: () => drawFrom("rts", DATA.readThenSpeak),
    renderPrompt: (box, it) => { box.innerHTML = `<div class="prompt-box">${esc(it.prompt)}<ul>${it.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul></div>`; },
    renderAfter: (box, it) => { box.innerHTML = `<div class="prompt-box">${esc(it.prompt)}</div>`; },
    itemLabel: it => it.prompt.slice(0, 30),
    promptText: it => `${it.prompt}（要点：${it.bullets.join(" / ")}）`,
  });
  refreshers.rts = task.idle; task.idle();
}
// Speaking Sample
{
  const task = speakingTask({
    view: "ss", logName: "ss",
    title: "压轴长答 Speaking Sample",
    sub: "<b>30 秒</b>准备 + 最多 <b>3 分钟</b>作答。计分，且<b>视频会随成绩单发给 USF</b>——注意表情和语速。结构：观点 + 2–3 个论据 + 个人经历 + 总结。",
    prepSec: 30, speakSec: 180, structureChallenge: true,
    genKey: "ss", baseArr: DATA.speakingSample,
    nextItem: () => drawFrom("ss", DATA.speakingSample),
    renderPrompt: (box, it) => { box.innerHTML = `<div class="prompt-box">${esc(it)}</div>`; },
    renderAfter: (box, it) => { box.innerHTML = `<div class="prompt-box">${esc(it)}</div>`; },
    itemLabel: it => it.slice(0, 30),
    promptText: it => it,
  });
  refreshers.ss = task.idle; task.idle();
}
// Write About the Photo
refreshers.wap = writingTask({
  view: "wap", logName: "wap",
  title: "看图写作 Write About the Photo",
  sub: "考试 3 题，每题 <b>1 分钟</b>：用 1–3 个完整句子描述照片。主谓宾 + 形容词细节。",
  seconds: 60, minWords: 15,
  getPrompt: () => Math.random().toString(36).slice(2, 9),
  renderPrompt: (box, seed) => { box.innerHTML = `<div class="photo-frame"><img src="${photoURL(seed)}" alt="photo"></div>`; },
});
// Interactive Writing
refreshers.iw = writingTask({
  view: "iw", logName: "iw", twoPart: true,
  title: "互动写作 Interactive Writing",
  sub: "两段式：第一段 <b>5 分钟</b>（建议 120+ 词），提交后第二段追问 <b>3 分钟</b>。字数要堆够。",
  seconds: 300, minWords: 120, genKey: "iw", baseArr: DATA.interactiveWriting, structureChallenge: true,
  getPrompt: () => drawFrom("iw", DATA.interactiveWriting),
  renderPrompt: (box, it, partNo) => { box.innerHTML = `<div class="prompt-box">${esc(partNo === 1 ? it.main : it.follow)}</div>`; },
  promptText: it => `主题：${it.main}\n追问：${it.follow}`,
});
// Writing Sample
refreshers.ws = writingTask({
  view: "ws", logName: "ws",
  title: "写作样本 Writing Sample",
  sub: "<b>5 分钟</b>，计分且<b>文本会发给学校</b>。观点 + 论据 + 例子，写满 5 分钟（建议 100+ 词）。",
  seconds: 300, minWords: 100, genKey: "ws", baseArr: DATA.writingSample, structureChallenge: true,
  getPrompt: () => drawFrom("ws", DATA.writingSample),
  renderPrompt: (box, it) => { box.innerHTML = `<div class="prompt-box">${esc(it)}</div>`; },
  promptText: it => it,
});

// collapsible sidebar groups (folded set persists per device)
{
  const folded = new Set(JSON.parse(localStorage.getItem("navfold") || "[]"));
  document.querySelectorAll(".nav-group > .group-label").forEach(lbl => {
    const name = lbl.textContent.trim();
    if (folded.has(name)) lbl.parentElement.classList.add("folded");
    lbl.onclick = () => {
      const g = lbl.parentElement;
      g.classList.toggle("folded");
      g.classList.contains("folded") ? folded.add(name) : folded.delete(name);
      localStorage.setItem("navfold", JSON.stringify([...folded]));
    };
  });
}

// navigation
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    stopSpeak();
    document.getElementById("main").classList.toggle("split", btn.dataset.view === "battle");
    if (btn.dataset.view !== "battle") stopAutoBattle(); // 战斗只陪着边打边刷页跑
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active", "entering"));
    const id = btn.dataset.view;
    const v = $(`#view-${id}`);
    v.classList.add("active", "entering"); // entrance animation plays only on view switch
    setTimeout(() => v.classList.remove("entering"), 800);
    if (refreshers[id]) refreshers[id]();
  });
});

renderPlan();
renderDashboard();
renderGoalLine();
setTimeout(() => { if (!getGoal() && !sessionStorage.getItem("goalskip") && !location.search.includes("demo")) openGoalSetup(); }, 1400);
renderScores();
renderLog();
renderVocab();
renderBattle();
renderDrill();
renderCoach();
// deep link: https://host/#battle 直接打开对应页
if (location.hash) {
  const target = document.querySelector(`.nav-item[data-view="${location.hash.slice(1)}"]`);
  if (target) setTimeout(() => target.click(), 300);
}
renderWrong();
initSync();
