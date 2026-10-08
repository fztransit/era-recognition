(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const R = C.runtime;
    function markSelfMutation() {
        R.lastSelfMutation = Date.now();
    }
    // 插件自己生成的那些节点：标记（含 canvas 覆盖标记）、文内标注、卡片、更正面板、
    // 卡片与面板之间的桥接分组。它们被插进页面同样会产生 MutationRecord，但那不是「正文变了」。
    // 一旦被当成正文变化去重扫，所有标记会被整批重建，正在看的那一处（R.activeMark / R.fixMark）
    // 立刻变成游离节点，更正面板随即被误关 —— 见 content-observer.js 与 content-tooltip.js。
    const GENERATED_SELECTOR = [
        '.' + C.MARK,
        C.CANVAS_MARK ? '.' + C.CANVAS_MARK : '',
        '.' + C.ANNO_CLASS,
        '.' + C.TIP_CLASS,
        '.' + C.FIX_CLASS,
        C.POPUP_GROUP_CLASS ? '.' + C.POPUP_GROUP_CLASS : ''
    ].filter(Boolean).join(',');
    function isGeneratedNode(node) {
        if (!node || !node.closest)
            return false;
        return !!node.closest(GENERATED_SELECTOR);
    }
    function collectTextNodes(root, options) {
        if (!root)
            return [];
        const includeMarks = !!(options && options.includeMarks);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.nodeValue || !node.nodeValue.trim())
                    return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent || C.SKIP_TAGS.has(parent.tagName))
                    return NodeFilter.FILTER_REJECT;
                if (parent.closest('.' + C.ANNO_CLASS) || parent.closest('.' + C.TIP_CLASS) || parent.closest('.' + C.FIX_CLASS))
                    return NodeFilter.FILTER_REJECT;
                if (!includeMarks && parent.closest('.' + C.MARK))
                    return NodeFilter.FILTER_REJECT;
                if (parent.isContentEditable || parent.closest('[contenteditable="true"], [contenteditable=""]')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        let node;
        while ((node = walker.nextNode()))
            nodes.push(node);
        return nodes;
    }
    function normalizeMatches(raw) {
        if (!Array.isArray(raw) || !raw.length)
            return [];
        const sorted = raw.slice().sort(function (a, b) {
            return Number(a.index) - Number(b.index);
        });
        const picked = [];
        let cursor = -1;
        for (const match of sorted) {
            const start = Number(match.index);
            const end = Number(match.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
                continue;
            if (start < cursor)
                continue;
            picked.push(match);
            cursor = end;
        }
        return picked;
    }
    // 标记的唯一键：文本 + 前 6 个字（与 __eraKey 的定义保持一致）
    function eraKeyFor(text, index, end) {
        const s = String(text || '');
        return s.slice(index, end) + '\u0001' + s.slice(Math.max(0, index - 6), index);
    }
    // 用户点过「清除」的片段：认定不是纪年，重新识别时不再建标记
    function isIgnored(text, index, end) {
        const ignores = R.eraIgnores;
        return !!(ignores && ignores[eraKeyFor(text, index, end)]);
    }
    // 标记上「年号那一段」的文字（不含被圈进来的朝代前缀）。
    // 卡片标题、更正面板、纪年解析都只认它 —— 别直接用 mark.textContent，那个可能带「唐」。
    function eraTextOf(mark) {
        if (!mark)
            return '';
        return String(mark.__eraText == null ? (mark.textContent || '') : mark.__eraText).trim();
    }
    function createMark(text, match, source) {
        // match.index / end 永远是「年号那一段」；hlIndex 是可选的「高亮起点」——
        // 把紧挨在年号前面的朝代（含「大」）一起圈进来时它比 index 小（见 content-scanner.js）。
        const eraStart = Number(match.index);
        const eraEnd = Number(match.end);
        const hlStart = Number.isFinite(match.hlIndex) && match.hlIndex < eraStart ? Number(match.hlIndex) : eraStart;
        if (isIgnored(text, eraStart, eraEnd))
            return null;
        const mark = document.createElement('span');
        mark.className = C.MARK + (source === 'ai' ? ' ' + C.AI_CLASS : '');
        mark.setAttribute('data-era-source', source);
        mark.textContent = text.slice(hlStart, eraEnd);
        mark.__eraText = text.slice(eraStart, eraEnd);
        mark.__eraPrefix = text.slice(hlStart, eraStart);
        mark.__eraInfo = Array.isArray(match.info) ? match.info : [];
        mark.__eraRange = !!match.range;
        // 纪年命中时由扫描器通过 hit.n 传入本标记的年数，优先采用。
        // 这里不能要求 __eraInfo 非空：像上文没有任何年号、单独出现的「二年」，
        // 初始虽然没有可判断候选，用户点「更正」后仍必须保留这个「二」。
        // 否则更正到某个年号后就只能回退显示该年号的起止年。
        mark.__eraN = Number.isFinite(match.n)
            ? match.n
            : (mark.__eraInfo[0] && Number.isFinite(mark.__eraInfo[0].n) ? mark.__eraInfo[0].n : null);
        mark.__eraGz = match.gz || null;
        mark.__eraDynasty = mark.__eraInfo[0] && mark.__eraInfo[0].dynasty ? String(mark.__eraInfo[0].dynasty) : '';
        if (mark.__eraDynasty)
            mark.setAttribute('data-era-dynasty', mark.__eraDynasty);
        // 键用「年号那一段」算，不用高亮那一段：加了朝代前缀也不会让用户之前存的更正失效。
        mark.__eraKey = eraKeyFor(text, eraStart, eraEnd);
        return mark;
    }
    // 把单个标记摘掉、还原成普通文本（连同它后面的文内标注）。用于卡片上的「清除」。
    function removeMark(mark) {
        if (!mark || !mark.parentNode)
            return false;
        const parent = mark.parentNode;
        C.markSelfMutation();
        const next = mark.nextElementSibling;
        if (next && next.classList && next.classList.contains(C.ANNO_CLASS))
            next.remove();
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        try {
            parent.normalize();
        }
        catch (e) { }
        return true;
    }
    function applyMarks(root, finder, source) {
        if (!root || typeof finder !== 'function')
            return 0;
        let count = 0;
        for (const node of collectTextNodes(root)) {
            if (!node.isConnected)
                continue;
            const text = node.nodeValue || '';
            if (text.length < 2)
                continue;
            let raw = [];
            try {
                raw = finder(text) || [];
            }
            catch (e) {
                raw = [];
            }
            const matches = normalizeMatches(raw);
            if (!matches.length || !node.parentNode)
                continue;
            const frag = document.createDocumentFragment();
            let last = 0;
            for (const match of matches) {
                // 高亮起点可能比年号起点靠左（圈进了朝代前缀），切片要用它，
                // 否则朝代那两个字会被切两遍（普通文本里一遍、标记里再一遍）。
                // 再夹一道 last：万一前缀和上一个标记的范围重叠，也不能把文字复制一遍。
                const start = Math.max(last, Number.isFinite(match.hlIndex) && match.hlIndex < match.index
                    ? match.hlIndex : match.index);
                if (start > last)
                    frag.appendChild(document.createTextNode(text.slice(last, start)));
                const mark = createMark(text, match, source);
                if (mark) {
                    frag.appendChild(mark);
                    count++;
                }
                else {
                    // 被「清除」过的片段：原样保留文本
                    frag.appendChild(document.createTextNode(text.slice(start, match.end)));
                }
                last = match.end;
            }
            if (last < text.length)
                frag.appendChild(document.createTextNode(text.slice(last)));
            markSelfMutation();
            node.parentNode.replaceChild(frag, node);
        }
        return count;
    }
    function clearMarks(root) {
        const scope = root || document.body;
        if (!scope)
            return 0;
        const marks = Array.from(scope.querySelectorAll('.' + C.MARK));
        const annos = Array.from(scope.querySelectorAll('.' + C.ANNO_CLASS));
        if (!marks.length && !annos.length)
            return 0;
        const parents = new Set();
        annos.forEach(function (anno) {
            if (anno.parentNode) {
                parents.add(anno.parentNode);
                anno.parentNode.removeChild(anno);
            }
        });
        marks.forEach(function (mark) {
            if (mark.parentNode) {
                parents.add(mark.parentNode);
                mark.parentNode.replaceChild(document.createTextNode(mark.textContent || ''), mark);
            }
        });
        markSelfMutation();
        parents.forEach(function (parent) {
            try {
                parent.normalize();
            }
            catch (e) { }
        });
        return marks.length;
    }
    C.markSelfMutation = markSelfMutation;
    C.isGeneratedNode = isGeneratedNode;
    C.collectTextNodes = collectTextNodes;
    C.eraKeyFor = eraKeyFor;
    C.isIgnored = isIgnored;
    C.createMark = createMark;
    C.eraTextOf = eraTextOf;
    C.removeMark = removeMark;
    C.applyMarks = applyMarks;
    C.clearMarks = clearMarks;
})(typeof globalThis !== 'undefined' ? globalThis : self);
