(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const D = C.D;
    const R = C.runtime;
    const FIX_MAX = 40;
    function ensurePopupGroup() {
        if (R.popupGroupEl && R.popupGroupEl.isConnected)
            return R.popupGroupEl;
        const group = document.createElement('div');
        group.className = C.POPUP_GROUP_CLASS;
        group.hidden = true;
        group.addEventListener('mouseenter', function () {
            R.popupGroupHovered = true;
            R.tooltipHovered = true;
            C.cancelHide();
        });
        group.addEventListener('mouseleave', function (event) {
            R.popupGroupHovered = false;
            R.tooltipHovered = false;
            if (pointerOutsidePopupGroup(event))
                hideFixPanel();
        });
        (document.body || document.documentElement).appendChild(group);
        R.popupGroupEl = group;
        return group;
    }
    // 「卡片 + 更正面板」的共同区域 = era-hl-popup-group 那块透明外接矩形。
    // 鼠标还落在里面（含从卡片走向面板的途中）就什么都不做；一旦移出，两个一起收。
    //
    // 注意：不能只靠 group 自己的 mouseleave —— group 在卡片/面板**下面**（z-index 更低），
    // 指针停在卡片上时 group 根本不算被「进入」，从卡片直接移到正文不会触发它的 mouseleave，
    // 于是面板就赖着不走。所以卡片的 mouseleave、面板的 mouseleave 也都来问这一份判断。
    function pointerOutsidePopupGroup(event) {
        if (!isFixPanelOpen())
            return false;
        const x = Number(event && event.clientX);
        const y = Number(event && event.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return false;
        const rect = popupUnionRect();
        if (!rect)
            return false;
        return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
    }
    // 共同区域的矩形：优先用 group 已经算好的（positionPopupGroup 里铺的）；
    // group 还没铺开时退回自己把卡片和面板并起来 —— 同一块区域，同一个语义。
    function popupUnionRect() {
        const group = R.popupGroupEl;
        if (group && group.isConnected && !group.hidden) {
            const rect = group.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0)
                return rect;
        }
        const rects = [];
        for (const el of [R.tooltipEl, R.fixEl]) {
            if (el && el.isConnected && !el.hidden)
                rects.push(el.getBoundingClientRect());
        }
        if (!rects.length)
            return null;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const r of rects) {
            left = Math.min(left, r.left);
            top = Math.min(top, r.top);
            right = Math.max(right, r.right);
            bottom = Math.max(bottom, r.bottom);
        }
        return { left, top, right, bottom };
    }
    function positionPopupGroup() {
        const group = ensurePopupGroup();
        const tip = R.tooltipEl;
        const fix = R.fixEl;
        const tipVisible = !!(tip && tip.isConnected && !tip.hidden);
        const fixVisible = !!(fix && fix.isConnected && !fix.hidden);
        if (!tipVisible || !fixVisible) {
            group.hidden = true;
            group.style.width = '';
            group.style.height = '';
            group.style.left = '';
            group.style.top = '';
            return;
        }
        const tipRect = tip.getBoundingClientRect();
        const fixRect = fix.getBoundingClientRect();
        const left = Math.min(tipRect.left, fixRect.left);
        const right = Math.max(tipRect.right, fixRect.right);
        const top = Math.min(tipRect.top, fixRect.top);
        const bottom = Math.max(tipRect.bottom, fixRect.bottom);
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);
        group.hidden = false;
        group.style.left = left + 'px';
        group.style.top = top + 'px';
        group.style.width = width + 'px';
        group.style.height = height + 'px';
    }
    function hidePopupGroup() {
        R.popupGroupHovered = false;
        if (!R.popupGroupEl)
            return;
        R.popupGroupEl.hidden = true;
        R.popupGroupEl.style.width = '';
        R.popupGroupEl.style.height = '';
        R.popupGroupEl.style.left = '';
        R.popupGroupEl.style.top = '';
    }
    function ensureFixPanel() {
        if (R.fixEl && R.fixEl.isConnected)
            return R.fixEl;
        const panel = document.createElement('div');
        panel.className = C.FIX_CLASS;
        panel.hidden = true;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'era-hl-fix-input';
        input.placeholder = '输入年号 / 朝代 / 帝号';
        input.spellcheck = false;
        input.autocomplete = 'off';
        const list = document.createElement('div');
        list.className = 'era-hl-fix-list';
        panel.append(input, list);
        input.addEventListener('input', function () {
            renderFixOptions(input.value);
        });
        list.addEventListener('click', function (event) {
            const row = event.target && event.target.closest ? event.target.closest('.era-hl-fix-row') : null;
            if (!row || !R.activeMark)
                return;
            event.preventDefault();
            event.stopPropagation();
            if (row.getAttribute('data-kind') === 'era') {
                const era = row.getAttribute('data-era') || '';
                input.value = era;
                renderFixOptions(era);
                return;
            }
            applyEraFix(R.activeMark, {
                name: row.getAttribute('data-era') || '',
                dynasty: row.getAttribute('data-dynasty') || '',
                emperor: row.getAttribute('data-emperor') || ''
            });
        });
        panel.addEventListener('mouseenter', function () {
            R.popupGroupHovered = true;
            R.tooltipHovered = true;
            C.cancelHide();
        });
        panel.addEventListener('mouseleave', function (event) {
            R.popupGroupHovered = false;
            R.tooltipHovered = false;
            // 从面板移到卡片上时指针还在共同区域里，不会收；移到正文才两个一起收。
            if (pointerOutsidePopupGroup(event))
                hideFixPanel();
        });
        (document.body || document.documentElement).appendChild(panel);
        R.fixEl = panel;
        return panel;
    }
    function isFixPanelOpen() {
        return !!(R.fixEl && R.fixEl.isConnected && !R.fixEl.hidden);
    }
    function precedingEras(mark) {
        if (!mark)
            return [];
        const seen = new Set();
        const result = [];
        const selector = '.' + C.MARK + (C.CANVAS_MARK ? ',.' + C.CANVAS_MARK : '');
        for (const current of document.querySelectorAll(selector)) {
            if (current === mark || current.__eraKey === mark.__eraKey)
                break;
            const info = current.__eraInfo && current.__eraInfo[0];
            const era = info && info.era;
            if (!era || seen.has(era))
                continue;
            seen.add(era);
            result.push(era);
        }
        return result.reverse().slice(0, 20);
    }
    function renderEraSuggestions() {
        const panel = ensureFixPanel();
        const box = panel.querySelector('.era-hl-fix-list');
        box.textContent = '';
        precedingEras(R.activeMark).forEach(function (era) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'era-hl-fix-row';
            row.dataset.kind = 'era';
            row.dataset.era = era;
            row.textContent = era;
            box.appendChild(row);
        });
        if (C.positionPopupGroup)
            C.positionPopupGroup();
    }
    const RANGE_FORM = D.RANGE_FORM;
    // 「…年」/「…甲子年」这类纪年尾巴；干支继续保留。
    const GANZHI_TAIL = '[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]';
    const CHRONO_TAIL = new RegExp('^(?:' + D.YEAR_NUM_PART + '|' + GANZHI_TAIL + ')年$');
    // 年号后面那一截可以是什么：空（整个标记就是年号，如「改元永興」）、
    // 纪年（「建元三年」）、范围写法（「永興年間 / 貞觀中」）。
    // 少了后两种，「永興年間」这类标记点更正后输入框和候选都是空的。
    function eraTailAccepted(tail) {
        if (!tail)
            return true;
        return CHRONO_TAIL.test(tail) || RANGE_FORM.test(tail);
    }
    function completeEraInput(mark) {
        // 只认「年号那一段」：高亮可能把「唐」也圈进来了，拿 textContent 会认不出年号。
        const raw = C.eraTextOf(mark);
        if (!raw)
            return '';
        const list = Array.isArray(mark && mark.__eraInfo) ? mark.__eraInfo : [];
        for (const item of list) {
            const name = String(item && (item.input || item.era) || '').trim();
            if (!name || raw.slice(0, name.length) !== name)
                continue;
            if (eraTailAccepted(raw.slice(name.length).trim()))
                return name;
        }
        return '';
    }
    function chronologyOnly(mark) {
        const raw = C.eraTextOf(mark);
        // 只有纪年、没有年号的片段：标准中文数字或干支。
        return new RegExp('^(?:' + D.CN_YEAR_PART + '|' + GANZHI_TAIL + ')年$').test(raw);
    }
    function prepareFixInput(mark) {
        const panel = ensureFixPanel();
        const input = panel.querySelector('.era-hl-fix-input');
        if (!input)
            return;
        const seed = completeEraInput(mark);
        input.value = seed;
        if (seed)
            renderFixOptions(seed);
        else if (chronologyOnly(mark))
            renderEraSuggestions();
        else
            renderFixOptions('');
    }
    function renderFixOptions(query) {
        const panel = ensureFixPanel();
        const box = panel.querySelector('.era-hl-fix-list');
        box.textContent = '';
        const value = String(query || '').trim();
        if (!value)
            return;
        const search = global.EraSearch;
        const rows = search && typeof search.search === 'function' ? search.search(value, FIX_MAX) : [];
        rows.forEach(function (item) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'era-hl-fix-row';
            row.dataset.era = item.name || '';
            row.dataset.dynasty = item.dynasty || '';
            row.dataset.emperor = item.emperor || '';
            row.textContent = D.whoText(item.dynasty, item.emperor, item.name);
            box.appendChild(row);
        });
        if (!box.children.length) {
            const empty = document.createElement('div');
            empty.className = 'era-hl-fix-hint';
            empty.textContent = '没找到这个年号';
            box.appendChild(empty);
        }
        if (C.positionPopupGroup)
            C.positionPopupGroup();
    }
    function positionFixPanel() {
        if (!isFixPanelOpen() || !R.tooltipEl)
            return;
        const target = R.tooltipEl.getBoundingClientRect();
        const panel = R.fixEl;
        panel.hidden = false;
        panel.style.visibility = 'hidden';
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        let left = target.right;
        if (left + width > window.innerWidth - 6)
            left = target.left - width;
        left = Math.max(6, Math.min(left, window.innerWidth - width - 6));
        const top = Math.max(4, Math.min(target.top, window.innerHeight - height - 4));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.visibility = 'visible';
        positionPopupGroup();
    }
    function showFixPanel() {
        const panel = ensureFixPanel();
        R.fixOpen = true;
        panel.hidden = false;
        positionFixPanel();
        const input = panel.querySelector('.era-hl-fix-input');
        if (input)
            input.focus();
    }
    function closeFixPanelOnly() {
        R.fixOpen = false;
        R.fixMark = null;
        if (R.fixEl) {
            R.fixEl.hidden = true;
            R.fixEl.style.visibility = '';
        }
        hidePopupGroup();
    }
    function hideFixPanel() {
        closeFixPanelOnly();
        C.hideTooltip();
    }
    function applyEraFix(mark, row) {
        if (!mark || !mark.__eraKey || !row || !row.name)
            return;
        const key = mark.__eraKey;
        R.eraFixes[key] = {
            era: row.name,
            dynasty: row.dynasty || '',
            emperor: row.emperor || ''
        };
        // 裸的「二年」最初没有 __eraInfo，因此更正前 mark.__eraN 可能为空。
        // 一旦更正到具体年号，就必须把正文中的年数补回标记，否则候选只能显示年号起止年。
        if (!Number.isFinite(mark.__eraN) && !mark.__eraGz && chronologyOnly(mark)) {
            const m = new RegExp('^(' + D.CN_YEAR_PART + ')年$').exec(C.eraTextOf(mark));
            if (m) {
                const n = m[1] === '元' ? 1 : D.cnToNumber(m[1]);
                if (Number.isFinite(n))
                    mark.__eraN = n;
            }
        }
        delete R.overrides[key];
        C.saveOverrides();
        try {
            C.refreshEraContext(document.body);
            C.refreshAnnotations(document.body);
        }
        catch (e) { }
        if (typeof C.refreshCanvasEraMarks === 'function') {
            try { C.refreshCanvasEraMarks(); } catch (e) { }
        }
        C.refreshTooltipAfterRebuild(key);
        positionFixPanel();
    }
    document.addEventListener('mousedown', function (event) {
        if (!isFixPanelOpen())
            return;
        const target = event.target;
        if (target && target.closest && (target.closest('.' + C.FIX_CLASS) || target.closest('.' + C.TIP_CLASS) || target.closest('.' + C.POPUP_GROUP_CLASS)))
            return;
        hideFixPanel();
    }, true);
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && isFixPanelOpen())
            hideFixPanel();
    });
    C.ensureFixPanel = ensureFixPanel;
    C.isFixPanelOpen = isFixPanelOpen;
    C.renderEraSuggestions = renderEraSuggestions;
    C.completeEraInput = completeEraInput;
    C.chronologyOnly = chronologyOnly;
    C.prepareFixInput = prepareFixInput;
    C.renderFixOptions = renderFixOptions;
    C.positionFixPanel = positionFixPanel;
    C.positionPopupGroup = positionPopupGroup;
    C.pointerOutsidePopupGroup = pointerOutsidePopupGroup;
    C.hidePopupGroup = hidePopupGroup;
    C.showFixPanel = showFixPanel;
    C.closeFixPanelOnly = closeFixPanelOnly;
    C.hideFixPanel = hideFixPanel;
    C.applyEraFix = applyEraFix;
})(typeof globalThis !== 'undefined' ? globalThis : self);
