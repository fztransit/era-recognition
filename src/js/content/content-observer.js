(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const R = C.runtime;
    function isIgnoredMutation(records) {
        return !records.some(function (record) {
            const target = record.target;
            const element = target && target.nodeType === 1 ? target : target && target.parentElement;
            return !element || !element.closest || !element.closest('[data-era-hl-ignore]');
        });
    }
    // 插件自己插/删的节点（卡片、更正面板、桥接分组、标记、文内标注）不算正文变化。
    // 少了这一步：打开卡片 / 更正面板会在 900ms 后触发一次整页重扫，所有标记被重建，
    // 卡片正看着的那一处变成游离节点 —— 表现就是「点了更正，面板有时会自己消失」。
    function isExtensionMutation(record) {
        if (typeof C.isGeneratedNode !== 'function')
            return false;
        const nodes = [];
        if (record.addedNodes)
            record.addedNodes.forEach(function (node) { nodes.push(node); });
        if (record.removedNodes)
            record.removedNodes.forEach(function (node) { nodes.push(node); });
        // 纯属性 / 字符数据变化没有节点，退回看 target。
        if (!nodes.length)
            nodes.push(record.target);
        return nodes.every(function (node) {
            const element = node && node.nodeType === 1 ? node : node && node.parentElement;
            return !!element && C.isGeneratedNode(element);
        });
    }
    function isOnlyExtensionMutation(records) {
        return records.every(isExtensionMutation);
    }
    function stopObserver() {
        if (!R.observer)
            return;
        try {
            R.observer.disconnect();
        }
        catch (e) { }
        R.observer = null;
        clearTimeout(R.scanTimer);
        R.scanTimer = null;
    }
    function startObserver() {
        if (R.observer || !document.body)
            return;
        // 识典古籍：正文在 canvas 上，DOM 变化观察器没意义
        //（覆盖标记由 canvas-adapter 自己的观察器负责）。
        if (typeof C.isCanvasSite === 'function' && C.isCanvasSite())
            return;
        R.scanBudget = 12;
        R.observer = new MutationObserver(function (records) {
            if (R.state.disabled || !R.state.autoAllowed)
                return;
            if (Date.now() - R.lastSelfMutation < 200)
                return;
            if (R.state.userCleared || isIgnoredMutation(records) || isOnlyExtensionMutation(records))
                return;
            const aiMode = R.state.mode === 'ai' && C.aiWindowActive();
            if (R.state.mode === 'ai' && !aiMode)
                return;
            if (aiMode ? R.aiRescanLeft <= 0 : R.scanBudget <= 0)
                return;
            clearTimeout(R.scanTimer);
            R.scanTimer = setTimeout(function () {
                R.scanTimer = null;
                R.scanRoot = null;
                if (aiMode) {
                    R.aiRescanLeft--;
                    if (!R.state.busy)
                        C.runAI({ auto: true });
                    return;
                }
                R.scanBudget--;
                try {
                    C.runRegex();
                }
                catch (e) {
                    R.state.lastError = String(e && e.message || e);
                }
            }, aiMode ? 3000 : 900);
        });
        try {
            R.observer.observe(document.body, { childList: true, subtree: true, characterData: false });
        }
        catch (e) {
            R.observer = null;
        }
    }
    C.startObserver = startObserver;
    C.stopObserver = stopObserver;
})(typeof globalThis !== 'undefined' ? globalThis : self);
