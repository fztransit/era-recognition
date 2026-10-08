(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const D = C.D;
    const R = C.runtime;
    const HIDE_DELAY = 260;
    // 单击 / 双击方式下：点过年号之后进入「跟随悬浮」状态 ——
    // 鼠标停在年号或卡片上就保持显示，移开即消失（不是再点一次才消失）。
    let triggerActive = false;
    function tooltipVisible() {
        return !!(R.tooltipEl && !R.tooltipEl.hidden);
    }
    function ensureTooltip() {
        if (R.tooltipEl && R.tooltipEl.isConnected)
            return R.tooltipEl;
        document.querySelectorAll('.' + C.TIP_CLASS).forEach(function (node) { node.remove(); });
        const tip = document.createElement('div');
        tip.className = C.TIP_CLASS;
        tip.setAttribute('role', 'tooltip');
        tip.hidden = true;
        bindTooltipHover(tip);
        (document.body || document.documentElement).appendChild(tip);
        R.tooltipEl = tip;
        return tip;
    }
    // 年号不从元年开始计数时（表里第 6 列），起点年后面补一个「(n)」：
    // 光写「968-973年」会让人以为 968 就是元年，其实它已经是第 12 年。
    // 例：北漢英武帝天會 → 968(12)-973年。
    function epochMark(info) {
        const off = Number(info && info.eraOffset);
        return Number.isFinite(off) && off > 1 ? '(' + Math.floor(off) + ')' : '';
    }
    // 只有起止年的那一段文本（不含「？」/「约」之外的判断）。
    function rangeText(info) {
        if (!info || !Number.isFinite(info.eraStart))
            return '';
        const epoch = epochMark(info);
        if (Number.isFinite(info.eraEnd) && info.eraEnd > info.eraStart) {
            return D.formatYearApprox(info.eraStart) + epoch + '-' + D.formatYearApprox(info.eraEnd) + '年';
        }
        return D.formatYearApprox(info.eraStart) + epoch + '年';
    }
    function fmtRange(info) {
        if (!info)
            return '';
        // 起止年任一端不可考（表里为 null）→「？」。
        if (typeof C.eraYearsKnown === 'function' && !C.eraYearsKnown(info))
            return '？';
        // 前 841 年（共和元年）之前的年份各加一个「约」。
        if (!Number.isFinite(info.eraStart)) {
            return Number.isFinite(info.gregorian) ? D.formatYearApprox(info.gregorian) + '年' : '';
        }
        return rangeText(info);
    }
    function fmtEraFootRange(info) {
        if (!info)
            return '';
        // 明确写出年号、但干支超出该年号有效范围时，foot 仍显示年号本身的起止年。
        if (!info.ganzhiOutOfRange)
            return fmtRange(info);
        return rangeText(info);
    }
    // 帝号和年号同名时（「西漢·高祖·高祖」）只写一个 —— 见 eras.js 的 whoText。
    function tipTitle(info) {
        return D.whoText(info && info.dynasty, info && info.emperor, info && (info.input || info.era));
    }
    function buildTooltipContent(mark) {
        const tip = ensureTooltip();
        tip.textContent = '';
        const list = C.candidatesOf(mark);
        const pickedIndex = C.pickIndex(mark);
        const picked = pickedIndex >= 0 ? list[pickedIndex] : null;
        // 「正 / AI」来源角标：放在标题左侧（以前在 foot 最左边，那个位置现在归「清除」）。
        const source = document.createElement('span');
        source.className = 'era-hl-tip-src';
        const isAi = mark.getAttribute('data-era-source') === 'ai';
        source.textContent = isAi ? 'AI' : '正';
        source.title = isAi ? 'AI 识别' : '正则识别';
        const head = document.createElement('div');
        head.className = 'era-hl-tip-head';
        head.appendChild(source);
        const title = document.createElement('span');
        title.className = 'era-hl-tip-title';
        title.textContent = C.tipTitleFor(mark, picked || list[0]);
        head.appendChild(title);
        if (R.eraFixes[mark.__eraKey] || R.overrides[mark.__eraKey] !== undefined) {
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'era-hl-tip-reset';
            reset.title = '恢复默认识别结果';
            reset.textContent = '↺';
            head.appendChild(reset);
        }
        const gz = document.createElement('span');
        gz.className = 'era-hl-tip-gz';
        head.appendChild(gz);
        tip.appendChild(head);
        if (!list.length) {
            // 认不出是哪个年号：给一行提示。「更正」统一放在 foot 里（和「清除」并排），
            // 这里不再单独放一个，免得出现两个「更正」。
            const empty = document.createElement('div');
            empty.className = 'era-hl-tip-none';
            const text = document.createElement('span');
            text.className = 'era-hl-tip-none-text';
            text.textContent = '无法判断，点击更正按钮设置';
            empty.appendChild(text);
            tip.appendChild(empty);
        }
        else {
            const order = list.map(function (_, index) { return index; }).sort(function (a, b) {
                const ay = Number.isFinite(list[a].gregorian) ? list[a].gregorian : list[a].eraStart;
                const by = Number.isFinite(list[b].gregorian) ? list[b].gregorian : list[b].eraStart;
                return (Number.isFinite(ay) ? ay : Infinity) - (Number.isFinite(by) ? by : Infinity);
            });
            order.forEach(function (index) {
                const info = list[index];
                const row = document.createElement('div');
                row.className = 'era-hl-tip-row';
                row.dataset.idx = String(index);
                const era = document.createElement('span');
                era.className = 'era-hl-tip-era';
                era.textContent = D.whoText(info.dynasty, info.emperor, info.era);
                const year = document.createElement('span');
                year.className = 'era-hl-tip-year';
                if (list.length > 1)
                    year.title = '双击选择这一年';
                const isRange = !!mark.__eraRange;
                // 起止年任一端不可考 → 不换算公历年，交给 fmtRange() 显示「？」。
                const known = typeof C.eraYearsKnown === 'function' ? C.eraYearsKnown(info) : true;
                const gregorian = (isRange || !known) ? null : C.yearOf(info, mark.__eraN, mark.__eraGz);
                if (Number.isFinite(gregorian)) {
                    // 前 841 年（共和元年）之前加「约」，与 fmtRange()/文内标注保持一致。
                    // 算出来的年份超出该年号起止范围时不再加「？」，用户自己看行里的起止年判断。
                    year.textContent = D.formatYearApprox(gregorian) + '年';
                }
                else if (info.ganzhiOutOfRange) {
                    // 年号明确，但干支不属于该年号范围：具体年份未知，只显示「？」。
                    year.textContent = '？';
                    year.classList.add('era-hl-tip-year-dim');
                }
                else {
                    year.textContent = fmtRange(info) || '—';
                    year.classList.add('era-hl-tip-year-dim');
                }
                if (list.length > 1 && info !== picked)
                    year.classList.add('era-hl-tip-year-alt');
                row.append(era, year);
                tip.appendChild(row);
            });
        }
        const foot = document.createElement('div');
        foot.className = 'era-hl-tip-foot';
        // 候选为空时没有可选中的条目，这一格留空（不建 span，免得白占一个 flex 间隙）。
        const chosen = picked || list[0] || null;
        const detailText = chosen
            ? [chosen.era || chosen.input || '', fmtEraFootRange(chosen)].filter(Boolean).join('：')
            : '';
        if (detailText) {
            const detail = document.createElement('span');
            detail.textContent = detailText;
            foot.appendChild(detail);
        }
        // 「清除」固定在「更正」左侧，**任何情况都出现**：去掉这一处标记，并记进本页「已清除」，
        // 以后重新识别不再标它（见 content-marker.js 的 isIgnored）。
        // 注意：点击后会弹浏览器原生确认框，确认了才真的清除（见 confirmClearMark）。
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'era-hl-tip-clear';
        clear.title = '这不是年号 —— 去掉这个标记，以后不再标记它';
        clear.textContent = '清除';
        foot.appendChild(clear);
        const fixButton = document.createElement('button');
        fixButton.type = 'button';
        fixButton.className = 'era-hl-tip-fixbtn';
        fixButton.textContent = '更正';
        fixButton.title = '设置正确的年号';
        foot.appendChild(fixButton);
        tip.appendChild(foot);
        // 起止年不可考时不显示干支：干支和「？」说的是同一份信息，不能自相矛盾。
        // 候选为空（chosen 为 null）时同样不显示。
        if (chosen) {
            const chosenKnown = typeof C.eraYearsKnown === 'function' ? C.eraYearsKnown(chosen) : true;
            const ganzhi = D.ganzhiOf(chosenKnown ? C.yearOf(chosen, mark.__eraN, mark.__eraGz) : null);
            if (ganzhi) {
                gz.textContent = ganzhi;
                gz.title = '这一年的干支';
            }
        }
        return tip;
    }
    function positionTooltip(mark) {
        const tip = ensureTooltip();
        if (!mark || !mark.isConnected)
            return;
        let rect = mark.getBoundingClientRect();
        if (mark.getClientRects) {
            const rects = mark.getClientRects();
            if (rects && rects.length > 1)  // 遇换行以首字定位
                rect = rects[0];  // rects.length-1第二行首字，0第一行首字
        }
        tip.hidden = false;
        tip.style.visibility = 'hidden';
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        let left = rect.left + rect.width / 2 - width / 2;
        const firstChar = mark.querySelector(':scope > .era-hl-canvas-char');
        if (firstChar)  // 遇换行以首字定位
            left = rect.left + parseFloat(firstChar.style.left || '0')
                 + parseFloat(firstChar.style.width || '0') / 2 - width / 2;
        let top = rect.top - height - 2;
        if (top < 4)
            top = rect.bottom + 2;
        left = Math.max(6, Math.min(left, window.innerWidth - width - 6));
        top = Math.max(4, Math.min(top, window.innerHeight - height - 4));
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        tip.style.visibility = 'visible';
        tip.classList.add('era-hl-tip-on');
        if (C.positionFixPanel)
            C.positionFixPanel();
        else if (C.positionPopupGroup)
            C.positionPopupGroup();
    }
    // 更正面板认的是「哪一处纪年」，不是某个 DOM 节点。
    // 重扫 / canvas 重绘会把标记整批重建：元素换了、__eraKey 不变，面板必须继续跟着。
    // 只按元素比较（旧的 `R.fixMark !== mark`）时，重建后第一次 showTooltip() 就会把面板关掉 ——
    // 面板会不会消失取决于那几百毫秒里有没有发生重建，于是表现成「有时消失、有时不消失」。
    function fixPanelAnchoredTo(mark) {
        const fix = R.fixMark;
        if (!fix || !mark)
            return false;
        if (fix === mark)
            return true;
        return !!(fix.__eraKey && mark.__eraKey && fix.__eraKey === mark.__eraKey);
    }
    function showTooltip(mark) {
        if (!mark)
            return;
        if (C.isFixPanelOpen && C.isFixPanelOpen() && R.fixMark) {
            if (fixPanelAnchoredTo(mark) || (!R.fixMark.isConnected && mark.isConnected))
                R.fixMark = mark;   // 同一处、只是元素被重建过：跟上新元素，面板继续开着
            else
                C.closeFixPanelOnly();
        }
        buildTooltipContent(mark);
        positionTooltip(mark);
    }
    function cancelHide() {
        if (R.hideTimer) {
            clearTimeout(R.hideTimer);
            R.hideTimer = null;
        }
    }
    function canHitTest() {
        return typeof document.elementsFromPoint === 'function' || typeof document.elementFromPoint === 'function';
    }
    function markSelector() {
        return '.' + C.MARK + (C.CANVAS_MARK ? ',.' + C.CANVAS_MARK : '');
    }
    function markFromEvent(target) {
        if (!target || !target.closest)
            return null;
        const mark = target.closest(markSelector());
        if (mark)
            return mark;
        const anno = target.closest('.' + C.ANNO_CLASS);
        if (!anno)
            return null;
        const previous = anno.previousElementSibling;
        return previous && previous.classList.contains(C.MARK) ? previous : null;
    }
    function markAtPoint(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return null;
        let stack = null;
        try {
            stack = document.elementsFromPoint
                ? document.elementsFromPoint(x, y)
                : document.elementFromPoint ? [document.elementFromPoint(x, y)] : null;
        }
        catch (e) { }
        if (!stack)
            return null;
        for (const element of stack) {
            if (element && element.closest && (element.closest('.' + C.TIP_CLASS) || element.closest('.' + C.FIX_CLASS)))
                return null;
        }
        for (const element of stack) {
            const mark = markFromEvent(element);
            if (mark)
                return mark;
        }
        return null;
    }
    function hideTooltip() {
        if (C.isFixPanelOpen && C.isFixPanelOpen())
            return;
        cancelHide();
        R.tooltipHovered = false;
        R.popupGroupHovered = false;
        R.activeMark = null;
        triggerActive = false;
        if (R.tooltipEl) {
            R.tooltipEl.classList.remove('era-hl-tip-on');
            R.tooltipEl.hidden = true;
            R.tooltipEl.style.visibility = '';
        }
    }
    function refindActiveMark(key) {
        if (R.activeMark && R.activeMark.isConnected)
            return R.activeMark;
        if (!key)
            return R.activeMark;
        for (const mark of document.querySelectorAll(markSelector())) {
            if (mark.__eraKey === key) {
                R.activeMark = mark;
                return mark;
            }
        }
        return R.activeMark;
    }
    function refreshTooltipAfterRebuild(key) {
        refindActiveMark(key);
        if (R.activeMark && R.activeMark.isConnected) {
            showTooltip(R.activeMark);
        }
    }
    function applyPick(mark, index) {
        const list = mark && mark.__eraInfo;
        if (!Array.isArray(list) || !list[index] || !mark.__eraKey)
            return;
        R.overrides[mark.__eraKey] = index;
        C.saveOverrides();
        C.refreshEraContext(document.body);
        const key = mark.__eraKey;
        try {
            C.refreshAnnotations(document.body);
        }
        catch (e) { }
        if (typeof C.refreshCanvasEraMarks === 'function') {
            try { C.refreshCanvasEraMarks(); } catch (e) { }
        }
        refreshTooltipAfterRebuild(key);
    }
    // 单击「清除」时弹的浏览器原生确认框。这个动作不可撤销：标记会被记进本页「已清除」，
    // 之后重新识别也不再标它，只有扩展弹窗里的「正则重置」能找回来（但它会清空本页全部记录）。
    const CLEAR_CONFIRM = '确认清除当前标记？\n清除后如需恢复，需要点击扩展弹窗的「正则重置」，这会清除页面其他缓存。';
    function confirmClearMark() {
        const mark = R.activeMark;
        if (!mark)
            return;
        // 原生 confirm 是阻塞的：返回 false（取消）时什么都不做。
        if (!window.confirm(CLEAR_CONFIRM))
            return;
        // 确认后可能已经被清掉了（例如双击时第二次 click 排在 confirm 之后才跑到），再查一次。
        if (R.activeMark !== mark)
            return;
        // 先记进「已清除」，再去掉标记 —— 这样紧接着的重扫不会又把它标出来。
        if (mark.__eraKey)
            R.eraIgnores[mark.__eraKey] = true;
        C.saveOverrides();
        R.activeMark = null;
        if (C.CANVAS_MARK && mark.classList.contains(C.CANVAS_MARK) && typeof C.removeCanvasMark === 'function')
            C.removeCanvasMark(mark);
        else
            C.removeMark(mark);
        // 标记已经摘掉了，更正面板不能再留着（hideTooltip() 在面板打开时是直接返回的）。
        if (C.closeFixPanelOnly)
            C.closeFixPanelOnly();
        C.hideTooltip();
    }
    function scheduleHide() {
        if (R.tooltipHovered || R.popupGroupHovered || (C.isFixPanelOpen && C.isFixPanelOpen()))
            return;
        cancelHide();
        R.hideTimer = setTimeout(function () {
            R.hideTimer = null;
            if (R.tooltipHovered || R.popupGroupHovered || (C.isFixPanelOpen && C.isFixPanelOpen()))
                return;
            const mark = markAtPoint(R.pointerX, R.pointerY);
            if (mark) {
                R.activeMark = mark;
                showTooltip(mark);
                return;
            }
            hideTooltip();
        }, HIDE_DELAY);
    }
    function reanchorTooltip() {
        if (!R.activeMark || R.activeMark.isConnected)
            return;
        const mark = markAtPoint(R.pointerX, R.pointerY);
        if (mark) {
            R.activeMark = mark;
            showTooltip(mark);
        }
        else if (canHitTest() && !R.tooltipHovered) {
            hideTooltip();
        }
    }
    function bindTooltipHover(tip) {
        tip.addEventListener('click', function (event) {
            const target = event.target;
            const reset = target && target.closest ? target.closest('.era-hl-tip-reset') : null;
            if (reset && R.activeMark) {
                event.preventDefault();
                event.stopPropagation();
                const key = R.activeMark.__eraKey;
                delete R.eraFixes[key];
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
                refreshTooltipAfterRebuild(key);
                return;
            }
            const clearButton = target && target.closest ? target.closest('.era-hl-tip-clear') : null;
            if (clearButton) {
                if (!R.activeMark)
                    return;
                event.preventDefault();
                event.stopPropagation();
                // 单击就弹原生确认框；确认了才真的清除。
                confirmClearMark();
                return;
            }
            const fixButton = target && target.closest ? target.closest('.era-hl-tip-fixbtn') : null;
            if (fixButton) {
                if (!R.activeMark)
                    return;
                event.preventDefault();
                event.stopPropagation();
                if (C.isFixPanelOpen && C.isFixPanelOpen()) {
                    // 再点一次「更正」：只收起更正面板，卡片继续显示。
                    C.closeFixPanelOnly();
                    return;
                }
                R.fixMark = R.activeMark;
                C.prepareFixInput(R.fixMark);
                C.showFixPanel();
                return;
            }
            // 点在卡片其它地方（标题、候选行…）：同样只收起更正面板，卡片留着。
            if (C.isFixPanelOpen && C.isFixPanelOpen())
                C.closeFixPanelOnly();
        });
        tip.addEventListener('dblclick', function (event) {
            const year = event.target && event.target.closest ? event.target.closest('.era-hl-tip-year') : null;
            if (!year || !R.activeMark)
                return;
            const row = year.closest('.era-hl-tip-row');
            const total = Array.isArray(R.activeMark.__eraInfo) ? R.activeMark.__eraInfo.length : 0;
            if (!row || total < 2)
                return;
            event.preventDefault();
            event.stopPropagation();
            const index = Number(row.dataset.idx);
            if (Number.isFinite(index))
                applyPick(R.activeMark, index);
        });
        tip.addEventListener('mouseenter', function () {
            R.popupGroupHovered = true;
            R.tooltipHovered = true;
            cancelHide();
        });
        tip.addEventListener('mouseleave', function (event) {
            R.popupGroupHovered = false;
            R.tooltipHovered = false;
            if (C.isFixPanelOpen && C.isFixPanelOpen()) {
                // 面板开着时，指针只要还在「卡片 + 面板」的共同区域里（比如正走向面板）就不收；
                // 移出共同区域则两个一起收 —— 判据和桥接分组共用一份（见 content-correction.js）。
                if (C.pointerOutsidePopupGroup && C.pointerOutsidePopupGroup(event))
                    C.hideFixPanel();
                return;
            }
            scheduleHide();
        });
    }
    function repositionSoon() {
        if (!R.activeMark || R.repositionRaf)
            return;
        R.repositionRaf = requestAnimationFrame(function () {
            R.repositionRaf = 0;
            if (!R.activeMark)
                return;
            const mark = R.activeMark.isConnected ? R.activeMark : markAtPoint(R.pointerX, R.pointerY);
            if (!mark) {
                hideTooltip();
                return;
            }
            if (mark !== R.activeMark) {
                R.activeMark = mark;
                showTooltip(mark);
                return;
            }
            positionTooltip(mark);
        });
    }
    // 卡片触发方式：hover=鼠标移上去 / click=单击（默认）/ longpress=按住一会儿。
    // 在「设置 → 自定义设置 → 弹框触发方式」里改；读的是 R.settings，改完立即生效。
    const TRIGGER_MODES = ['hover', 'click', 'longpress'];
    function triggerMode() {
        let value = String((R.settings && R.settings.tooltipTrigger) || 'click');
        // 老版本存的 'dblclick' 已下线（双击在链接上修不好，见下面长按那段注释）——
        // 当成新的 longpress，别让老设置静默掉回「单击」。
        if (value === 'dblclick')
            value = 'longpress';
        return TRIGGER_MODES.indexOf(value) >= 0 ? value : 'click';
    }
    // 是否处于「跟随鼠标」状态：悬浮模式一直算；单击 / 长按模式要触发过一次之后才算。
    function hoverFollowing() {
        return triggerMode() === 'hover' || triggerActive;
    }
    // 单击 / 长按命中：显示卡片并进入跟随悬浮状态。
    // 注意：再点一次不会收起 —— 只有鼠标移开年号与卡片才收起。
    function activate(mark, event) {
        if (!mark)
            return;
        // 用户明确点了另一处年号：更正面板跟着换目标（面板只会因为「换了目标」而关，
        // 不会因为标记被重建而关 —— 见 fixPanelAnchoredTo）。
        if (C.isFixPanelOpen && C.isFixPanelOpen() && R.fixMark && !fixPanelAnchoredTo(mark))
            C.closeFixPanelOnly();
        if (event && Number.isFinite(event.clientX)) {
            R.pointerX = event.clientX;
            R.pointerY = event.clientY;
        }
        cancelHide();
        triggerActive = true;
        if (mark === R.activeMark && tooltipVisible())
            return;
        R.activeMark = mark;
        showTooltip(mark);
    }
    document.addEventListener('mouseover', function (event) {
        if (!hoverFollowing())
            return;
        // 更正面板打开时不要改换当前标记：鼠标从卡片移向面板的途中会扫过其它年号
        // （Canvas 上正文全是这种覆盖层标记，几乎必扫到），一旦改换，
        // showTooltip() 会因为 R.fixMark !== mark 立刻把面板关掉 —— 表现就是
        // 「鼠标一移向 era-hl-fix，面板就没了」。点年号换目标仍走 activate()。
        if (C.isFixPanelOpen && C.isFixPanelOpen())
            return;
        const mark = markFromEvent(event.target);
        if (!mark)
            return;
        R.pointerX = event.clientX;
        R.pointerY = event.clientY;
        cancelHide();
        if (mark === R.activeMark)
            return;
        R.activeMark = mark;
        showTooltip(mark);
    }, true);
    document.addEventListener('mouseout', function (event) {
        if (!hoverFollowing())
            return;
        const mark = markFromEvent(event.target);
        if (!mark)
            return;
        if (mark !== R.activeMark && R.activeMark && R.activeMark.isConnected)
            return;
        if (event.relatedTarget && R.tooltipEl && R.tooltipEl.contains(event.relatedTarget))
            return;
        if (event.relatedTarget && R.fixEl && R.fixEl.contains(event.relatedTarget))
            return;
        if (event.relatedTarget && R.popupGroupEl && R.popupGroupEl.contains(event.relatedTarget))
            return;
        scheduleHide();
    }, true);
    document.addEventListener('mousemove', function (event) {
        if (!R.activeMark)
            return;
        R.pointerX = event.clientX;
        R.pointerY = event.clientY;
    }, { capture: true, passive: true });
    // 单击模式：点年号显示卡片；显示后靠鼠标悬浮保持，移开就消失。
    // 长按模式：按住年号不放，超过阈值弹卡片 —— 阈值一到就**确定**是长按，随后那次 click 直接吞掉，
    // 所以 `<a href="#">三年</a>` 这种链接不会被误跳。
    //
    // 为什么不用双击：浏览器里「双击」不是独立动作，而是两次完整 click 之后才补一个 dblclick
    // （mousedown→mouseup→click→mousedown→mouseup→click→dblclick）。第一次 click 到来时
    // 还不知道会不会有第二次，没法拦 —— 结果链接照跳（还是跳两次）。长按没有这个歧义：
    // mousedown 之后过了阈值就已经知道意图了，等 click 来时 preventDefault 掉即可，
    // 单击完全不受影响，也不用「延迟 300ms 再重放合成事件」那套。
    const LONGPRESS_MS = 450;
    // 按住时位移超过这个像素数就当「按住拖选文字」，取消长按。
    const LONGPRESS_SLOP = 6;
    let pressTimer = null;
    let pressMark = null;
    let pressX = 0;
    let pressY = 0;
    // 这一次按下是否已经判定成长按（用来吞掉紧随其后的 click）。
    let pressFired = false;
    function clearPressTimer() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }
    // 清定时器和当前标记，但**不动 pressFired** —— 它要留给 mouseup 之后那个 click 用。
    function cancelPress() {
        clearPressTimer();
        pressMark = null;
    }
    document.addEventListener('mousedown', function (event) {
        if (triggerMode() !== 'longpress')
            return;
        if (event.button !== 0)
            return;                      // 只认左键
        const mark = markFromEvent(event.target);
        if (!mark)
            return;
        clearPressTimer();
        pressFired = false;
        pressMark = mark;
        pressX = event.clientX;
        pressY = event.clientY;
        pressTimer = setTimeout(function () {
            pressTimer = null;
            const target = pressMark;
            if (!target || !target.isConnected)
                return;
            pressFired = true;
            activate(target, { clientX: pressX, clientY: pressY });
        }, LONGPRESS_MS);
    }, true);
    document.addEventListener('mousemove', function (event) {
        if (!pressTimer)
            return;
        if (Math.abs(event.clientX - pressX) > LONGPRESS_SLOP ||
            Math.abs(event.clientY - pressY) > LONGPRESS_SLOP)
            cancelPress();
    }, { capture: true, passive: true });
    document.addEventListener('mouseup', function () {
        // 松手时还没到阈值 → 取消（那就是一次普通单击）。
        // 已经触发过长按 → pressFired 保留，等 click 到来时吞掉它。
        cancelPress();
    }, true);
    document.addEventListener('click', function (event) {
        if (pressFired) {
            // 长按已经弹过卡片了：这一次 click 不算数，别让 <a href> 跟着跳转。
            // 连 stopPropagation 一起做 —— 否则页面自己的 JS 点击处理（React/onclick）照样会跳。
            pressFired = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (triggerMode() !== 'click')
            return;
        const mark = markFromEvent(event.target);
        if (mark)
            activate(mark, event);
    }, true);
    // 按 Esc 收起（更正面板自己也处理 Esc，交给它）。
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape')
            return;
        if (C.isFixPanelOpen && C.isFixPanelOpen())
            return;
        hideTooltip();
    });
    global.addEventListener('scroll', function (event) {
        if (R.tooltipEl && event.target && R.tooltipEl.contains(event.target))
            return;
        repositionSoon();
    }, true);
    global.addEventListener('resize', repositionSoon);
    global.addEventListener('blur', hideTooltip);
    document.documentElement.addEventListener('mouseleave', hideTooltip);
    C.ensureTooltip = ensureTooltip;
    C.fmtRange = fmtRange;
    C.tipTitle = tipTitle;
    C.buildTooltipContent = buildTooltipContent;
    C.positionTooltip = positionTooltip;
    C.showTooltip = showTooltip;
    C.cancelHide = cancelHide;
    C.markFromEvent = markFromEvent;
    C.markAtPoint = markAtPoint;
    C.hideTooltip = hideTooltip;
    C.refindActiveMark = refindActiveMark;
    C.refreshTooltipAfterRebuild = refreshTooltipAfterRebuild;
    C.reanchorTooltip = reanchorTooltip;
    C.repositionSoon = repositionSoon;
})(typeof globalThis !== 'undefined' ? globalThis : self);
