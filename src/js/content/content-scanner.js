(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const D = C.D;
    const MT = C.MT;
    const R = C.runtime;
    const BARE_GZ = /([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])年/g;
    // 省略年号的纪年只认标准中文数字：元年、二年～六十一年。
    const BARE_YEAR = new RegExp('(' + D.CN_YEAR_PART + ')年', 'g');
    // 「没有年号的纪年」（如「二年」「三十三年」）只看它**前面**是什么 —— 段首也算边界。
    // 注意：全角逗号「，」和半角逗号「,」必须收在这里，否则「，二年」判不出来。
    const BEFORE_PUNCT = /[\s。．，、；;,：:？！?!…—～~「」『』“”‘’"'（）()〈〉《》【】\[\]{}·]/;
    // 除了标点，这几个字也算边界：「诏」（下诏…二年）、「其」（其二年＝它的第二年）。
    // 繁体「詔」一并收进来 —— 页面简繁两种写法都要认。
    const BEFORE_WORDS = new Set(['诏', '詔', '其', '起', '讫', '訖']);

    const BLOCK_TAGS = new Set([
        'P', 'DIV', 'LI', 'TD', 'TH', 'TR', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DD', 'DT', 'FIGCAPTION', 'MAIN', 'ASIDE',
        'HEADER', 'FOOTER', 'UL', 'OL', 'TABLE', 'BODY'
    ]);
    const EMBEDDED_YEAR_TAGS = new Set(['SPAN', 'A']);
    const DISPLAYED_YEAR_RE = /^(?:(?:公元前|前)\s*(\d+)|BC\s*(\d+)|([+-]?\d+))\s*年$/i;
    const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).map(function (t) { return t.toLowerCase(); }).join(',');
    // 文本节点「开头就是纪年」的形态，用于跨节点续接的判定。
    const BARE_YEAR_HEAD = new RegExp('^(' + D.CN_YEAR_PART + ')年');
    const MAX_ERA_LEN = 8;

    function getScanRoot(force) {
        if (!force && R.scanRoot && R.scanRoot.isConnected)
            return R.scanRoot;
        R.scanRoot = MT.findMainElement() || document.body;
        return R.scanRoot;
    }

    // 「没有年号的纪年」只看**同一个文本节点里**前一个字符是什么；节点开头就当作段首。
    // 不跨节点回看 —— 节点被拆开的情况只处理「年号 + 纪年被拆」（见 seedCrossNodeEra），
    // 标点/边界字不掺和，等真遇到具体问题再说。
    function isBoundary(node, index) {  // 暂未处理跨节点
        if (index <= 0)
            return true;                                    // 节点开头 = 段首
        const text = String(node.nodeValue || '');
        const ch = text.charAt(index - 1);
        if (BEFORE_PUNCT.test(ch))
            return true;                                    // 前面就是标点
        if (!BEFORE_WORDS.has(ch))
            return false;                                   // 既不是标点也不是边界字
        if (index - 1 <= 0)
            return true;                                    // 边界字本身就在节点开头
        return BEFORE_PUNCT.test(text.charAt(index - 2));   // 边界字前面也必须是标点
    }

    function embeddedYearOf(node) {
        let current = node && node.parentElement;
        for (let hop = 0; current && hop < 4; hop++, current = current.parentElement) {
            if (!EMBEDDED_YEAR_TAGS.has(current.tagName))
                continue;
            const className = String(current.className || '');
            if (!/(?:^|\s)nianhao(?:\s|$)/.test(className))
                continue;
            const title = String(current.getAttribute('title') || '').trim();
            const match = DISPLAYED_YEAR_RE.exec(title);
            if (!match)
                continue;
            const bc = match[1] || match[2];
            if (bc) {
                const value = Number(bc);
                return Number.isFinite(value) && value > 0 ? 1 - value : null;
            }
            const value = Number(match[3]);
            return Number.isFinite(value) ? value : null;
        }
        return null;
    }

    function findContextInfo(node) {
        const year = embeddedYearOf(node);
        if (!Number.isFinite(year) || typeof D.resolveByGregorianYear !== 'function')
            return null;
        const info = D.resolveByGregorianYear(year);
        return Array.isArray(info) && info.length ? info : null;
    }

    // ---- 跨节点续接 ----
    // 行内元素常把「年号」和「纪年」拆到相邻两个文本节点里，例如：
    //   <a>大业</a><span>二年（606年）八月初九日…</span>
    // 逐节点识别时看不到「大业二年」。做法：先把「上一个文本节点结尾的年号」补成一个标记，
    // 后面那个节点的「二年」就能通过下面 applyContextMatches 里既有的「上文年号链」接上。
    function sameBlock(a, b) {
        const ea = a && a.parentElement;
        const eb = b && b.parentElement;
        if (!ea || !eb)
            return false;
        const ba = ea.closest(BLOCK_SELECTOR) || document.body;
        const bb = eb.closest(BLOCK_SELECTOR) || document.body;
        return !!ba && ba === bb;
    }
    function toEraCandidate(row) {
        if (typeof C.candidateOf === 'function')
            return C.candidateOf(row, null);
        return {
            era: row.name,
            dynasty: row.dynasty,
            emperor: row.emperor,
            input: row.name,
            alias: null,
            n: null,
            eraStart: Number.isFinite(row.start) ? row.start : null,
            eraEnd: Number.isFinite(row.end) ? row.end : null,
            eraOffset: Number.isFinite(row.offset) && row.offset >= 1 ? row.offset : 1,
            gregorian: null
        };
    }
    // 取节点文本「结尾处的年号」：从长到短试，返回最长能解析出来的那一段。
    function eraTailOf(node) {
        const text = String(node && node.nodeValue || '');
        if (text.length < 2)
            return null;
        const max = Math.min(MAX_ERA_LEN, text.length);
        for (let len = max; len >= 2; len--) {
            const rows = D.lookupEra(text.slice(text.length - len));
            if (!rows || !rows.length)
                continue;
            const info = rows.map(toEraCandidate).filter(Boolean);
            if (info.length)
                return { start: text.length - len, end: text.length, info: info };
        }
        return null;
    }
    function seedCrossNodeEra(root) {
        const nodes = C.collectTextNodes(root);
        let count = 0;
        for (let i = 1; i < nodes.length; i++) {
            const prev = nodes[i - 1];
            const node = nodes[i];
            if (!prev.isConnected || !node.isConnected || !prev.parentNode)
                continue;
            const head = BARE_YEAR_HEAD.exec(node.nodeValue || '');
            if (!head)
                continue;
            if (!sameBlock(prev, node))
                continue;
            const tail = eraTailOf(prev);
            if (!tail)
                continue;
            const text = prev.nodeValue || '';
            const mark = C.createMark(text, { index: tail.start, end: tail.end, info: tail.info, n: null }, 'regex');
            if (!mark)
                continue;
            // 这个标记只负责高亮与「承接下文」，不单独补年份（见 content-annotation.js 的 annotateText）。
            mark.__eraSeed = true;
            mark.__eraN = null;
            const frag = document.createDocumentFragment();
            if (tail.start > 0)
                frag.appendChild(document.createTextNode(text.slice(0, tail.start)));
            frag.appendChild(mark);
            if (tail.end < text.length)
                frag.appendChild(document.createTextNode(text.slice(tail.end)));
            C.markSelfMutation();
            prev.parentNode.replaceChild(frag, prev);
            count++;
        }
        return count;
    }

    function applyContextMatches(root) {
        if (!root)
            return 0;
        try {
            seedCrossNodeEra(root);
        }
        catch (e) { }
        const nodes = C.collectTextNodes(root, { includeMarks: true });
        const plan = [];
        let chain = null;
        const rangeRe = D.buildRegex({ range: true });
        for (const node of nodes) {
            if (!node.isConnected)
                continue;
            const text = node.nodeValue || '';
            if (!text)
                continue;
            const holder = node.parentElement && node.parentElement.closest('.' + C.MARK);
            if (holder) {
                chain = {
                    list: holder.__eraInfo,
                    n: Number.isFinite(holder.__eraN) ? holder.__eraN : null,
                    dynasty: holder.__eraDynasty || '',
                    baseEl: holder,
                    lastEl: null
                };
                continue;
            }
            rangeRe.lastIndex = 0;
            const rangeHits = [];
            let match;
            while ((match = rangeRe.exec(text)) !== null) {
                const groups = match.groups || {};
                if (!groups.eraR && !groups.eraM)
                    continue;
                const info = D.resolve(match);
                if (!info || !info.length)
                    continue;
                rangeHits.push({
                    index: match.index,
                    end: match.index + match[0].length,
                    // 范围写法（貞觀年間 / 貞觀中）也把紧挨在前面的朝代一起圈进来，和 era/eraG 一致。
                    hlIndex: match.index - D.whoPrefixLength(text.slice(0, match.index)),
                    info,
                    range: true
                });
            }
            BARE_GZ.lastIndex = 0;
            const gzHits = [];
            while ((match = BARE_GZ.exec(text)) !== null) {
                if (!chain || !Array.isArray(chain.list) || !chain.list.length)
                    continue;
                gzHits.push({ index: match.index, end: match.index + match[0].length, gz: match[1], isGz: true });
            }
            BARE_YEAR.lastIndex = 0;
            const hits = [];
            const embeddedInfo = findContextInfo(node);
            while ((match = BARE_YEAR.exec(text)) !== null) {
                const n = match[1] === '元' ? 1 : D.cnToNumber(match[1]);
                if (!Number.isFinite(n) || n < 1 || n > 61)
                    continue;
                if (text.charAt(match.index - 1) === '积' || text.charAt(match.index - 1) === '積')
                    continue;
                const gzAfter = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/
                    .test(text.slice(match.index + match[0].length, match.index + match[0].length + 2));
                if (!gzAfter && !isBoundary(node, match.index))
                    continue;
                if (!chain) {
                    if (embeddedInfo && match.index === 0) {
                        hits.push({ index: match.index, end: match.index + match[0].length, n, info: embeddedInfo });
                        chain = { list: embeddedInfo, n, dynasty: (embeddedInfo[0] && embeddedInfo[0].dynasty) || '', baseEl: null, lastEl: null };
                        continue;
                    }
                    hits.push({ index: match.index, end: match.index + match[0].length, n });
                    chain = { list: null, n, dynasty: '', baseEl: null, lastEl: null };
                    continue;
                }
                hits.push({ index: match.index, end: match.index + match[0].length, n });
                chain.n = n;
            }
            const all = gzHits.concat(rangeHits, hits).sort(function (a, b) { return a.index - b.index; });
            if (all.length)
                plan.push({ node, hits: all, chain });
        }
        let count = 0;
        for (const item of plan) {
            const node = item.node;
            if (!node.isConnected || !node.parentNode)
                continue;
            const text = node.nodeValue || '';
            const frag = document.createDocumentFragment();
            let last = 0;
            for (const hit of item.hits) {
                if (hit.index < last)
                    continue;
                // 高亮起点可能比年号起点靠左（圈进了朝代前缀）；夹一道 last 防重叠时把文字切两遍。
                const start = Math.max(last, Number.isFinite(hit.hlIndex) && hit.hlIndex < hit.index
                    ? hit.hlIndex : hit.index);
                if (start > last)
                    frag.appendChild(document.createTextNode(text.slice(last, start)));
                const match = Object.assign({}, hit, {
                    info: hit.info || (item.chain && item.chain.list) || []
                });
                const mark = C.createMark(text, match, 'regex');
                if (mark) {
                    mark.__eraGz = hit.isGz ? hit.gz : null;
                    mark.__eraPrevEl = item.chain ? (item.chain.lastEl || item.chain.baseEl) : null;
                    if (item.chain)
                        item.chain.lastEl = mark;
                    frag.appendChild(mark);
                    count++;
                }
                else {
                    // 被「清除」过的片段：原样保留文本
                    frag.appendChild(document.createTextNode(text.slice(start, hit.end)));
                }
                last = hit.end;
            }
            if (last < text.length)
                frag.appendChild(document.createTextNode(text.slice(last)));
            C.markSelfMutation();
            node.parentNode.replaceChild(frag, node);
        }
        return count;
    }

    function runRegex() {
        // 识典古籍的正文画在 canvas 上，DOM 里只有阅读器自己的 UI 文字 ——
        // 在这里跑 DOM 扫描只会去标那些 UI，所以这个站点一律交给 canvas-adapter。
        if (typeof C.isCanvasSite === 'function' && C.isCanvasSite())
            return C.resp();
        const root = getScanRoot(true);
        if (!root)
            return C.resp();
        C.clearMarks(root);
        const re = D.buildRegex({ standalone: R.settings.standalone });
        const count = C.applyMarks(root, function (text) {
            if (!D.hasCandidate(text))
                return null;
            re.lastIndex = 0;
            const matches = [];
            let match;
            while ((match = re.exec(text)) !== null) {
                if (!match[0].length) {
                    re.lastIndex++;
                    continue;
                }
                const groups = match.groups || {};
                const info = D.resolve(match);
                if (info && info.length) {
                    const hit = { index: match.index, end: match.index + match[0].length, info };
                    // 带年号的写法（era / eraG / eraR / eraM）才把紧挨在前面的朝代（含「大」）一起圈进来。
                    // 这个正则没开 range，eraR/eraM 实际在 applyContextMatches 那条路上匹配（那里也加了）。
                    // eraB（独立年号）、以及下面第二遍扫出来的裸纪年（「唐五年」）都不算。
                    // eraC（改元永興）/ eraR（永興年間）/ eraM（貞觀中）/ eraB（独立年号）
                    // 都只有年号没有纪年，不扩；下面第二遍扫出来的裸纪年（「唐五年」）也不扩。
                    if (groups.era || groups.eraG || groups.eraR || groups.eraM)
                        hit.hlIndex = match.index - D.whoPrefixLength(text.slice(0, match.index));
                    matches.push(hit);
                }
            }
            return matches;
        }, 'regex');
        let contextCount = 0;
        try {
            contextCount = applyContextMatches(root);
        }
        catch (e) {
            contextCount = 0;
        }
        try {
            C.refreshEraContext(root);
            C.refreshAnnotations(root);
        }
        catch (e) { }
        C.reanchorTooltip();
        R.state.mode = 'regex';
        R.state.count = count + contextCount;
        R.state.aiRaw = 0;
        R.state.lastError = '';
        R.state.scannedAt = Date.now();
        R.state.userCleared = false;
        R.state.cached = false;
        R.state.cacheExact = false;
        return C.resp();
    }

    C.getScanRoot = getScanRoot;
    C.isBoundary = isBoundary;
    C.embeddedYearOf = embeddedYearOf;
    C.applyContextMatches = applyContextMatches;
    C.runRegex = runRegex;
})(typeof globalThis !== 'undefined' ? globalThis : self);
