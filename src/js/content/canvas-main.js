(() => {
    'use strict';
    if (window.__ERA_HL_SHIDIAN_CANVAS_MAIN__) return;
    window.__ERA_HL_SHIDIAN_CANVAS_MAIN__ = true;

    const DATA_EVENT = 'era-hl-shidian-canvas-data-v1';
    const HELLO_EVENT = 'era-hl-shidian-canvas-hello-v1';
    const BATCH_SIZE = 900;
    const FLUSH_DELAY = 25;

    const pages = new Map();
    const pendingPages = new Set();
    const timers = new Map();
    let ready = false;
    let nextVersion = 0;

    function emit(detail) {
        try {
            window.dispatchEvent(new CustomEvent(DATA_EVENT, { detail }));
        } catch (e) { }
    }

    function pageIdOf(canvas) {
        if (!canvas || !canvas.closest) return '';
        const page = canvas.closest('[data-reader-page-id]');
        return page ? String(page.getAttribute('data-reader-page-id') || '') : '';
    }

    function stateOf(pageId) {
        let state = pages.get(pageId);
        if (!state) {
            state = { records: new Map(), cleared: false };
            pages.set(pageId, state);
        }
        return state;
    }

    function currentTransformOf(ctx) {
        try {
            if (typeof ctx.getTransform === 'function') {
                const m = ctx.getTransform();
                return {
                    a: Number(m.a) || 0,
                    b: Number(m.b) || 0,
                    c: Number(m.c) || 0,
                    d: Number(m.d) || 0,
                    e: Number(m.e) || 0,
                    f: Number(m.f) || 0
                };
            }
        } catch (e) { }
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }

    function textMetricsOf(ctx, value) {
        try {
            const m = ctx.measureText(value);
            return {
                width: Number(m.width) || 0,
                actualBoundingBoxLeft: Number.isFinite(m.actualBoundingBoxLeft) ? m.actualBoundingBoxLeft : null,
                actualBoundingBoxRight: Number.isFinite(m.actualBoundingBoxRight) ? m.actualBoundingBoxRight : null,
                actualBoundingBoxAscent: Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : null,
                actualBoundingBoxDescent: Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : null
            };
        } catch (e) {
            return { width: 0, actualBoundingBoxLeft: null, actualBoundingBoxRight: null, actualBoundingBoxAscent: null, actualBoundingBoxDescent: null };
        }
    }

    function record(pageId, ctx, text, x, y) {
        if (!pageId || text === undefined || text === null) return;
        const canvas = ctx && ctx.canvas;
        if (!canvas) return;
        const sx = Number(x);
        const sy = Number(y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
        const value = String(text);
        if (!value) return;

        const transform = currentTransformOf(ctx);
        const metrics = textMetricsOf(ctx, value);
        const state = stateOf(pageId);
        // 一个位置在同一轮绘制中只保留最后一个字符，避免重复 fillText 造成数据膨胀。
        const key = `${sx}|${sy}`;
        const old = state.records.get(key);
        if (old && old.text === value && old.font === ctx.font && old.canvasWidth === canvas.width && old.canvasHeight === canvas.height &&
            old.transform && transform && old.transform.a === transform.a && old.transform.b === transform.b &&
            old.transform.c === transform.c && old.transform.d === transform.d && old.transform.e === transform.e && old.transform.f === transform.f)
            return;

        state.records.set(key, {
            text: value,
            x: sx,
            y: sy,
            font: String(ctx.font || ''),
            textAlign: String(ctx.textAlign || 'start'),
            textBaseline: String(ctx.textBaseline || 'alphabetic'),
            canvasWidth: Number(canvas.width) || 0,
            canvasHeight: Number(canvas.height) || 0,
            transform,
            metrics,
            version: ++nextVersion,
            sentVersion: 0
        });
        pendingPages.add(pageId);
        schedule(pageId);
    }

    function flushPage(pageId) {
        timers.delete(pageId);
        const state = pages.get(pageId);
        if (!state || !ready) return;

        const records = [];
        for (const item of state.records.values()) {
            if (item.version > item.sentVersion)
                records.push(item);
            if (records.length >= BATCH_SIZE) break;
        }
        if (!records.length) {
            pendingPages.delete(pageId);
            return;
        }

        for (const item of records)
            item.sentVersion = item.version;

        emit({
            type: 'batch',
            pageId,
            records: records.map(item => ({
                text: item.text,
                x: item.x,
                y: item.y,
                font: item.font,
                textAlign: item.textAlign,
                textBaseline: item.textBaseline,
                canvasWidth: item.canvasWidth,
                canvasHeight: item.canvasHeight,
                transform: item.transform,
                metrics: item.metrics
            }))
        });

        let left = false;
        for (const item of state.records.values()) {
            if (item.version > item.sentVersion) {
                left = true;
                break;
            }
        }
        if (left) {
            schedule(pageId);
        } else {
            pendingPages.delete(pageId);
        }
    }

    function schedule(pageId) {
        if (!ready || timers.has(pageId)) return;
        timers.set(pageId, setTimeout(() => flushPage(pageId), FLUSH_DELAY));
    }

    function sendSnapshot() {
        if (!ready) return;
        for (const pageId of pages.keys()) {
            pendingPages.add(pageId);
            schedule(pageId);
        }
    }

    function clearPage(pageId, canvas) {
        if (!pageId) return;
        const state = stateOf(pageId);
        state.records.clear();
        state.cleared = true;
        pendingPages.delete(pageId);
        if (ready) {
            emit({ type: 'reset', pageId });
        }
        if (canvas) {
            // 让后续同位置字符重新进入状态。
            canvas.__eraHlCanvasGeneration = (canvas.__eraHlCanvasGeneration || 0) + 1;
        }
    }

    function isLargeClear(canvas, x, y, w, h) {
        const cw = Number(canvas.width) || 0;
        const ch = Number(canvas.height) || 0;
        if (w >= cw * 0.8 && h >= ch * 0.8) return true;
        return x <= 0 && y <= 0 && (x + w) >= cw - 1 && (y + h) >= ch - 1;
    }

    const proto = CanvasRenderingContext2D.prototype;
    const originalFillText = proto.fillText;
    const originalStrokeText = proto.strokeText;
    const originalClearRect = proto.clearRect;

    function hookFillText(text, x, y, maxWidth) {
        const result = originalFillText.call(this, text, x, y, maxWidth);
        try { record(pageIdOf(this.canvas), this, text, x, y); } catch (e) { }
        return result;
    }

    function hookStrokeText(text, x, y, maxWidth) {
        const result = originalStrokeText.call(this, text, x, y, maxWidth);
        try { record(pageIdOf(this.canvas), this, text, x, y); } catch (e) { }
        return result;
    }

    function hookClearRect(x, y, w, h) {
        const result = originalClearRect.call(this, x, y, w, h);
        try {
            const canvas = this.canvas;
            const pageId = pageIdOf(canvas);
            if (pageId && isLargeClear(canvas, Number(x), Number(y), Number(w), Number(h)))
                clearPage(pageId, canvas);
        } catch (e) { }
        return result;
    }

    function installHooks() {
        if (proto.fillText !== hookFillText)
            proto.fillText = hookFillText;
        if (proto.strokeText !== hookStrokeText)
            proto.strokeText = hookStrokeText;
        if (proto.clearRect !== hookClearRect)
            proto.clearRect = hookClearRect;
    }

    installHooks();
    // 某些站点脚本可能再次替换原型；轻量检查，确保识典阅读器持续可捕获。
    setInterval(installHooks, 1000);

    window.addEventListener(HELLO_EVENT, () => {
        ready = true;
        sendSnapshot();
    });
})();
