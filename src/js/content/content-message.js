(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const R = C.runtime;
    function enabledGuard(type) {
        return R.state.disabled && !['PING', 'GET_STATS', 'CLEAR'].includes(type);
    }
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        const type = message && message.type;
        if (enabledGuard(type)) {
            sendResponse(C.resp({
                ok: false,
                code: 'DISABLED',
                error: '插件已关闭。请重新打开识别开关。'
            }));
            return false;
        }
        if (type === 'PING' || type === 'GET_STATS') {
            sendResponse(C.resp());
            return false;
        }
        if (type === 'RUN_REGEX') {
            const run = function (cleared) {
                try {
                    const result = typeof C.runCanvasRegex === 'function' && C.isCanvasSite && C.isCanvasSite()
                        ? C.runCanvasRegex()
                        : C.runRegex();
                    if (message.reset)
                        result.clearedCorrections = cleared || 0;
                    sendResponse(result);
                }
                catch (error) {
                    sendResponse(C.resp({ ok: false, error: String(error && error.message || error), code: 'EXCEPTION' }));
                }
            };
            // 正则重置：先清空本页已保存的更正（手动指定的年号、切换过的候选），再重新识别。
            if (message.reset && typeof C.clearPageOverrides === 'function') {
                C.clearPageOverrides().then(function (cleared) {
                    run(cleared);
                }, function () {
                    run(0);
                });
                return true;
            }
            run(0);
            return false;
        }
        if (type === 'CLEAR') {
            try {
                const cleared = C.clearMarks(C.getScanRoot(false));
                if (typeof C.clearCanvasMarks === 'function')
                    C.clearCanvasMarks();
                // 标记全没了：更正面板先收起来，否则 hideTooltip() 会因为面板开着而直接返回。
                if (typeof C.closeFixPanelOnly === 'function')
                    C.closeFixPanelOnly();
                C.hideTooltip();
                clearTimeout(R.scanTimer);
                R.scanTimer = null;
                R.state.count = 0;
                R.state.mode = 'idle';
                R.state.aiRaw = 0;
                R.state.lastError = '';
                R.state.userCleared = true;
                sendResponse(C.resp({ cleared }));
            }
            catch (error) {
                sendResponse(C.resp({ ok: false, error: String(error && error.message || error), code: 'EXCEPTION' }));
            }
            return false;
        }
        if (type === 'RUN_AI') {
            C.runAI({ noCache: !!message.noCache }).then(sendResponse);
            return true;
        }
        if (type === 'SET_ANNOTATE') {
            R.settings.annotate = !!message.value;
            try {
                C.refreshAnnotations(document.body);
            }
            catch (e) { }
            if (typeof C.refreshCanvasEraMarks === 'function') {
                try { C.refreshCanvasEraMarks(); } catch (e) { }
            }
            sendResponse(C.resp());
            return false;
        }
        if (type === 'AI_WINDOW_CHANGED') {
            C.loadAiQuota().then(function () {
                if (C.aiWindowActive())
                    R.aiRescanLeft = 3;
                sendResponse(C.resp());
            });
            return true;
        }
        return false;
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);
