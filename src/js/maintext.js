(function (global) {
    'use strict';
    const NOISE_SELECTOR = [
        'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
        'nav', 'footer', 'aside', 'header', 'form', 'button', 'select', 'textarea',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
        '[aria-hidden="true"]', '[hidden]'
    ].join(',');
    const SEMANTIC_SELECTORS = [
        'article',
        'main',
        '[role="main"]',
        '[itemprop="articleBody"]',
        '#article-content', '#articleContent', '#content', '#main', '#main-content',
        '.article-content', '.article-body', '.article__content',
        '.post-content', '.post-body', '.post__content',
        '.entry-content', '.entry__content',
        '.markdown-body', '.rich_media_content', '.content-body',
        '.story-body', '.post-text'
    ];
    const BLOCK_SELECTOR = 'div,section,article,main,td,body';
    const MIN_TEXT_LEN = 160;
    function textLength(el) {
        if (!el)
            return 0;
        const t = el.textContent;
        return t ? t.length : 0;
    }
    function linkDensity(el) {
        const total = textLength(el);
        if (!total)
            return 1;
        let linkLen = 0;
        const anchors = el.querySelectorAll('a');
        for (const a of anchors)
            linkLen += textLength(a);
        return Math.min(1, linkLen / total);
    }
    function scoreElement(el) {
        const len = textLength(el);
        if (len < MIN_TEXT_LEN)
            return 0;
        const ld = linkDensity(el);
        if (ld > 0.6)
            return 0;
        const pCount = el.getElementsByTagName('p').length;
        const punctuation = el.textContent.match(/[，。、；：,.;:!?！？]/g);
        const punctBonus = 1 + Math.min(0.45, (punctuation ? punctuation.length : 0) / 300);
        return len * (1 - ld) * (1 + Math.min(0.35, pCount / 40)) * punctBonus;
    }
    function findMainElement() {
        if (!document.body)
            return null;
        for (const sel of SEMANTIC_SELECTORS) {
            let nodes;
            try {
                nodes = document.querySelectorAll(sel);
            }
            catch (e) {
                continue;
            }
            for (const el of nodes) {
                if (textLength(el) >= 300 && linkDensity(el) < 0.5)
                    return el;
            }
        }
        let candidates;
        try {
            candidates = document.body.querySelectorAll('div,section,article,main,td');
        }
        catch (e) {
            return document.body;
        }
        if (candidates.length > 3000) {
            candidates = document.body.querySelectorAll('article,main,section');
            if (!candidates.length)
                return document.body;
        }
        let best = document.body;
        let bestScore = scoreElement(document.body) * 0.7;
        for (const el of candidates) {
            if (el.classList && el.classList.contains('era-hl-mark'))
                continue;
            if (el.getElementsByTagName('p').length < 2 && el.tagName !== 'ARTICLE' && el.tagName !== 'MAIN') {
                continue;
            }
            const s = scoreElement(el);
            if (s > bestScore) {
                bestScore = s;
                best = el;
            }
        }
        return best;
    }
    function normalize(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{3,}/g, '  ')
            .trim();
    }
    function extractMainText() {
        const el = findMainElement() || document.body;
        let text = '';
        if (el) {
            try {
                text = el.innerText || el.textContent || '';
            }
            catch (e) {
                text = el.textContent || '';
            }
        }
        return {
            el: el,
            text: normalize(text),
            title: document.title || '',
            url: location.href
        };
    }
    function extractPlainText(maxChars) {
        const r = extractMainText();
        const limit = maxChars && maxChars > 0 ? maxChars : 12000;
        return {
            el: r.el,
            title: r.title,
            url: r.url,
            truncated: r.text.length > limit,
            text: r.text.slice(0, limit)
        };
    }
    global.EraMainText = {
        NOISE_SELECTOR: NOISE_SELECTOR,
        findMainElement: findMainElement,
        extractMainText: extractMainText,
        extractPlainText: extractPlainText,
        normalize: normalize
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
