/* CSGym: קוד משותף לכל המודולים (עותק מותאם של core.js מ-CircuitGym).
 * - Core.makeRng / randomSeed: מחולל אקראי עם seed (mulberry32).
 * - Core.levelChoices: בחירת רמה בסוף תרגיל.
 * - Core.codeHtml: תצוגת קוד C# עם הדגשת תחביר ומספרי שורות. חורים @1, @2 ... מוחלפים ב-HTML.
 * - Core.mountUI: מסך התרגיל, כולל שאלות עם כמה סעיפים וסוגי תשובות:
 *   text (תיבת קלט עם פעולת בדיקה של המודול), choice (בחירה מרשימה).
 * המודולים טוענים את הקובץ לפני המנוע שלהם: <script src="../common/core.js"></script>
 */
(function (global) {
  'use strict';

  // ---------------- Rng ----------------
  function makeRng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    const pick = arr => arr[Math.floor(next() * arr.length)];
    const shuffle = arr => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = int(0, i); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    return { next, int, pick, shuffle };
  }
  const randomSeed = () => (Math.random() * 4294967296) >>> 0;

  // ---------------- Levels ----------------
  // בסוף תרגיל התלמיד בוחר רמה. primary = ההמלצה.
  // נכון: לעלות / להישאר (בניסיון האחרון ההמלצה היא להישאר). כישלון: להישאר / לרדת.
  function levelChoices(level, correct, attempt, min, maxLevel, maxAttempts) {
    const out = [];
    if (correct) {
      const up = level < maxLevel;
      if (up) out.push({ level: level + 1, primary: attempt < maxAttempts });
      out.push({ level, primary: !up || attempt >= maxAttempts });
    } else {
      out.push({ level, primary: true });
      if (level > min) out.push({ level: level - 1, primary: false });
    }
    return out;
  }

  // ---------------- Code view ----------------
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const KW = new Set(['public', 'private', 'static', 'class', 'if', 'else', 'while', 'for', 'return', 'new', 'true', 'false', 'null']);
  const TY = new Set(['int', 'bool', 'char', 'string', 'void', 'double']);
  const TOK = /(\/\/.*)|("(?:[^"\\\n]|\\.)*")|('(?:[^'\\\n]|\\.)*')|(@\d+)|(\b\d+\b)|(\b[A-Za-z_]\w*\b)(\s*\()?|([\s\S])/g;
  // opts.blank(n) -> HTML לחור מספר n
  function codeHtml(src, opts = {}) {
    const line = l => l.replace(TOK, (m, cm, st, chr, bl, nu, id, call) => {
      if (cm) return `<span class="cm">${esc(cm)}</span>`;
      if (st || chr) return `<span class="st">${esc(m)}</span>`;
      if (bl) return opts.blank ? opts.blank(+bl.slice(1)) : esc(bl);
      if (nu) return `<span class="nu">${nu}</span>`;
      if (id) {
        const paren = call ? esc(call) : '';
        if (KW.has(id)) return `<span class="kw">${id}</span>${paren}`;
        if (TY.has(id)) return `<span class="ty">${id}</span>${paren}`;
        if (call) return `<span class="fn">${id}</span>${paren}`;
        return id;
      }
      return esc(m);
    });
    const rows = src.replace(/\s+$/, '').split('\n').map(l => `<span class="cl">${line(l) || ' '}</span>`).join('');
    return `<pre class="code${opts.cls ? ' ' + opts.cls : ''}" dir="ltr"><code>${rows}</code></pre>`;
  }
  // קוד קצר בתוך משפט עברי
  const inlineCode = s => `<code dir="ltr">${esc(s)}</code>`;

  // ---------------- UI ----------------
  const PLAY_HTML = `
    <div class="bar">
      <span id="lvl" class="badge"></span>
      <span id="ctype" class="muted"></span>
      <span id="tries" class="muted"></span>
    </div>
    <p id="qtext" class="q"></p>
    <div id="figure" class="figure"></div>
    <ol id="doneParts" class="parts" hidden></ol>
    <p id="ptext" class="q ptext" hidden></p>
    <form id="ansForm" class="ans" autocomplete="off">
      <div id="ansRows" class="ansrows"></div>
      <button type="submit" id="checkBtn" class="primary">בדיקה</button>
    </form>
    <div id="feedback" class="fb" role="status" aria-live="polite"></div>
    <button id="showSol" type="button" class="link" hidden>הצג פתרון מלא</button>
    <div id="solution" hidden><h3 id="solTitle"></h3><div id="solBody"></div></div>
    <div class="actions">
      <span id="choices" class="actions" hidden></span>
      <button id="nextPart" type="button" class="primary" hidden>לסעיף הבא</button>
      <button id="next" type="button">תרגיל חדש</button>
      <button id="back" type="button">חזרה להגדרות</button>
    </div>
    <div id="seed" class="seed" dir="ltr"></div>`;
  const PART_LETTERS = 'אבגדהוזחטי';

  /* cfg:
   *  engine: { VERSION, MAX_LEVEL, MAX_ATTEMPTS }
   *  readSettings(): הגדרות מהמסך (חייב לכלול level)
   *  minLevel(settings)
   *  makeExercise(settings, level, prevKind) -> ex (חייב: kind, seed, level; אופציונלי: html = הקדמה ב-HTML)
   *  ctypeHtml(ex) -> HTML לתווית ליד הרמה (אופציונלי)
   *  render(ex) -> { html }
   *  parts(ex) -> [{ html?, answers: [answer] }]  (בסעיף יחיד ה-html מוצג בלי אות)
   *     answer text:   { type:'text', label, shown (HTML של התשובה הנכונה), width?, check(raw, attempt) }
   *                    check מחזירה { invalid: msg } (לא נספר) או { ok, hint? }
   *     answer choice: { type:'choice', label, short?, options:[{value,label}], value }
 *     answer code:   { type:'code', label, shown, check(values, attempt) }
 *                    החורים הם <input class="blank" data-b="1"> בתוך מה ש-render מחזיר; values לפי הסדר של data-b
   *  solution: { title, html(ex, partIndex), onCorrect: true/false }
   *  failSuffix: טקסט אחרי התשובה הנכונה כשמוצג פתרון
   */
  function mountUI(cfg) {
    const E = cfg.engine, $ = id => document.getElementById(id);
    $('ver').textContent = E.VERSION;
    $('ver2').textContent = E.VERSION;
    $('play').innerHTML = PLAY_HTML;
    // Enter בחור בקוד = בדיקה
    $('figure').addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.matches('input.blank')) { ev.preventDefault(); $('ansForm').requestSubmit(); }
    });
    const blankInputs = () => [...document.querySelectorAll('#figure input.blank')].sort((a, b) => a.dataset.b - b.dataset.b);
    const st ={ settings: null, level: 1, ex: null, parts: null, pi: 0, failed: 0, finished: false, prevKind: null, results: [] };
    const multi = () => st.parts.length > 1;

    $('start').addEventListener('click', () => {
      st.settings = cfg.readSettings();
      if (!st.settings) return;
      st.level = st.settings.level;
      st.prevKind = null;
      $('setup').hidden = true;
      $('play').hidden = false;
      newExercise();
    });
    $('back').addEventListener('click', () => {
      $('play').hidden = true;
      $('setup').hidden = false;
      window.scrollTo(0, 0);
    });

    function newExercise() {
      st.ex = cfg.makeExercise(st.settings, st.level, st.prevKind);
      st.prevKind = st.ex.kind;
      st.parts = cfg.parts(st.ex);
      st.pi = 0; st.failed = 0; st.finished = false; st.results = [];
      renderExercise();
    }
    function renderExercise() {
      const ex = st.ex;
      $('lvl').textContent = `רמה ${ex.level}`;
      $('ctype').innerHTML = cfg.ctypeHtml ? cfg.ctypeHtml(ex) : '';
      $('qtext').innerHTML = ex.html || '';
      $('qtext').hidden = !ex.html;
      $('figure').innerHTML = cfg.render(ex).html;
      $('doneParts').innerHTML = '';
      $('doneParts').hidden = true;
      $('seed').textContent = '#' + ex.seed;
      $('next').hidden = false;
      $('choices').hidden = true;
      renderPart();
    }
    const ansValueText = a => (a.type === 'choice' ? esc(a.options.find(o => o.value === a.value).label) : a.shown);
    const partAnswerText = part => part.answers.map(ansValueText).join(', ');
    function renderPart() {
      const part = st.parts[st.pi];
      const letter = multi() ? `<b>${PART_LETTERS[st.pi]}.</b> ` : '';
      $('ptext').hidden = !multi() && !part.html;
      $('ptext').innerHTML = letter + (part.html || '');
      $('ansRows').innerHTML = part.answers.map((a, i) => {
        if (a.type === 'code') return `<span class="muted">${esc(a.label)}</span>`;
        if (a.type === 'choice')
          return `<label class="ansbox dirbox">${esc(a.label)}: <select data-i="${i}" class="ch"><option value="">בחרו</option>${a.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>`;
        return `<label class="ansbox">${esc(a.label)}:
          <input data-i="${i}" class="val" type="text" dir="ltr" spellcheck="false" autocapitalize="off" style="width:${a.width || 10}em"></label>`;
      }).join('');
      $('checkBtn').disabled = false;
      setFeedback('', '');
      $('solution').hidden = true;
      $('showSol').hidden = true;
      $('showSol').textContent = 'הצג פתרון מלא';
      $('solTitle').textContent = cfg.solution ? cfg.solution.title : '';
      $('solBody').innerHTML = cfg.solution ? cfg.solution.html(st.ex, st.pi) : '';
      $('nextPart').hidden = true;
      $('next').hidden = false;
      updateTries();
    }
    function updateTries() {
      $('tries').textContent = st.finished || $('ansRows').querySelector('[disabled]') ? '' : `ניסיון ${st.failed + 1} מתוך ${E.MAX_ATTEMPTS}`;
    }
    function setFeedback(cls, html) { $('feedback').className = 'fb ' + cls; $('feedback').innerHTML = html; }
    function lockPart() {
      document.querySelectorAll('#ansRows input, #ansRows select, #figure input.blank').forEach(el => (el.disabled = true));
      $('checkBtn').disabled = true;
    }
    // סעיף הסתיים (נכון או אחרי 3 ניסיונות)
    function partDone(correct, attempt) {
      st.results.push({ correct, attempt });
      lockPart();
      if (st.pi < st.parts.length - 1) {
        $('nextPart').hidden = false;
        $('next').hidden = true;
        updateTries();
        return;
      }
      finish();
    }
    function finish() {
      st.finished = true;
      const correct = st.results.every(r => r.correct), attempt = Math.max(...st.results.map(r => r.attempt));
      const opts = levelChoices(st.level, correct, attempt, cfg.minLevel(st.settings), E.MAX_LEVEL, E.MAX_ATTEMPTS);
      const label = n => (opts.length === 1 ? 'לתרגיל הבא'
        : n > st.level ? `לעלות לרמה ${n}` : n < st.level ? `לרדת לרמה ${n}` : `להישאר ברמה ${n}`);
      $('choices').innerHTML = opts.map(o =>
        `<button type="button" data-level="${o.level}"${o.primary ? ' class="primary"' : ''}>${label(o.level)}</button>`).join('');
      $('choices').hidden = false;
      $('next').hidden = true;
      $('nextPart').hidden = true;
      updateTries();
    }
    $('nextPart').addEventListener('click', () => {
      // הסעיף שהסתיים עובר לרשימת הסעיפים שנענו
      const part = st.parts[st.pi], r = st.results[st.pi];
      const li = document.createElement('li');
      li.innerHTML = `${part.html || ''} <span class="${r.correct ? 'ok' : 'bad'}">${r.correct ? '✓' : '✗'}</span> ${partAnswerText(part)}`;
      $('doneParts').appendChild(li);
      $('doneParts').hidden = false;
      st.pi++; st.failed = 0;
      renderPart();
    });
    $('choices').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-level]');
      if (!b) return;
      st.level = +b.dataset.level;
      newExercise();
    });
    $('next').addEventListener('click', newExercise);
    $('showSol').addEventListener('click', () => {
      $('solution').hidden = !$('solution').hidden;
      $('showSol').textContent = $('solution').hidden ? 'הצג פתרון מלא' : 'הסתר פתרון';
    });

    $('ansForm').addEventListener('submit', ev => {
      ev.preventDefault();
      if (st.finished || $('checkBtn').disabled) return;
      const part = st.parts[st.pi], A = part.answers, attempt = st.failed + 1;
      const res = A.map((a, i) => {
        if (a.type === 'choice') {
          const v = document.querySelector(`#ansRows select.ch[data-i="${i}"]`).value;
          return v ? { ok: v === a.value } : { invalid: 'נא לבחור מהרשימה.' };
        }
        if (a.type === 'code') return a.check(blankInputs().map(x => x.value), attempt);
        return a.check(document.querySelector(`#ansRows input[data-i="${i}"]`).value, attempt);
      });
      const bad = res.find(r => r.invalid);
      if (bad) { setFeedback('warn', `${bad.invalid} הניסיון לא נספר.`); return; }
      const last = st.pi === st.parts.length - 1;
      const answerText = partAnswerText(part);
      if (res.every(r => r.ok)) {
        // בהשלמת קוד התלמיד יכול לכתוב ביטוי אחר מהפתרון לדוגמה, ולכן לא מציגים אותו כאן
        let msg = part.answers.every(a => a.type === 'code') ? 'נכון! ' : `נכון! ${answerText}. `;
        if (last) {
          // ההמלצה לפי כל הסעיפים: כולם נכונים, ובאיזה ניסיון לכל היותר
          const all = st.results.every(r => r.correct), maxAttempt = Math.max(attempt, ...st.results.map(r => r.attempt));
          if (multi()) {
            const n = st.results.filter(r => r.correct).length + 1;
            msg += `סיימתם את התרגיל: ${n} מתוך ${st.parts.length} סעיפים נכונים. `;
          }
          if (!all) msg += 'מומלץ להישאר באותה רמה ולתרגל עוד.';
          else if (st.level >= E.MAX_LEVEL) msg += 'זו הרמה הגבוהה ביותר.';
          else if (maxAttempt >= E.MAX_ATTEMPTS) msg += 'הצלחתם בניסיון השלישי. אפשר לעלות רמה, או להישאר ולתרגל עוד.';
          else msg += 'אפשר לעלות רמה או להישאר באותה רמה.';
        }
        setFeedback('ok', msg.trim());
        if (cfg.solution && cfg.solution.onCorrect) $('showSol').hidden = false;
        partDone(true, attempt);
        return;
      }
      st.failed++;
      let detail = '';
      if (A.length > 1) detail = ' ' + A.map((a, i) => `${esc(a.short || a.label)} ${res[i].ok ? 'נכון' : 'לא נכון'}`).join(', ') + '.';
      const hints = res.filter(r => !r.ok && r.hint).map(r => ' ' + r.hint).join('');
      if (st.failed < E.MAX_ATTEMPTS) {
        const left = E.MAX_ATTEMPTS - st.failed;
        setFeedback('bad', (left === 1 ? 'לא נכון. נשאר ניסיון אחד.' : `לא נכון. נשארו ${left} ניסיונות.`) + detail + hints);
        updateTries();
      } else {
        const suffix = cfg.failSuffix ? ' ' + cfg.failSuffix : '';
        let msg = `לא נכון.${detail} התשובה הנכונה: ${answerText}.${suffix}`;
        if (last && multi()) {
          const n = st.results.filter(r => r.correct).length;
          msg += ` סיימתם את התרגיל: ${n} מתוך ${st.parts.length} סעיפים נכונים.`;
        }
        setFeedback('bad', msg);
        if (cfg.solution) $('solution').hidden = false;
        partDone(false, attempt);
      }
    });
    return st;
  }

  global.Core = { makeRng, randomSeed, levelChoices, esc, codeHtml, inlineCode, mountUI };
})(typeof window !== 'undefined' ? window : globalThis);
