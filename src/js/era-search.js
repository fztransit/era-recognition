(function (global) {
    'use strict';
    function D() {
        return global.EraData || (typeof self !== 'undefined' ? self.EraData : null);
    }
    function fold(s) {
        const d = D();
        const t = String(s == null ? '' : s).trim();
        if (!d || !t)
            return t;
        try {
            return d.canonicalForm(t);
        }
        catch (e) {
            return t;
        }
    }
    function search(query, limit) {
        const d = D();
        const q = String(query || '').trim();
        if (!d || !q)
            return [];
        const max = limit > 0 ? limit : 40;
        const folded = fold(q);
        if (!folded)
            return [];
        const seen = {};
        const out = [];
        for (const e of (d.ERAS || [])) {
            if (out.length >= max)
                break;
            const hit = fold(e.name).indexOf(folded) >= 0 ||
                fold(e.dynasty).indexOf(folded) >= 0 ||
                fold(e.emperor).indexOf(folded) >= 0;
            if (!hit)
                continue;
            const key = e.dynasty + '|' + e.emperor + '|' + e.name;
            if (seen[key])
                continue;
            seen[key] = 1;
            out.push(e);
        }
        return out;
    }
    // 输入的年号还只是别的更长年号的开头时（「建武」→「建武中元」、「太平」→「太平興國」…），
    // 把这些更长的年号也列出来 —— 侧边栏据此弹建议框，让用户挑到底要查哪个。
    // 只比对年号名（不含朝代 / 帝号），且要求「严格更长 + 以输入开头」，不做中间包含匹配：
    // 否则单字输入（「啟」）会把「光啟 / 天啟」这类中间命中的也一并拉进来。
    function extensions(query, limit) {
        const d = D();
        const q = String(query || '').trim();
        if (!d || !q)
            return [];
        const folded = fold(q);
        if (!folded)
            return [];
        const max = limit > 0 ? limit : 20;
        const seen = Object.create(null);
        const out = [];
        for (const e of (d.ERAS || [])) {
            const name = String(e.name || '');
            const fname = fold(name);
            if (!fname || fname === folded || fname.indexOf(folded) !== 0)
                continue;
            if (seen[fname])
                continue;
            seen[fname] = 1;
            out.push(name);
        }
        // 短的在前（「建武中元」比「建武中元某」更常见）。
        out.sort(function (a, b) {
            return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
        });
        return out.slice(0, max);
    }
    // 结尾的纪年：元年、中文二年～六十一年、或阿拉伯数字 1～61 年。
    // 不允许从错误写法内部截出一个较短的数字（例如「六十二年」里的「十二年」）。
    const YEAR_TAIL = new RegExp('(?<![二三四五六七八九十0-9０-９])(?:' + D().YEAR_NUM_PART + ')\\s*年$');
    function stripYearTail(text) {
        return String(text == null ? '' : text).replace(YEAR_TAIL, '').trim();
    }
    function fragmentOf(text) {
        const t = stripYearTail(text);
        if (!t)
            return '';
        for (let len = Math.min(4, t.length); len >= 1; len--) {
            const frag = t.slice(-len);
            if (search(frag, 1).length)
                return frag;
        }
        return '';
    }
    function shortDynasty(dynasty) {
        const d = D();
        const dy = String(dynasty || "").trim();
        if (!dy)
            return "";
        const alias = d && d.DYNASTY_ALIAS;
        if (alias && alias[dy])
            return alias[dy];
        return dy.replace(/[朝]$/, "");
    }
    function emperors(query, limit) {
        const d = D();
        const q = String(query || "").trim();
        if (!d || !q)
            return [];
        const max = limit > 0 ? limit : 40;
        const folded = fold(q);
        if (!folded)
            return [];
        const seen = Object.create(null);
        const out = [];
        for (const e of (d.ERAS || [])) {
            if (out.length >= max)
                break;
            const dy = String(e.dynasty || "");
            const em = String(e.emperor || "");
            if (!em)
                continue;
            const fdy = fold(dy);
            const fem = fold(em);
            const dyShort = fold(shortDynasty(dy));
            const hit = (fdy + fem).indexOf(folded) >= 0 ||
                (dyShort + fem).indexOf(folded) >= 0 ||
                fdy.indexOf(folded) >= 0 || fem.indexOf(folded) >= 0;
            if (!hit)
                continue;
            const key = dy + "|" + em;
            if (seen[key])
                continue;
            seen[key] = 1;
            out.push({ dynasty: dy, emperor: em });
        }
        const qualified = out.filter(function (x) {
            const short = fold(shortDynasty(x.dynasty));
            return (fold(x.dynasty) && folded.indexOf(fold(x.dynasty)) >= 0) ||
                (short && folded.indexOf(short) >= 0);
        });
        return qualified.length ? qualified : out;
    }
    function dynasties(query, limit) {
        const d = D();
        const q = String(query || "").trim();
        if (!d || !q)
            return [];
        const max = limit > 0 ? limit : 40;
        const folded = fold(q);
        if (!folded)
            return [];
        const seen = Object.create(null);
        const out = [];
        for (const e of (d.ERAS || [])) {
            if (out.length >= max)
                break;
            const dy = String(e.dynasty || "");
            if (!dy || seen[dy])
                continue;
            const fdy = fold(dy);
            const short = fold(shortDynasty(dy));
            if (fdy.indexOf(folded) < 0 && short.indexOf(folded) < 0 &&
                folded.indexOf(fdy) < 0 && folded.indexOf(short) < 0)
                continue;
            seen[dy] = 1;
            out.push(dy);
        }
        const exact = out.filter(function (dy) {
            const fdy = fold(dy);
            const short = fold(shortDynasty(dy));
            return fdy === folded || short === folded;
        });
        return exact.length ? exact : out;
    }
    function erasOfEmperor(dynasty, emperor) {
        const d = D();
        if (!d)
            return [];
        const dy = String(dynasty || "");
        const em = String(emperor || "");
        const out = [];
        const seen = Object.create(null);
        for (const e of (d.ERAS || [])) {
            if (String(e.dynasty || "") !== dy)
                continue;
            if (String(e.emperor || "") !== em)
                continue;
            const key = e.name + "|" + e.start;
            if (seen[key])
                continue;
            seen[key] = 1;
            out.push(e);
        }
        out.sort(function (x, y) { return (x.start || 0) - (y.start || 0); });
        return out;
    }
    global.EraSearch = {
        search: search,
        extensions: extensions,
        emperors: emperors,
        dynasties: dynasties,
        shortDynasty: shortDynasty,
        erasOfEmperor: erasOfEmperor,
        fragmentOf: fragmentOf,
        stripYearTail: stripYearTail,
        fold: fold
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
