(function () {
    'use strict';
    const D = window.EraData;
    const qEl = document.getElementById('sp-q');
    const outEl = document.getElementById('sp-out');
    const prevBtn = document.getElementById('sp-prev');
    const nextBtn = document.getElementById('sp-next');
    function cnNum(n) {
        const v = Number(n);
        if (!Number.isFinite(v) || v < 1 || v > 99)
            return String(n);
        const D1 = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
        if (v < 10)
            return D1[v];
        if (v === 10)
            return "十";
        if (v < 20)
            return "十" + D1[v - 10];
        const t = Math.floor(v / 10);
        const o = v % 10;
        return D1[t] + "十" + (o ? D1[o] : "");
    }
    // 纪年的第 1 年一律写「元年」，绝不写「一年」。
    function yearLabel(n) {
        return Number(n) === 1 ? '元' : cnNum(n);
    }
    const GANZHI_PART = '[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]';
    // 年号后面紧跟着纪年的样子：「…元年」「…二年」「…六十一年」「…甲子年」等。
    const CHRONO_AFTER = new RegExp('^\\s*(?:(?:' + D.YEAR_NUM_PART + ')\\s*年?|' + GANZHI_PART + '\\s*年?|年[间間]|(?:中|初|末)(?=$|[，,、。；;：:\\s]))');
    function parseQuery(q) {
        const raw = String(q || '').trim();
        if (!raw)
            return null;
        // 纯公元年：333 / 333年 / 公元333年（也认「公元前140年」「前140年」）
        const bc = raw.match(/^(?:公元前|前|-|BC|bc)\s*(\d{1,4})\s*年?$/);
        if (bc) {
            const n = Number(bc[1]);
            if (Number.isFinite(n) && n >= 1)
                return { gregorian: -n, era: '', year: null, who: '' };
        }
        const gy = raw.match(/^(?:公元)?\s*(\d{1,4})\s*年?$/);
        if (gy) {
            const n = Number(gy[1]);
            if (Number.isFinite(n) && n >= 1)
                return { gregorian: n, era: '', year: null, who: '' };
        }
        // 先找年号（从长到短），再把剩下的部分当「纪年 + 帝号 / 朝代」。
        // 顺序不能反过来：年号本身以「元」结尾时（建元 / 開元 / 至元 / 永元 … 表里有 35 个），
        // 先摘纪年会把年号末尾的「元」一起摘掉 —— 「建元元年」就只剩「建」了。
        //
        // 但帝号在表里也可能是一条年号（西漢·高祖·高祖、商朝那一串王名），
        // 所以还要优先取「后面紧跟着纪年」的那个匹配：
        // 「唐高祖武德元年」要认出「武德」，不能认出「高祖」。
        let era = '';
        let eraAt = -1;
        let loose = '';
        let looseAt = -1;
        for (let len = 4; len >= 2 && !era; len--) {
            for (let i = 0; i + len <= raw.length; i++) {
                const s = raw.slice(i, i + len);
                if (!D.lookupEra(s).length)
                    continue;
                if (CHRONO_AFTER.test(raw.slice(i + len))) {
                    era = s;
                    eraAt = i;
                    break;
                }
                if (!loose) {
                    loose = s;
                    looseAt = i;
                }
            }
        }
        if (!era && loose) {
            era = loose;
            eraAt = looseAt;
        }
        let who = eraAt >= 0 ? raw.slice(0, eraAt) + raw.slice(eraAt + era.length) : raw;
        // 「甲子年」这类写法单独解析：年号明确时按该年号的有效范围计算公元年。
        let ganzhi = '';
        const gm = who.match(new RegExp('(' + GANZHI_PART + ')\\s*年?'));
        if (gm) {
            ganzhi = gm[1];
            who = who.slice(0, gm.index) + who.slice(gm.index + gm[0].length);
        }
        // 「元」= 第 1 年 —— 首个年头一律写「元年」，不写「一年」。
        let year = null;
        const ym = who.match(new RegExp('(?<![二三四五六七八九十0-9０-９])(' + D.YEAR_NUM_PART + ')\\s*年?'));
        if (ym) {
            const n = ym[1] === '元' ? 1 : D.cnToNumber(ym[1]);
            if (Number.isFinite(n) && n >= 1)
                year = n;
            who = who.slice(0, ym.index) + who.slice(ym.index + ym[0].length);
        }
        who = who.replace(/(?:年间|中|初|末)$/, '');
        who = who.replace(/[\s·、,，]/g, '');
        return { era: era, year: year, ganzhi: ganzhi, who: who };
    }
    // 表里存的是正体（北漢 / 後漢），用户可能输入简体（北汉 / 后汉）—— 必须过 fold() 再比，
    // 否则「北汉乾祐二年」匹配不上任何一条，会退回「请选朝代」的建议框。
    // 另外要挡住空串：'北汉'.indexOf('') 是 0，不判空的话「朝代为空」的条目会全部命中。
    function whoMatch(row, who) {
        if (!who)
            return true;
        const w = EraSearch.fold(who);
        if (!w)
            return true;
        const d = EraSearch.fold(row.dynasty || '');
        const e = EraSearch.fold(row.emperor || '');
        return (!!d && d.indexOf(w) >= 0) || (!!d && w.indexOf(d) >= 0) ||
            (!!e && e.indexOf(w) >= 0) || (!!e && w.indexOf(e) >= 0);
    }
    // 这条年号到底有没有「第 n 年」——按表里记的起止年判断。
    // 用 eraYear() 而不是 start + n - 1，一是跨公元前后不差一年，二是表里第 6 列
    // 那种「不从元年开始计数」的条目（天會：968 是十二年）能算对。
    // 起止年任一端不可考（表里为 null）或数据颠倒（end < start）时判断不了，
    // 一律放行，不把本来收录了的年号误判成不存在；这类条目公历年显示「未知」。
    function hasNthYear(row, n) {
        // 注意必须拿原值判断：Number(null) === 0，一旦先转数字就绕过 Number.isFinite 了。
        const start = row && row.start;
        const end = row && row.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
            return true;
        return D.eraYear(start, n, row.offset) <= end;
    }
    // 覆盖某个公元年的全部年号（一个年份可能同时有好几个政权在用的年号）。
    // 返回 [{ row, n }]，n = 该年是这条年号的第几年。
    function erasCoveringYear(year) {
        const out = [];
        const seen = Object.create(null);
        for (const e of (D.ERAS || [])) {
            if (!Number.isFinite(e.start))
                continue;
            const end = Number.isFinite(e.end) ? e.end : e.start;
            if (year < e.start || year > end)
                continue;
            const key = [e.dynasty, e.emperor, e.name, e.start].join('|');
            if (seen[key])
                continue;
            seen[key] = 1;
            // 这一年的纪年数 = 离 start 的偏移 + offset（表里第 6 列那种不从元年开始计数的条目）。
            const off = Number.isFinite(e.offset) && e.offset >= 1 ? e.offset : 1;
            out.push({ row: e, n: year - e.start + off });
        }
        out.sort(function (a, b) {
            const d = (a.row.start || 0) - (b.row.start || 0);
            return d !== 0 ? d : String(a.row.name).localeCompare(String(b.row.name));
        });
        return out;
    }
    function search(q) {
        const p = parseQuery(q);
        if (!p)
            return { kind: 'idle' };
        if (p.gregorian) {
            const rows = erasCoveringYear(p.gregorian);
            return rows.length
                ? { kind: 'year', year: p.gregorian, rows: rows }
                : { kind: 'year-none', year: p.gregorian };
        }
        if (!p.era) {
            const who = p.who || "";
            if (who) {
                const pick = pickEmperor(who);
                if (pick) {
                    const rows = EraSearch.erasOfEmperor(pick.dynasty, pick.emperor);
                    if (rows.length)
                        return { kind: "emperor", who: pick, rows: rows };
                }
                const all = EraSearch.emperors(who, 30);
                if (all.length) {
                    const first = all[0];
                    const rows = EraSearch.erasOfEmperor(first.dynasty, first.emperor);
                    if (rows.length) {
                        return { kind: "emperor", who: first, rows: rows, list: all };
                    }
                }
                return { kind: "no-era" };
            }
            return { kind: "no-era" };
        }
        let rows = D.lookupEra(p.era);
        if (!rows.length)
            return { kind: 'none', era: p.era };
        if (p.who) {
            const hit = rows.filter((r) => whoMatch(r, p.who));
            if (hit.length)
                rows = hit;
            else
                return { kind: 'none-who', era: p.era, who: p.who };
        }
        // 指定了干支：只接受该干支确实落在该年号有效范围内的条目。
        // 「雍正甲子年」这类超出范围的明确输入直接报错，绝不回溯上文或换算成别的年号。
        if (p.ganzhi) {
            const hits = [];
            for (const r of rows) {
                const offset = D.ganzhiOffsetIn(r.start, r.end, p.ganzhi);
                if (offset < 0 || !Number.isFinite(r.start))
                    continue;
                // 干支锚在真实年份上，与年号的计数起点无关：这一年的纪年数
                // = 离 start 的偏移 + offset（天會 offset 12，甲子在 start 那年就是十三年）。
                const eraOff = Number.isFinite(r.offset) && r.offset >= 1 ? r.offset : 1;
                hits.push({ row: r, n: offset + eraOff });
            }
            if (!hits.length)
                return { kind: 'ganzhi-out', era: p.era, ganzhi: p.ganzhi, who: p.who, rows: rows };
            const hitYear = function (h) { return D.eraYear(h.row.start, h.n, h.row.offset); };
            hits.sort(function (a, b) { return hitYear(a) - hitYear(b); });
            return { kind: 'year', year: hitYear(hits[0]), rows: hits, ganzhiQuery: true };
        }
        // 指定了纪年，就只留「真的有第 n 年」的年号：
        // 太初在西漢名下只用了 4 年，不该查得出「太初五年」；
        // 但前秦用了 9 年、西秦 13 年，它们的太初五年要照常留下。
        if (Number.isFinite(p.year) && p.year >= 1) {
            const inRange = rows.filter((r) => hasNthYear(r, p.year));
            // rows 留给报错文案列出各条年号的起止年；同时它让 hasResults() 认为
            // 「已经认出来了」，于是不会再弹出建议下拉（「太初五年」不该再提示别的年号）。
            if (!inRange.length)
                return { kind: 'year-out', era: p.era, year: p.year, who: p.who, rows: rows };
            rows = inRange;
        }
        return { kind: 'ok', era: p.era, year: p.year, rows: rows };
    }
    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls)
            n.className = cls;
        if (text != null)
            n.textContent = text;
        return n;
    }
    // 起止年任一端不确定（表里为 null）→ 一律显示「未知」。
    // 不能拿已知的那一端当整段（夏商那些只留下王名、年份不可考的条目）。
    function yearsUnknown(r) {
        return !Number.isFinite(r && r.start) || !Number.isFinite(r && r.end);
    }
    function fmtRange(r) {
        if (yearsUnknown(r))
            return '未知';
        // 前 841 年（共和元年）之前的年份各加「约」
        const a = D.formatYearApprox(r.start);
        const b = D.formatYearApprox(r.end);
        if (b === a)
            return a + '年';
        return a + '-' + b + '年';
    }
    // 表里第 6 列：这个年号在 start 那一年已经是第几年。缺省 1（start 就是元年）时返回空串。
    // 显示成「起12年」放在公历年下面，免得把「968-973年」误读成 968 就是元年。
    function epochLabel(row) {
        const off = Number(row && row.offset);
        return Number.isFinite(off) && off > 1 ? '起' + Math.floor(off) + '年' : '';
    }
    function render(res) {
        // 放在最前面：下面大多数分支都会提前 return，挂末尾会有分支漏掉。
        updateStepButtons(res);
        outEl.textContent = '';
        if (res.kind === 'idle') {
            const hint = el('div', 'sp-empty');
            hint.appendChild(el('div', '', '输入支持：'));

            // 列表容器
            const ul = document.createElement('ul');
            ul.style.marginTop = '6px';
            ul.style.paddingLeft = '20px';

            function addItem(label, value) {
                const li = document.createElement('li');

                const strong = document.createElement('strong');
                strong.textContent = label + '：';

                li.appendChild(strong);
                li.appendChild(document.createTextNode(value));

                ul.appendChild(li);
            }

            addItem('公元年', '104、BC104、bc104、前104、公元前104');
            addItem('年号', '太初、太初元年、武帝太初元年、汉武帝太初元年、康熙甲子年');
            addItem('帝号', '武帝、汉武帝');
            addItem('朝代', '汉、西汉');

            hint.appendChild(ul);
            outEl.appendChild(hint);
            return;
        }
        if (res.kind === 'no-era') {
            outEl.appendChild(el('div', 'sp-empty', '未查询到该年号，请重新输入。'));
            return;
        }
        if (res.kind === "who-list") {
            for (const it of res.list) {
                const row = el("div", "sp-row sp-row-pick");
                row.setAttribute("data-dynasty", it.dynasty);
                row.setAttribute("data-emperor", it.emperor);
                const left = el("div", "sp-row-left");
                left.appendChild(el("span", "sp-era", it.dynasty + "·" + it.emperor));
                row.appendChild(left);
                row.addEventListener("click", function () {
                    qEl.value = it.dynasty + it.emperor;
                    run();
                    qEl.focus();
                });
                outEl.appendChild(row);
            }
            return;
        }
        if (res.kind === "none") {
            outEl.appendChild(el('div', 'sp-err', '年号表里没有「' + res.era + '」。'));
            return;
        }
        if (res.kind === 'none-who') {
            outEl.appendChild(el('div', 'sp-err', '输入错误，未查询到相关纪年。'));
            return;
        }
        if (res.kind === 'year-out') {
            // 帝号和这一处的年号同名时不再重复写（见 D.whoText）
            const spans = res.rows.map(function (r) {
                return D.whoText(r.dynasty, r.emperor, '', r.name) + '：' + fmtRange(r);
            });
            outEl.appendChild(el('div', 'sp-err',
                '「' + res.era + '」' + (res.who ? '在「' + res.who + '」名下' : '') +
                '没有第' + yearLabel(res.year) + '年。请重新输入'));
            return;
        }
        if (res.kind === 'year-none') {
            outEl.appendChild(el('div', 'sp-empty',
                '公元 ' + D.formatYear(res.year) + ' 年没有对应的年号（可能超出年号表的范围）。'));
            return;
        }
        if (res.kind === 'ganzhi-out') {
            outEl.appendChild(el('div', 'sp-err', '输入错误，未查询到相关纪年。'));
            return;
        }
        if (res.kind === 'year') {
            // 第一行之前先给一条提示：公元年 - 干支
            const head = el('div', 'sp-year-head');
            head.appendChild(el('b', 'sp-year-num', D.formatYear(res.year) + '年'));
            head.appendChild(el('span', 'sp-year-sep', '-'));
            head.appendChild(el('span', 'sp-year-gz', D.ganzhiOf(res.year)));
            outEl.appendChild(head);
            for (const item of res.rows) {
                const r = item.row;
                const row = el('div', 'sp-row');
                // 一行读完：朝代 · 帝号 · 年号+纪年（如「唐 · 太宗 · 貞觀五年」）。
                // 查的就是这个公元年，表头已经写了，行里不再重复年份；
                // 该年号的起止年放到 title 里，需要时悬停看。
                row.title = fmtRange(r);
                // 朝代只去掉末尾的「朝」（唐朝→唐）；不用 EraSearch.shortDynasty ——
                // 那个是给匹配用的简称（東晉→晉、前涼→涼），显示太短。
                const dynasty = String(r.dynasty || '').replace(/[朝]$/, '');
                // 第 1 年写「元年」，不写「一年」
                const yearNum = yearLabel(item.n);
                const left = el('div', 'sp-row-left');
                left.appendChild(el('span', 'sp-era',
                    D.whoText(dynasty, r.emperor, r.name + yearNum + '年', r.name) || '（无朝代信息）'));
                row.appendChild(left);
                outEl.appendChild(row);
            }
            return;
        }
        if (res.kind === "emperor") {
            for (const r of res.rows) {
                const row = el("div", "sp-row");
                const left = el("div", "sp-row-left");
                left.appendChild(el("span", "sp-era", r.name));
                row.appendChild(left);
                const right = el("div", "sp-year");
                right.appendChild(document.createTextNode(fmtRange(r)));
                const epoch = epochLabel(r);
                if (epoch)
                    right.appendChild(el("span", "sp-epoch", epoch));
                row.appendChild(right);
                outEl.appendChild(row);
            }
            return;
        }
        for (const r of res.rows) {
            const row = el('div', 'sp-row');
            if (res.year)
                row.title = fmtRange(r);
            const left = el('div', 'sp-row-left');
            left.appendChild(el('span', 'sp-era', r.name + (res.year ? yearLabel(res.year) + '年' : '')));
            // 上面 sp-era 已经写了年号，帝号跟它同名时这一行只留朝代
            left.appendChild(el('span', 'sp-meta', D.whoText(r.dynasty, r.emperor, '', r.name) || '（无朝代信息）'));
            row.appendChild(left);
            const right = el('div', 'sp-year');
            // 起止年任一端不确定 → 不换算公历年，直接显示「未知」。
            if (res.year && !yearsUnknown(r)) {
                const y = D.eraYear(r.start, res.year, r.offset);
                right.appendChild(document.createTextNode(D.formatYearApprox(y)));
                right.appendChild(el('span', 'sp-greg', D.ganzhiOf(y)));
            }
            else {
                right.appendChild(document.createTextNode(fmtRange(r)));
            }
            const epoch = epochLabel(r);
            if (epoch)
                right.appendChild(el('span', 'sp-epoch', epoch));
            row.appendChild(right);
            outEl.appendChild(row);
        }
    }
    const sugEl = document.getElementById("sp-sug");
    let sugItems = [];
    let sugOn = -1;
    function pickEmperor(text) {
        const raw = EraSearch.stripYearTail(text);
        if (!raw)
            return null;
        const list = EraSearch.emperors(raw, 30);
        if (!list.length)
            return null;
        const folded = EraSearch.fold(raw);
        const withDyn = list.filter(function (x) {
            const dy = EraSearch.fold(x.dynasty);
            const short = EraSearch.fold(EraSearch.shortDynasty(x.dynasty));
            return (dy && folded.indexOf(dy) >= 0) || (short && folded.indexOf(short) >= 0);
        });
        const pool = withDyn.length ? withDyn : list;
        return pool.length === 1 ? pool[0] : null;
    }
    function hasResults(text) {
        try {
            const res = search(text);
            return !!(res && res.rows && res.rows.length > 0);
        }
        catch (e) {
            return false;
        }
    }
    function hideSug() {
        if (sugEl) {
            sugEl.hidden = true;
            sugEl.textContent = "";
        }
        sugItems = [];
        sugOn = -1;
    }
    function showSug(frag) {
        if (!sugEl)
            return;
        const rawForWho = EraSearch.stripYearTail(qEl.value);
        const dyns = EraSearch.dynasties(rawForWho, 12).filter(function (dy) {
            const fdy = EraSearch.fold(dy);
            const short = EraSearch.fold(EraSearch.shortDynasty(dy));
            const fq = EraSearch.fold(rawForWho);
            return fdy.indexOf(fq) >= 0 || short.indexOf(fq) >= 0;
        });
        if (dyns.length > 1) {
            sugEl.textContent = "";
            sugItems = [];
            sugOn = -1;
            for (const dy of dyns) {
                const item = el("div", "sp-sug-item");
                item.appendChild(el("b", null, dy));
                item.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    applySug(dy, true);
                });
                item.setAttribute("data-i", String(sugItems.length));
                sugItems.push(dy);
                sugEl.appendChild(item);
            }
            try {
                const bd = qEl.getBoundingClientRect();
                const hd = document.body.getBoundingClientRect();
                sugEl.style.top = (bd.bottom - hd.top + 4) + "px";
            }
            catch (e) { }
            sugEl.hidden = false;
            return;
        }
        const emps = EraSearch.emperors(rawForWho, 8);
        const rows = EraSearch.search(frag, 12);
        const rawText = EraSearch.fold(EraSearch.stripYearTail(qEl.value));
        const specific = !!pickEmperor(qEl.value);
        if (emps.length && !specific) {
            sugEl.textContent = "";
            sugItems = [];
            sugOn = -1;
            const addItem = function (label, sub, value) {
                const item = el("div", "sp-sug-item");
                item.appendChild(el("b", null, label));
                if (sub)
                    item.appendChild(el("span", "sp-sug-meta", sub));
                item.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    applySug(value, true);
                });
                item.setAttribute("data-i", String(sugItems.length));
                sugItems.push(value);
                sugEl.appendChild(item);
            };
            for (const x of emps)
                addItem(x.dynasty + " · " + x.emperor, "", x.dynasty + x.emperor);
            try {
                const b2 = qEl.getBoundingClientRect();
                const h2 = document.body.getBoundingClientRect();
                sugEl.style.top = (b2.bottom - h2.top + 4) + "px";
            }
            catch (e) { }
            sugEl.hidden = false;
            return;
        }
        if (specific) {
            const one = emps[0];
            const mine = EraSearch.erasOfEmperor(one.dynasty, one.emperor);
            if (mine.length) {
                sugEl.textContent = "";
                sugItems = mine.map(function (x) { return x.name; });
                sugOn = -1;
                mine.forEach(function (x, i) {
                    const item = el("div", "sp-sug-item");
                    item.appendChild(el("b", null, x.name));
                    item.appendChild(el("span", "sp-sug-meta", fmtRange(x)));
                    item.addEventListener("mousedown", function (e) {
                        e.preventDefault();
                        applySug(x.name, true);
                    });
                    item.setAttribute("data-i", String(i));
                    sugEl.appendChild(item);
                });
                try {
                    const b3 = qEl.getBoundingClientRect();
                    const h3 = document.body.getBoundingClientRect();
                    sugEl.style.top = (b3.bottom - h3.top + 4) + "px";
                }
                catch (e) { }
                sugEl.hidden = false;
                return;
            }
        }
        if (!rows.length) {
            const emps = EraSearch.emperors(frag, 12);
            if (!emps.length) {
                hideSug();
                return;
            }
            sugEl.textContent = "";
            sugItems = emps.map(function (x) { return x.dynasty + x.emperor; });
            sugOn = -1;
            emps.forEach(function (x, i) {
                const item = el("div", "sp-sug-item");
                item.appendChild(el("b", null, x.dynasty + " · " + x.emperor));
                item.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    applySug(x.dynasty + x.emperor, true);
                });
                item.setAttribute("data-i", String(i));
                sugEl.appendChild(item);
            });
            try {
                const b = qEl.getBoundingClientRect();
                const h = document.body.getBoundingClientRect();
                sugEl.style.top = (b.bottom - h.top + 4) + "px";
            }
            catch (e) { }
            sugEl.hidden = false;
            return;
        }
        sugEl.textContent = "";
        sugItems = rows.map(function (r) { return r.name; });
        sugOn = -1;
        rows.forEach(function (r, i) {
            const item = el("div", "sp-sug-item");
            item.appendChild(el("b", null, r.name));
            // 前面 <b> 已经写了年号名，帝号跟它同名时这里只留朝代
            const meta = D.whoText(r.dynasty, r.emperor, '', r.name);
            if (meta)
                item.appendChild(el("span", "sp-sug-meta", meta));
            item.addEventListener("mousedown", function (e) {
                e.preventDefault();
                applySug(rows[i].name);
            });
            item.setAttribute("data-i", String(i));
            sugEl.appendChild(item);
        });
        try {
            const b = qEl.getBoundingClientRect();
            const h = document.body.getBoundingClientRect();
            sugEl.style.top = (b.bottom - h.top + 4) + "px";
        }
        catch (e) { }
        sugEl.hidden = false;
    }
    function applySug(name, clearFirst) {
        const cur = qEl.value || "";
        if (clearFirst) {
            qEl.value = name;
        }
        else {
            const frag = EraSearch.fragmentOf(cur);
            qEl.value = frag ? cur.slice(0, cur.length - frag.length) + name : name;
        }
        hideSug();
        qEl.focus();
        qEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function moveSug(d) {
        if (!sugItems.length)
            return;
        sugOn = (sugOn + d + sugItems.length) % sugItems.length;
        Array.prototype.forEach.call(sugEl.children, function (c, i) {
            if (i === sugOn)
                c.classList.add("sp-sug-on");
            else
                c.classList.remove("sp-sug-on");
        });
    }
    function renderQuery() {
        try {
            render(search(qEl.value));
        }
        catch (e) {
            outEl.textContent = '';
            outEl.appendChild(el('div', 'sp-err', '查询出错：' + ((e && e.message) || e)));
        }
    }
    let timer = null;
    function run() {
        clearTimeout(timer);
        timer = setTimeout(renderQuery, 120);
    }
    qEl.addEventListener('input', function () {
        run();
        const res = search(qEl.value);
        const isWho = !!(res && res.kind === "emperor" && res.list && res.list.length > 1);
        const onlyDyn = !hasResults(qEl.value) && EraSearch.dynasties(EraSearch.stripYearTail(qEl.value), 12).length > 1;
        if (!isWho && !onlyDyn && hasResults(qEl.value)) {
            hideSug();
            return;
        }
        const frag = EraSearch.fragmentOf(qEl.value);
        if (frag)
            showSug(frag);
        else
            hideSug();
    });
    qEl.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveSug(1);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveSug(-1);
            return;
        }
        if (e.key === 'Escape') {
            hideSug();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (sugOn >= 0 && sugItems[sugOn])
                applySug(sugItems[sugOn]);
            else {
                hideSug();
                run();
            }
        }
    });
    qEl.addEventListener('blur', function () { setTimeout(hideSug, 120); });
    let outsideTimer = null;
    document.addEventListener('mousemove', function (e) {
        if (sugEl.hidden)
            return;
        const t = e.target;
        const inside = (t && (t === qEl || (t.closest && t.closest('#sp-sug')))) ||
            (t === qEl) || (sugEl.contains(t));
        if (inside) {
            if (outsideTimer) {
                clearTimeout(outsideTimer);
                outsideTimer = null;
            }
            return;
        }
        if (outsideTimer)
            return;
        outsideTimer = setTimeout(function () {
            outsideTimer = null;
            hideSug();
        }, 200);
    });
    // ---- 输入框右侧的 < / >：按年跳转 ----
    // 公元年直接 ±1。年号按「同年号 → 同帝号 → 同朝代」找上/下一个，到朝代边界就停。
    // 该年号的最后一年（年份不可考 / 数据颠倒时算不出，返回 null）。
    function lastYearOf(row) {
        const start = row && row.start;
        const end = row && row.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
            return null;
        let n = 1;
        while (D.eraYear(start, n + 1, row.offset) <= end)
            n++;
        return n;
    }
    // 一个分组内的年号按时间先后排。表里主朝代的顺序本来就对，只有十六國 / 南北朝
    // 这类合称朝代内部有十来处逆序，而且夏商那些 start 是 null。
    // 做法：start 为 null 的沿用「它前面最近一个已知 start」，再按这个键稳定排序 ——
    // 这样夏商那串王名不会被排乱，逆序的也能纠正过来。
    function orderedEras(list) {
        let last = -Infinity;
        const keyed = list.map(function (row, i) {
            const known = Number.isFinite(row.start);
            const key = known ? row.start : last;
            if (known)
                last = row.start;
            return { row: row, key: key, i: i };
        });
        keyed.sort(function (a, b) { return a.key === b.key ? a.i - b.i : a.key - b.key; });
        return keyed.map(function (x) { return x.row; });
    }
    function siblings(row, sameEmperor) {
        return orderedEras(D.ERAS.filter(function (e) {
            return e.dynasty === row.dynasty && (!sameEmperor || e.emperor === row.emperor);
        }));
    }
    // 同一分组里往前 / 往后一格（按身份找，年号重名的行也能分清）；没有就 null。
    function neighbour(row, sameEmperor, dir) {
        const list = siblings(row, sameEmperor);
        const i = list.indexOf(row);
        if (i < 0)
            return null;
        return list[i + dir] || null;
    }
    // 跳过去之后输入框里写什么：朝代简称 + 帝号 + 年号 + 纪年（如「唐太宗贞观四年」）。
    // 这套写法 sidepanel 的 parseQuery 认，能原样查回来。
    function eraQuery(row, year) {
        const short = EraSearch.shortDynasty(row.dynasty) || row.dynasty || '';
        return short + (row.emperor || '') + row.name + yearLabel(year) + '年';
    }
    // 当前停在哪：{ gregorian } 或 { row, year }；认不出就 null（按钮置灰）。
    function positionOf(res) {
        if (!res)
            return null;
        if (res.kind === 'year' && Number.isFinite(res.year))
            return { gregorian: res.year };
        if (res.kind === 'ok' && res.rows && res.rows.length && Number.isFinite(res.year) && res.year >= 1)
            return { row: res.rows[0], year: res.year };
        return null;
    }
    // dir = -1 上一年 / +1 下一年；跳不动返回 null。
    function stepPosition(pos, dir) {
        if (!pos)
            return null;
        if (Number.isFinite(pos.gregorian)) {
            const y = pos.gregorian;
            // 没有公元 0 年：前1年 的下一年是公元1年，公元1年 的上一年是前1年。
            const next = dir > 0 ? (y === -1 ? 1 : y + 1) : (y === 1 ? -1 : y - 1);
            return { query: D.formatYear(next) };
        }
        const row = pos.row;
        const last = lastYearOf(row);
        if (dir < 0) {
            if (pos.year > 1)
                return { query: eraQuery(row, pos.year - 1) };
            // 本年年号到头 → 同帝号的上一个年号（最后一年）→ 同朝代的上一个年号。
            const prev = neighbour(row, true, -1) || neighbour(row, false, -1);
            if (!prev)
                return null;                                  // 这个朝代已经到第一年
            return { query: eraQuery(prev, lastYearOf(prev) || 1) };
        }
        if (last !== null && pos.year < last)
            return { query: eraQuery(row, pos.year + 1) };
        const next = neighbour(row, true, 1) || neighbour(row, false, 1);
        if (!next)
            return null;                                      // 这个朝代已经到最后一年
        return { query: eraQuery(next, 1) };
    }
    function stepBy(dir) {
        const next = stepPosition(positionOf(search(qEl.value)), dir);
        if (!next)
            return false;
        qEl.value = next.query;
        hideSug();
        renderQuery();          // 长按连续跳转要立刻看到结果，不能走 120ms 防抖
        return true;
    }
    function updateStepButtons(res) {
        if (!prevBtn && !nextBtn)
            return;
        const pos = positionOf(res);
        if (prevBtn)
            prevBtn.disabled = !stepPosition(pos, -1);
        if (nextBtn)
            nextBtn.disabled = !stepPosition(pos, 1);
    }
    // 按下先走一步；按住 400ms 后每 90ms 再走一步（长按连续跳转）。
    function bindStepButton(btn, dir) {
        if (!btn)
            return;
        let delayTimer = 0;
        let repeatTimer = 0;
        function stop() {
            clearTimeout(delayTimer);
            clearInterval(repeatTimer);
            delayTimer = 0;
            repeatTimer = 0;
        }
        btn.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            stop();
            stepBy(dir);
            delayTimer = setTimeout(function () {
                delayTimer = 0;
                repeatTimer = setInterval(function () { stepBy(dir); }, 90);
            }, 400);
        });
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        window.addEventListener('blur', stop);
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            // pointerdown 已经处理过鼠标点击；只有键盘触发的 click（detail === 0）补一步。
            if (e.detail === 0)
                stepBy(dir);
        });
    }
    bindStepButton(prevBtn, -1);
    bindStepButton(nextBtn, 1);
    render({ kind: 'idle' });
    qEl.focus();
})();
