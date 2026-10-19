/* CSGym: מפרש לחלק של C# (ראו ROADMAP.md).
 * - CS.parseProgram(src): ניתוח פעולות static. חורים בקוד תבנית: @1, @2, ...
 * - CS.parseExpr(src): ניתוח ביטוי בודד (מה שהתלמיד מקליד בחור).
 * - CS.check(prog, blanks): בדיקות לפני ריצה (שמות, ארגומנטים, return). blanks: { 1: ast, 2: ast }
 * - CS.run(prog, name, args, { blanks, trace, maxDepth, maxSteps }) -> { value, out, calls, depth, tree }
 *   tree (עם trace): { name, args (כ-literal), ret, depth, children: [קריאות], events: [{ call } | { print }] }
 * - ערכים: int = number, bool = boolean, string = string, char = CS.Char, מערך = Array עם elem.
 * שגיאות: CS.CSError עם kind: syntax | compile | runtime | stack | steps, והודעה בעברית לתלמיד.
 */
(function (global) {
  'use strict';

  class CSError extends Error {
    constructor(kind, msg, line) { super(msg); this.kind = kind; this.line = line; }
  }
  class Char { constructor(c) { this.c = c; } }
  const ch = s => new Char(typeof s === 'string' ? s.charCodeAt(0) : s);
  const arr = (elem, items) => { const a = items.slice(); a.elem = elem; return a; };

  // ---------------- Tokenizer ----------------
  const KEYWORDS = new Set(['public', 'private', 'static', 'class', 'int', 'bool', 'char', 'string', 'void',
    'if', 'else', 'while', 'for', 'return', 'true', 'false', 'new', 'null']);
  const TYPES = new Set(['int', 'bool', 'char', 'string', 'void']);
  const OPS = ['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=',
    '+', '-', '*', '/', '%', '<', '>', '!', '=', '?', ':', '(', ')', '{', '}', '[', ']', ',', ';', '.'];
  const ESC = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"', '0': '\0' };

  function tokenize(src) {
    const toks = [];
    let i = 0, line = 1;
    const err = m => { throw new CSError('syntax', m, line); };
    const readEsc = () => {
      const e = src[i + 1];
      if (!(e in ESC)) err(`תו בריחה לא מוכר: \\${e || ''}`);
      i += 2;
      return ESC[e];
    };
    while (i < src.length) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (src.startsWith('/*', i)) {
        const j = src.indexOf('*/', i + 2);
        if (j < 0) err('הערה שלא נסגרה (חסר */)');
        for (let k = i; k < j; k++) if (src[k] === '\n') line++;
        i = j + 2;
        continue;
      }
      const start = i;
      if (/[0-9]/.test(c)) {
        while (/[0-9]/.test(src[i] || '')) i++;
        if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) err('מספרים עשרוניים לא נתמכים');
        if (/[A-Za-z_]/.test(src[i] || '')) err(`מספר לא תקין: ${src.slice(start, i + 1)}`);
        toks.push({ t: 'num', v: Number(src.slice(start, i)), line });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        while (/[A-Za-z0-9_]/.test(src[i] || '')) i++;
        const w = src.slice(start, i);
        toks.push({ t: KEYWORDS.has(w) ? 'kw' : 'id', v: w, line });
        continue;
      }
      if (c === '@' && /[0-9]/.test(src[i + 1] || '')) {
        i++;
        while (/[0-9]/.test(src[i] || '')) i++;
        toks.push({ t: 'blank', v: Number(src.slice(start + 1, i)), line });
        continue;
      }
      if (c === "'") {
        i++;
        let v;
        if (src[i] === '\\') v = readEsc();
        else if (src[i] === "'" || src[i] === '\n' || i >= src.length) err("תו ריק או לא סגור ('')");
        else v = src[i++];
        if (src[i] !== "'") err("תו (char) צריך להיות תו אחד בין גרשיים בודדים, למשל 'a'");
        i++;
        toks.push({ t: 'char', v: v.charCodeAt(0), line });
        continue;
      }
      if (c === '"') {
        i++;
        let v = '';
        while (src[i] !== '"') {
          if (i >= src.length || src[i] === '\n') err('מחרוזת שלא נסגרה (חסר ")');
          if (src[i] === '\\') v += readEsc(); else v += src[i++];
        }
        i++;
        toks.push({ t: 'str', v, line });
        continue;
      }
      const op = OPS.find(o => src.startsWith(o, i));
      if (!op) err(`תו לא צפוי: ${c}`);
      i += op.length;
      toks.push({ t: 'op', v: op, line });
    }
    toks.push({ t: 'eof', v: '', line });
    return toks;
  }

  // ---------------- Parser ----------------
  const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);
  const tokText = t => (t.t === 'eof' ? 'סוף הקוד' : t.t === 'str' ? `"${t.v}"` : t.t === 'char' ? `'${String.fromCharCode(t.v)}'` : t.t === 'blank' ? '@' + t.v : String(t.v));

  function makeParser(toks) {
    let p = 0;
    const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
    const next = () => toks[p++];
    const isOp = (v, k = 0) => peek(k).t === 'op' && peek(k).v === v;
    const isKw = (v, k = 0) => peek(k).t === 'kw' && peek(k).v === v;
    const acceptOp = v => (isOp(v) ? (next(), true) : false);
    const acceptKw = v => (isKw(v) ? (next(), true) : false);
    const err = (m, t = peek()) => { throw new CSError('syntax', m, t.line); };
    const expectOp = v => { if (!acceptOp(v)) err(`חסר ${v} (לפני ${tokText(peek())})`); };
    const ident = what => {
      const t = peek();
      if (t.t !== 'id') err(t.t === 'kw' ? `${t.v} היא מילה שמורה ולא יכולה לשמש כ${what}` : `חסר ${what} (לפני ${tokText(t)})`);
      return next().v;
    };
    const isTypeStart = () => peek().t === 'kw' && TYPES.has(peek().v);
    function type() {
      if (!isTypeStart()) err(`חסר טיפוס (לפני ${tokText(peek())})`);
      let t = next().v;
      if (isOp('[') && isOp(']', 1)) { next(); next(); t += '[]'; }
      return t;
    }

    function program() {
      const funcs = {}, order = [];
      const add = f => {
        if (funcs[f.name]) throw new CSError('compile', `הפעולה ${f.name} מוגדרת פעמיים`, f.line);
        funcs[f.name] = f; order.push(f.name);
      };
      while (peek().t !== 'eof') {
        while (isKw('public') || isKw('private') || isKw('static')) next();
        if (acceptKw('class')) {
          ident('שם מחלקה');
          expectOp('{');
          while (!isOp('}')) {
            if (peek().t === 'eof') err('חסר } בסוף המחלקה');
            add(method());
          }
          next();
        } else add(method());
      }
      return { funcs, order };
    }
    function method() {
      while (isKw('public') || isKw('private') || isKw('static')) next();
      const line = peek().line, ret = type(), name = ident('שם פעולה');
      expectOp('(');
      const params = [];
      if (!isOp(')')) do { const t = type(); params.push({ type: t, name: ident('שם פרמטר') }); } while (acceptOp(','));
      expectOp(')');
      if (!isOp('{')) err('חסר { בתחילת גוף הפעולה');
      return { name, ret, params, body: stmt(), line };
    }

    function stmt() {
      const line = peek().line;
      if (acceptOp('{')) {
        const body = [];
        while (!isOp('}')) {
          if (peek().t === 'eof') err('חסר } בסוף בלוק');
          body.push(stmt());
        }
        next();
        return { k: 'block', body, line };
      }
      if (acceptOp(';')) return { k: 'block', body: [], line };
      if (acceptKw('if')) {
        expectOp('(');
        const cond = expr();
        expectOp(')');
        const then = stmt();
        const els = acceptKw('else') ? stmt() : null;
        return { k: 'if', cond, then, els, line };
      }
      if (acceptKw('while')) {
        expectOp('(');
        const cond = expr();
        expectOp(')');
        return { k: 'while', cond, body: stmt(), line };
      }
      if (acceptKw('for')) {
        expectOp('(');
        let init = null;
        if (isTypeStart()) init = decl();
        else if (!isOp(';')) init = { k: 'expr', e: exprStmt(), line };
        expectOp(';');
        const cond = isOp(';') ? null : expr();
        expectOp(';');
        const update = [];
        if (!isOp(')')) do update.push(exprStmt()); while (acceptOp(','));
        expectOp(')');
        return { k: 'for', init, cond, update, body: stmt(), line };
      }
      if (acceptKw('return')) {
        const e = isOp(';') ? null : expr();
        expectOp(';');
        return { k: 'return', e, line };
      }
      if (isKw('else')) err('else בלי if לפניו');
      if (isTypeStart()) { const d = decl(); expectOp(';'); return d; }
      const e = exprStmt();
      expectOp(';');
      return { k: 'expr', e, line };
    }
    function decl() {
      const line = peek().line, t = type(), vars = [];
      if (t === 'void') err('אי אפשר להגדיר משתנה מטיפוס void');
      do {
        const name = ident('שם משתנה');
        let init = null;
        if (acceptOp('=')) init = isOp('{') ? arrayLit(t) : expr();
        vars.push({ name, init });
      } while (acceptOp(','));
      return { k: 'decl', type: t, vars, line };
    }
    function arrayLit(t) {
      const line = peek().line;
      if (!t.endsWith('[]')) err('אתחול עם { } מתאים רק למערך');
      expectOp('{');
      const items = [];
      if (!isOp('}')) do items.push(expr()); while (acceptOp(','));
      expectOp('}');
      return { k: 'arrlit', elem: t.slice(0, -2), items, line };
    }
    // משפט ביטוי: רק השמה, קריאה או ++/-- (כמו ב-C#)
    function exprStmt() {
      const t = peek(), e = expr();
      if (!['assign', 'call', 'incdec'].includes(e.k)) err('משפט צריך להיות השמה, קריאה לפעולה או ++/--', t);
      return e;
    }

    function expr() { return assign(); }
    function assign() {
      const left = ternary();
      if (peek().t === 'op' && ASSIGN_OPS.has(peek().v)) {
        const t = next();
        if (left.k !== 'id' && left.k !== 'index') err('אפשר להציב רק במשתנה או בתא של מערך', t);
        return { k: 'assign', op: t.v, target: left, e: assign(), line: t.line };
      }
      return left;
    }
    function ternary() {
      const c = binary(0);
      if (!isOp('?')) return c;
      const line = next().line, a = assign();
      expectOp(':');
      return { k: 'cond', c, a, b: assign(), line };
    }
    const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
    function binary(lv) {
      if (lv === LEVELS.length) return unary();
      let l = binary(lv + 1);
      while (peek().t === 'op' && LEVELS[lv].includes(peek().v)) {
        const t = next();
        l = { k: 'bin', op: t.v, l, r: binary(lv + 1), line: t.line };
      }
      return l;
    }
    function unary() {
      const t = peek();
      if (acceptOp('-')) return { k: 'un', op: '-', e: unary(), line: t.line };
      if (acceptOp('+')) return { k: 'un', op: '+', e: unary(), line: t.line };
      if (acceptOp('!')) return { k: 'un', op: '!', e: unary(), line: t.line };
      if (isOp('++') || isOp('--')) {
        next();
        const e = unary();
        if (e.k !== 'id' && e.k !== 'index') err(`${t.v} מתאים רק למשתנה או לתא של מערך`, t);
        return { k: 'incdec', op: t.v, pre: true, target: e, line: t.line };
      }
      // המרה: (int) או (char)
      if (isOp('(') && peek(1).t === 'kw' && ['int', 'char'].includes(peek(1).v) && isOp(')', 2)) {
        next();
        const to = next().v;
        next();
        return { k: 'cast', to, e: unary(), line: t.line };
      }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        const t = peek();
        if (acceptOp('(')) {
          const args = [];
          if (!isOp(')')) do args.push(expr()); while (acceptOp(','));
          expectOp(')');
          e = { k: 'call', callee: e, args, line: t.line };
        } else if (acceptOp('[')) {
          const i = expr();
          expectOp(']');
          e = { k: 'index', obj: e, i, line: t.line };
        } else if (acceptOp('.')) {
          e = { k: 'member', obj: e, name: ident('שם אחרי הנקודה'), line: t.line };
        } else if (isOp('++') || isOp('--')) {
          if (e.k !== 'id' && e.k !== 'index') break;
          next();
          e = { k: 'incdec', op: t.v, pre: false, target: e, line: t.line };
        } else break;
      }
      return e;
    }
    function primary() {
      const t = next(), line = t.line;
      switch (t.t) {
        case 'num':
          if (t.v > 2147483647) err('המספר גדול מדי ל-int', t);
          return { k: 'lit', v: t.v, line };
        case 'str': return { k: 'lit', v: t.v, line };
        case 'char': return { k: 'lit', v: new Char(t.v), line };
        case 'blank': return { k: 'blank', id: t.v, line };
        case 'id': return { k: 'id', name: t.v, line };
        case 'kw':
          if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true', line };
          if (t.v === 'null') return { k: 'lit', v: null, line };
          if (t.v === 'new') {
            const tt = peek();
            if (!(tt.t === 'kw' && TYPES.has(tt.v) && tt.v !== 'void')) err('אחרי new צריך טיפוס של מערך, למשל new int[5]');
            const elem = next().v;
            expectOp('[');
            if (acceptOp(']')) return arrayLit(elem + '[]');
            const size = expr();
            expectOp(']');
            return { k: 'newarr', elem, size, line };
          }
          if (t.v === 'char' && isOp('.')) return { k: 'id', name: 'char', line };
          return err(`${t.v} לא יכול להופיע כאן`, t);
        case 'op':
          if (t.v === '(') { const e = expr(); expectOp(')'); return e; }
          return err(`לא צפוי ${t.v}`, t);
        default:
          return err(`הקוד נגמר באמצע ביטוי`, t);
      }
    }
    return { program, expr, peek };
  }

  function parseProgram(src) {
    const P = makeParser(tokenize(src));
    const prog = P.program();
    prog.src = src;
    check(prog);
    return prog;
  }
  function parseExpr(src) {
    if (!String(src).trim()) throw new CSError('syntax', 'החור ריק', 1);
    const P = makeParser(tokenize(src));
    const e = P.expr();
    const t = P.peek();
    if (t.t !== 'eof') throw new CSError('syntax', t.t === 'op' && t.v === ';'
      ? 'בחור כותבים ביטוי בלבד, בלי ;' : `הביטוי לא שלם או שיש בו משהו מיותר (ליד ${tokText(t)})`, t.line);
    return e;
  }

  // ---------------- Static check ----------------
  const STATIC = {
    Console: { Write: [1, 1], WriteLine: [0, 1] },
    Math: { Max: [2, 2], Min: [2, 2], Abs: [1, 1] },
    char: { IsDigit: [1, 1], IsLetter: [1, 1], IsUpper: [1, 1], IsLower: [1, 1] },
  };
  const METHODS = { Substring: [1, 2], IndexOf: [1, 1], ToUpper: [0, 0], ToLower: [0, 0], ToString: [0, 0], Equals: [1, 1], Contains: [1, 1] };

  // ביצוע נגמר תמיד ב-return?
  function returns(s) {
    if (!s) return false;
    if (s.k === 'return') return true;
    if (s.k === 'block') return s.body.some(returns);
    if (s.k === 'if') return !!s.els && returns(s.then) && returns(s.els);
    if (s.k === 'while') return s.cond.k === 'lit' && s.cond.v === true;
    return false;
  }

  // blanks: { id: ast } או לא כלום (תבנית בלי חורים ממולאים)
  function check(prog, blanks) {
    const cerr = (m, line) => { throw new CSError('compile', m, line); };
    for (const name of prog.order) {
      const f = prog.funcs[name], scopes = [new Set()];
      for (const p of f.params) {
        if (scopes[0].has(p.name)) cerr(`הפרמטר ${p.name} מופיע פעמיים`, f.line);
        scopes[0].add(p.name);
      }
      const has = n => scopes.some(s => s.has(n));
      const declare = (n, line) => {
        if (has(n)) cerr(`המשתנה ${n} כבר מוגדר`, line);
        scopes[scopes.length - 1].add(n);
      };
      const ex = e => {
        if (!e) return;
        switch (e.k) {
          case 'lit': return;
          case 'id':
            if (has(e.name)) return;
            if (prog.funcs[e.name]) cerr(`${e.name} היא פעולה. כדי לקרוא לה צריך סוגריים: ${e.name}(...)`, e.line);
            return cerr(`השם ${e.name} לא מוגדר`, e.line);
          case 'blank':
            if (!blanks) return;
            if (!blanks[e.id]) throw new Error('missing blank ' + e.id);
            try { ex(blanks[e.id]); } catch (err) { if (err instanceof CSError) err.blank = e.id; throw err; }
            return;
          case 'un': case 'cast': return ex(e.e);
          case 'bin': ex(e.l); return ex(e.r);
          case 'cond': ex(e.c); ex(e.a); return ex(e.b);
          case 'assign': ex(e.target); return ex(e.e);
          case 'incdec': return ex(e.target);
          case 'index': ex(e.obj); return ex(e.i);
          case 'newarr': return ex(e.size);
          case 'arrlit': return e.items.forEach(ex);
          case 'member':
            if (e.obj.k === 'id' && STATIC[e.obj.name] && !has(e.obj.name)) cerr(`${e.obj.name}.${e.name} צריך סוגריים`, e.line);
            ex(e.obj);
            if (e.name !== 'Length') cerr(METHODS[e.name] ? `${e.name} צריך סוגריים: .${e.name}(...)` : `לא מכיר את .${e.name}`, e.line);
            return;
          case 'call': {
            const c = e.callee;
            e.args.forEach(ex);
            const count = ([lo, hi], what) => {
              if (e.args.length < lo || e.args.length > hi)
                cerr(`${what} מקבלת ${lo === hi ? lo : `${lo} עד ${hi}`} ארגומנטים, והתקבלו ${e.args.length}`, e.line);
            };
            if (c.k === 'id') {
              const g = prog.funcs[c.name];
              if (!g) return cerr(has(c.name) ? `${c.name} הוא משתנה ולא פעולה` : `הפעולה ${c.name} לא קיימת`, e.line);
              return count([g.params.length, g.params.length], `הפעולה ${c.name}`);
            }
            if (c.k === 'member') {
              if (c.obj.k === 'id' && STATIC[c.obj.name] && !has(c.obj.name)) {
                const m = STATIC[c.obj.name][c.name];
                if (!m) cerr(`לא מכיר את ${c.obj.name}.${c.name}`, e.line);
                return count(m, `${c.obj.name}.${c.name}`);
              }
              ex(c.obj);
              if (!METHODS[c.name]) cerr(c.name === 'Length' ? 'Length בלי סוגריים: .Length' : `לא מכיר את .${c.name}(...)`, e.line);
              return count(METHODS[c.name], c.name);
            }
            return cerr('אפשר לקרוא רק לפעולה בשם', e.line);
          }
          default: throw new Error('unknown node ' + e.k);
        }
      };
      const st = s => {
        switch (s.k) {
          case 'block': scopes.push(new Set()); s.body.forEach(st); scopes.pop(); return;
          case 'decl': for (const v of s.vars) { ex(v.init); declare(v.name, s.line); } return;
          case 'if': ex(s.cond); scoped(s.then); return s.els && scoped(s.els);
          case 'while': ex(s.cond); return scoped(s.body);
          case 'for':
            scopes.push(new Set());
            if (s.init) st(s.init);
            ex(s.cond); s.update.forEach(ex); scoped(s.body);
            scopes.pop();
            return;
          case 'return':
            if (f.ret === 'void' && s.e) cerr(`הפעולה ${f.name} היא void ולא מחזירה ערך`, s.line);
            if (f.ret !== 'void' && !s.e) cerr(`הפעולה ${f.name} צריכה להחזיר ערך מטיפוס ${f.ret}`, s.line);
            return ex(s.e);
          case 'expr': return ex(s.e);
          default: throw new Error('unknown stmt ' + s.k);
        }
      };
      // משפט יחיד אחרי if/while מקבל טווח משלו
      const scoped = s => { scopes.push(new Set()); st(s); scopes.pop(); };
      st(f.body);
      if (f.ret !== 'void' && !returns(f.body)) cerr(`לא בכל המסלולים בפעולה ${f.name} יש return`, f.line);
    }
  }

  // ---------------- Values ----------------
  const ARR_NAMES = { int: 'System.Int32[]', bool: 'System.Boolean[]', char: 'System.Char[]', string: 'System.String[]' };
  function typeOf(v) {
    if (v === undefined) return 'void';
    if (v === null) return 'null';
    if (typeof v === 'number') return 'int';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'string') return 'string';
    if (v instanceof Char) return 'char';
    if (Array.isArray(v)) return v.elem + '[]';
    return '?';
  }
  // ההדפסה של C# (ToString)
  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (v instanceof Char) return String.fromCharCode(v.c);
    if (Array.isArray(v)) return ARR_NAMES[v.elem];
    return String(v);
  }
  // כתיב של ערך כמו בקוד C#: "abc", 'a', true, {1, 2}
  const UNESC = { '\n': '\\n', '\t': '\\t', '\\': '\\\\', '\0': '\\0' };
  function literal(v) {
    if (v === null) return 'null';
    if (typeof v === 'string') return '"' + v.replace(/[\n\t\\\0"]/g, c => UNESC[c] || '\\"') + '"';
    if (v instanceof Char) { const s = String.fromCharCode(v.c); return "'" + (UNESC[s] || (s === "'" ? "\\'" : s)) + "'"; }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return '{' + v.map(literal).join(', ') + '}';
    return String(v);
  }
  const DEFAULTS = { int: 0, bool: false, char: new Char(0), string: null };

  // ---------------- Runtime ----------------
  const stackMsg = n => `הרקורסיה לא נעצרת: יותר מ-${n} קריאות מקוננות (StackOverflow). בדקו את תנאי העצירה ואת הצעד הרקורסיבי.`;
  function run(prog, name, args, opts = {}) {
    const blanks = opts.blanks || {};
    const MAX_DEPTH = opts.maxDepth || 500, MAX_STEPS = opts.maxSteps || 1e6;
    let out = '', steps = 0, depth = 0, maxDepth = 0, calls = 0;
    const tree = opts.trace ? { children: [] } : null;
    let node = tree;
    const rerr = (m, line) => { throw new CSError('runtime', m, line); };
    const step = line => { if (++steps > MAX_STEPS) throw new CSError('steps', 'התוכנית לא מסתיימת (יותר ממיליון צעדים). אולי יש לולאה אינסופית?', line); };

    function conv(v, t, where, line) {
      const vt = typeOf(v);
      if (vt === t) return v;
      if (t === 'int' && vt === 'char') return v.c;
      if (v === null && (t === 'string' || t.endsWith('[]'))) return v;
      const hint = t === 'char' && vt === 'int' ? ' (צריך המרה מפורשת: (char))' : '';
      return rerr(`${where}: צריך ערך מטיפוס ${t}, והתקבל ${vt}${hint}`, line);
    }
    const num = (v, op, line) => {
      if (typeof v === 'number') return v;
      if (v instanceof Char) return v.c;
      return rerr(`האופרטור ${op} לא מתאים לערך מטיפוס ${typeOf(v)}`, line);
    };
    const bool = (v, where, line) => (typeof v === 'boolean' ? v : rerr(`${where} צריך להיות ביטוי בוליאני (bool), והתקבל ${typeOf(v)}`, line));
    const int = (v, where, line) => (typeof v === 'number' ? v : v instanceof Char ? v.c : rerr(`${where} צריך להיות int, והתקבל ${typeOf(v)}`, line));
    const notNull = (v, line) => (v === null ? rerr('NullReferenceException: שימוש בערך null', line) : v);

    function arith(op, a, b, line) {
      if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return str(a) + str(b);
      const x = num(a, op, line), y = num(b, op, line);
      switch (op) {
        case '+': return (x + y) | 0;
        case '-': return (x - y) | 0;
        case '*': return Math.imul(x, y);
        case '/': if (y === 0) rerr('DivideByZeroException: חילוק באפס', line); return Math.trunc(x / y) | 0;
        case '%': if (y === 0) rerr('DivideByZeroException: שארית מחילוק באפס', line); return (x % y) | 0;
      }
      throw new Error('op ' + op);
    }
    function equals(a, b, line) {
      const na = typeof a === 'number' || a instanceof Char, nb = typeof b === 'number' || b instanceof Char;
      if (na && nb) return num(a) === num(b);
      const ta = typeOf(a), tb = typeOf(b);
      if (ta === tb || a === null || b === null) return a === b;
      return rerr(`אי אפשר להשוות ${ta} ל-${tb}`, line);
    }
    const lookup = (env, n) => { for (let i = env.length - 1; i >= 0; i--) if (env[i].has(n)) return env[i].get(n); throw new Error('unbound ' + n); };

    // מקום שאפשר להציב בו: { get, set, type }
    function place(e, env) {
      if (e.k === 'id') {
        const slot = lookup(env, e.name);
        return { type: slot.type, get: () => read(slot, e), set: v => (slot.v = conv(v, slot.type, `ההשמה ל-${e.name}`, e.line)) };
      }
      const a = notNull(ev(e.obj, env), e.line), i = int(ev(e.i, env), 'אינדקס', e.line);
      if (typeof a === 'string') rerr('אי אפשר לשנות תו בתוך מחרוזת (string)', e.line);
      if (!Array.isArray(a)) rerr(`אי אפשר לגשת עם [ ] לערך מטיפוס ${typeOf(a)}`, e.line);
      if (i < 0 || i >= a.length) rerr(`IndexOutOfRangeException: האינדקס ${i} מחוץ למערך באורך ${a.length}`, e.line);
      return { type: a.elem, get: () => a[i], set: v => (a[i] = conv(v, a.elem, 'ההשמה לתא במערך', e.line)) };
    }
    const read = (slot, e) => (slot.v === undefined ? rerr(`המשתנה ${e.name} בשימוש לפני שקיבל ערך`, e.line) : slot.v);
    // += על char נשאר char (כמו ב-C#)
    const back = (v, type) => (type === 'char' && typeof v === 'number' ? new Char(v & 0xFFFF) : v);

    function ev(e, env) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'id': return read(lookup(env, e.name), e);
        case 'blank':
          if (!blanks[e.id]) throw new Error('missing blank ' + e.id);
          return ev(blanks[e.id], env);
        case 'un': {
          const v = ev(e.e, env);
          if (e.op === '!') return !bool(v, 'האופרנד של !', e.line);
          const x = num(v, e.op, e.line);
          return e.op === '-' ? -x | 0 : x;
        }
        case 'cast': {
          const v = ev(e.e, env);
          if (e.to === 'int') return int(v, 'ההמרה (int)', e.line);
          return new Char(int(v, 'ההמרה (char)', e.line) & 0xFFFF);
        }
        case 'bin': {
          if (e.op === '&&') return bool(ev(e.l, env), 'האופרנד של &&', e.line) && bool(ev(e.r, env), 'האופרנד של &&', e.line);
          if (e.op === '||') return bool(ev(e.l, env), 'האופרנד של ||', e.line) || bool(ev(e.r, env), 'האופרנד של ||', e.line);
          const a = ev(e.l, env), b = ev(e.r, env);
          switch (e.op) {
            case '==': return equals(a, b, e.line);
            case '!=': return !equals(a, b, e.line);
            case '<': return num(a, e.op, e.line) < num(b, e.op, e.line);
            case '<=': return num(a, e.op, e.line) <= num(b, e.op, e.line);
            case '>': return num(a, e.op, e.line) > num(b, e.op, e.line);
            case '>=': return num(a, e.op, e.line) >= num(b, e.op, e.line);
            default: return arith(e.op, a, b, e.line);
          }
        }
        case 'cond': return bool(ev(e.c, env), 'התנאי של ?:', e.line) ? ev(e.a, env) : ev(e.b, env);
        case 'assign': {
          const pl = place(e.target, env);
          const v = e.op === '=' ? ev(e.e, env) : back(arith(e.op[0], pl.get(), ev(e.e, env), e.line), pl.type);
          return pl.set(v);
        }
        case 'incdec': {
          const pl = place(e.target, env), old = pl.get();
          pl.set(back(arith(e.op[0], old, 1, e.line), pl.type));
          return e.pre ? pl.get() : old;
        }
        case 'index': {
          const a = notNull(ev(e.obj, env), e.line), i = int(ev(e.i, env), 'אינדקס', e.line);
          if (typeof a === 'string') {
            if (i < 0 || i >= a.length) rerr(`IndexOutOfRangeException: האינדקס ${i} מחוץ למחרוזת באורך ${a.length}`, e.line);
            return new Char(a.charCodeAt(i));
          }
          if (!Array.isArray(a)) rerr(`אי אפשר לגשת עם [ ] לערך מטיפוס ${typeOf(a)}`, e.line);
          if (i < 0 || i >= a.length) rerr(`IndexOutOfRangeException: האינדקס ${i} מחוץ למערך באורך ${a.length}`, e.line);
          return a[i];
        }
        case 'member': {
          const o = notNull(ev(e.obj, env), e.line);
          if (typeof o === 'string' || Array.isArray(o)) return o.length;
          return rerr(`ל-${typeOf(o)} אין Length`, e.line);
        }
        case 'newarr': {
          const n = int(ev(e.size, env), 'גודל המערך', e.line);
          if (n < 0) rerr('גודל מערך לא יכול להיות שלילי', e.line);
          return arr(e.elem, new Array(n).fill(DEFAULTS[e.elem]));
        }
        case 'arrlit': return arr(e.elem, e.items.map(x => conv(ev(x, env), e.elem, 'איבר במערך', e.line)));
        case 'call': return callExpr(e, env);
      }
      throw new Error('unknown node ' + e.k);
    }

    function print(s) {
      out += s;
      if (node && node !== tree) node.events.push({ print: s });
      return undefined;
    }
    function callExpr(e, env) {
      const c = e.callee, line = e.line;
      if (c.k === 'id') return invoke(prog.funcs[c.name], e.args.map(a => ev(a, env)), line);
      const args = e.args.map(a => ev(a, env));
      if (c.obj.k === 'id' && STATIC[c.obj.name] && !env.some(s => s.has(c.obj.name))) {
        const who = `${c.obj.name}.${c.name}`;
        switch (who) {
          case 'Console.Write': return print(str(args[0]));
          case 'Console.WriteLine': return print((args.length ? str(args[0]) : '') + '\n');
          case 'Math.Max': return Math.max(int(args[0], who, line), int(args[1], who, line));
          case 'Math.Min': return Math.min(int(args[0], who, line), int(args[1], who, line));
          case 'Math.Abs': return Math.abs(int(args[0], who, line)) | 0;
        }
        const x = args[0];
        if (!(x instanceof Char)) rerr(`${who} מקבלת char, והתקבל ${typeOf(x)}`, line);
        const s = String.fromCharCode(x.c);
        if (c.name === 'IsDigit') return /[0-9]/.test(s);
        if (c.name === 'IsLetter') return /\p{L}/u.test(s);
        if (c.name === 'IsUpper') return /\p{Lu}/u.test(s);
        return /\p{Ll}/u.test(s);
      }
      const o = notNull(ev(c.obj, env), line);
      if (c.name === 'ToString') return str(o);
      if (c.name === 'Equals') return equals(o, args[0], line);
      if (typeof o !== 'string') rerr(`ל-${typeOf(o)} אין פעולה ${c.name}`, line);
      const sArg = (v, where) => (typeof v === 'string' ? v : rerr(`${where} מקבלת string, והתקבל ${typeOf(v)}`, line));
      switch (c.name) {
        case 'Substring': {
          const a = int(args[0], 'Substring', line), b = args.length > 1 ? int(args[1], 'Substring', line) : o.length - a;
          if (a < 0 || a > o.length) rerr(`ArgumentOutOfRangeException: Substring(${a}) במחרוזת באורך ${o.length}`, line);
          if (b < 0 || a + b > o.length) rerr(`ArgumentOutOfRangeException: Substring(${a}, ${b}) במחרוזת באורך ${o.length}`, line);
          return o.substr(a, b);
        }
        case 'IndexOf': return o.indexOf(args[0] instanceof Char ? str(args[0]) : sArg(args[0], 'IndexOf'));
        case 'Contains': return o.includes(args[0] instanceof Char ? str(args[0]) : sArg(args[0], 'Contains'));
        case 'ToUpper': return o.toUpperCase();
        case 'ToLower': return o.toLowerCase();
      }
      throw new Error('method ' + c.name);
    }

    function invoke(f, argv, line) {
      if (++depth > MAX_DEPTH) throw new CSError('stack', stackMsg(MAX_DEPTH), line);
      maxDepth = Math.max(maxDepth, depth);
      calls++;
      step(line);
      const scope = new Map();
      f.params.forEach((p, i) => scope.set(p.name, { type: p.type, v: conv(argv[i], p.type, `הפרמטר ${p.name} של ${f.name}`, line) }));
      const parent = node;
      let me = null;
      if (tree) {
        // children: הקריאות מתוכה. events: קריאות והדפסות לפי הסדר ({ call } / { print })
        me = { name: f.name, args: f.params.map(p => literal(scope.get(p.name).v)), children: [], events: [], depth };
        parent.children.push(me);
        if (parent.events) parent.events.push({ call: me });
        node = me;
      }
      const r = exec(f.body, [scope]);
      let v = r ? r.v : undefined;
      if (f.ret !== 'void') {
        if (!r) rerr(`הפעולה ${f.name} הגיעה לסוף בלי return`, f.line);
        v = conv(v, f.ret, `הערך שמוחזר מ-${f.name}`, line);
      }
      if (me) { me.ret = v; node = parent; }
      depth--;
      return v;
    }

    // מחזיר { v } אם בוצע return, אחרת undefined
    function exec(s, env) {
      step(s.line);
      switch (s.k) {
        case 'block': {
          env.push(new Map());
          for (const x of s.body) { const r = exec(x, env); if (r) { env.pop(); return r; } }
          env.pop();
          return undefined;
        }
        case 'decl':
          for (const v of s.vars) {
            const val = v.init ? conv(ev(v.init, env), s.type, `האתחול של ${v.name}`, s.line) : undefined;
            env[env.length - 1].set(v.name, { type: s.type, v: val });
          }
          return undefined;
        case 'if':
          if (bool(ev(s.cond, env), 'התנאי של if', s.line)) return scopedExec(s.then, env);
          return s.els ? scopedExec(s.els, env) : undefined;
        case 'while':
          while (bool(ev(s.cond, env), 'התנאי של while', s.line)) {
            const r = scopedExec(s.body, env);
            if (r) return r;
            step(s.line);
          }
          return undefined;
        case 'for': {
          env.push(new Map());
          if (s.init) exec(s.init, env);
          let r;
          while (!s.cond || bool(ev(s.cond, env), 'התנאי של for', s.line)) {
            r = scopedExec(s.body, env);
            if (r) break;
            s.update.forEach(u => ev(u, env));
            step(s.line);
          }
          env.pop();
          return r;
        }
        case 'return': return { v: s.e ? ev(s.e, env) : undefined };
        case 'expr': ev(s.e, env); return undefined;
      }
      throw new Error('unknown stmt ' + s.k);
    }
    function scopedExec(s, env) {
      env.push(new Map());
      const r = exec(s, env);
      env.pop();
      return r;
    }

    const f = prog.funcs[name];
    if (!f) throw new Error('no function ' + name);
    if (args.length !== f.params.length) throw new Error(`${name}: expected ${f.params.length} args`);
    let value;
    try { value = invoke(f, args, f.line); } catch (e) {
      // מחסנית ה-JS נגמרה לפני המגבלה שלנו: אותה שגיאה לתלמיד
      if (e instanceof RangeError) throw new CSError('stack', stackMsg(MAX_DEPTH), undefined);
      throw e;
    }
    return { value, out, calls, depth: maxDepth, steps, tree: tree ? tree.children[0] : null };
  }

  global.CS = { CSError, Char, ch, arr, tokenize, parseProgram, parseExpr, check, run, str, literal, typeOf, returns };
})(typeof window !== 'undefined' ? window : globalThis);
