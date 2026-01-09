// ==UserScript==
// @name         relax is okay script - Star & Outlier Edition
// @namespace    4chan-gradio-client
// @match        https://*.4chan.org/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// @version      23.2
// ==/UserScript==

const CONFIG = Object.freeze({
    GRADIO: Object.freeze({
        SERVER_URL: 'https://jihadist324r-4chanopenncvsolver1.hf.space',
        BATCH_ENDPOINT: '/api/batch',
        OUTLIER_ENDPOINT: '/api/outlier',
        DIE_ENDPOINT: '/api/die/batch',
        TIMEOUT: 20000,
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000
    }),
    UI: Object.freeze({
        WIDTH: 600,
        SHOW_PANEL: false, // Set to false to disable the floating display
        COLORS: Object.freeze({
            PRIMARY: '#007acc',
            PREDICT: '#ff3e3e',
            BG_DARK: '#1e1e1e',
            BG_HEADER: '#252526',
            BG_LOG: '#111111',
            BG_CARD: '#2d2d2d',
            BG_PREDICTED: '#452121',
            BORDER: '#333',
            BORDER_CARD: '#444',
            TEXT: '#eee',
            TEXT_MUTED: '#888',
            TEXT_SUCCESS: '#6a9955',
            TEXT_LOG: '#cccccc',
            TEXT_WARN: '#dcdcaa',
            TEXT_ERROR: '#f44747',
            TEXT_INFO: '#569cd6'
        })
    }),
    TIMING: Object.freeze({
        HOOK_RETRY: 250,
        UPDATE_DELAY: 150,
        AUTO_SOLVE_DELAY: 80
    }),
    LOGGING: Object.freeze({
        MAX_UI_LINES: 50,
        ENABLED: true,
        LOG_RAW_RESPONSE: true
    }),
    AUTO_SOLVE: true,
    AUTO_SUBMIT: true
});

// =============================================================================
// CONSULA SYSTEM
// =============================================================================

class Consula {
    static #terminal = null;

    static setTerminal(element) {
        this.#terminal = element;
    }

    static #timestamp() {
        const d = new Date();
        const hrs = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');
        const sec = d.getSeconds().toString().padStart(2, '0');
        const ms = d.getMilliseconds().toString().padStart(3, '0');
        return `${hrs}:${min}:${sec}.${ms}`;
    }

    static #print(level, message, color) {
        if (!CONFIG.LOGGING.ENABLED) return;
        const ts = this.#timestamp();

        console.log(
            `%c[Consula] [${ts}] ${message}`,
            `color: ${color}; font-weight: bold;`
        );

        if (this.#terminal) {
            const entry = DOM.create('div', {
                className: 'log-entry',
                html: `<span style="color:#666">[${ts}]</span> <span style="color:${color}">${message}</span>`
            });
            this.#terminal.appendChild(entry);
            this.#terminal.scrollTop = this.#terminal.scrollHeight;

            while (this.#terminal.childElementCount > CONFIG.LOGGING.MAX_UI_LINES) {
                this.#terminal.removeChild(this.#terminal.firstChild);
            }
        }
    }

    static info(msg) { this.#print('INFO', msg, CONFIG.UI.COLORS.TEXT_INFO); }
    static success(msg) { this.#print('SUCCESS', msg, CONFIG.UI.COLORS.TEXT_SUCCESS); }
    static warn(msg) { this.#print('WARN', msg, CONFIG.UI.COLORS.TEXT_WARN); }
    static error(msg) { this.#print('ERROR', msg, CONFIG.UI.COLORS.TEXT_ERROR); }
    static prompt(msg) { this.#print('PROMPT', `>>> ${msg}`, '#d4d4d4'); }
    static debug(msg) { this.#print('DEBUG', msg, '#9cdcfe'); }
}

// =============================================================================
// GRADIO CLIENT
// =============================================================================

class GradioClient {
    async analyze(base64Images, endpoint) {
        const url = `${CONFIG.GRADIO.SERVER_URL}${endpoint}`;
        const cleanImages = base64Images.map(img => {
            return img.includes(',') ? img : `data:image/jpeg;base64,${img}`;
        });

        Consula.info(`Calling API: ${endpoint}...`);
        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ images: cleanImages }),
                timeout: CONFIG.GRADIO.TIMEOUT,
                onload: (res) => {
                    if (res.status !== 200) {
                        return reject(new Error(`HTTP ${res.status}`));
                    }
                    try {
                        const data = JSON.parse(res.responseText);
                        const duration = (performance.now() - startTime).toFixed(0);
                        Consula.success(`Received in ${duration}ms`);

                        if (CONFIG.LOGGING.LOG_RAW_RESPONSE) {
                            Consula.debug(`Raw Data: ${JSON.stringify(data).substring(0, 200)}...`);
                        }

                        resolve(data);
                    } catch (e) {
                        reject(new Error('JSON Parse Error'));
                    }
                },
                onerror: () => reject(new Error('Network Error')),
                ontimeout: () => reject(new Error('Timeout'))
            });
        });
    }
}

// =============================================================================
// DOM UTILITIES & PARSER
// =============================================================================

const DOM = {
    create(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') {
                el.className = v;
            } else if (k === 'style' && typeof v === 'object') {
                Object.assign(el.style, v);
            } else if (k === 'text') {
                el.textContent = v;
            } else if (k === 'html') {
                el.innerHTML = v;
            } else if (k.startsWith('on')) {
                el.addEventListener(k.slice(2).toLowerCase(), v);
            } else {
                el.setAttribute(k, v);
            }
        }
        children.forEach(c => {
            if (c) {
                el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
            }
        });
        return el;
    },
    $(id) {
        return document.getElementById(id);
    }
};

class InstructionParser {
    static parse(html) {
        const unescaped = html.replace(/\\\//g, '/');
        const doc = new DOMParser().parseFromString(unescaped, 'text/html');

        doc.querySelectorAll('*').forEach(el => {
            const style = (el.getAttribute('style') || '').replace(/\s/g, '');
            const isHidden = style.includes('opacity:0') ||
                             style.includes('visibility:hidden') ||
                             (style.includes('display:none') && !style.includes('nnone'));
            if (isHidden) {
                el.remove();
            }
        });

        const text = doc.body.textContent.toLowerCase().replace(/\s+/g, ' ').trim();

        let type = 'UNKNOWN';
        let target = 0;
        let keyword = 'empty';

        if (text.includes('4 spikes')) keyword = 'shuriken';
        else if (text.includes('5 spikes')) keyword = 'pentagram';
        else if (text.includes('6 spikes')) keyword = 'hexragram';
        else if (text.includes('7 spikes')) keyword = 'star7';
        else if (text.includes('8 spikes')) keyword = 'star8';
        else if (text.includes('dotted')) keyword = 'dotted dice';
        else if (text.includes('empty')) keyword = 'empty dice';
        else if (text.includes('dice') || text.includes('pie') || text.includes('pip')) keyword = 'dice';

        if (text.includes('highest') || text.includes('most') || text.includes('maximum')) {
            type = 'MAX';
        } else if (text.includes('exactly')) {
            type = 'EXACT';
            const m = text.match(/exactly\s*(\d+)/) || html.match(/>\s*(\d+)\s*</);
            if (m) target = parseInt(m[1], 10);
        } else if (text.includes('pair') || text.includes('not like the others') || text.includes('odd one out')) {
            type = 'OUTLIER';
        }

        Consula.info(`Parser: [Key:${keyword}] [Mode:${type}] [Target:${target}]`);
        return { type, target, keyword, cleanText: text };
    }
}

// =============================================================================
// CONSULA PANEL
// =============================================================================

class Panel {
    constructor() {
        this.root = null;
        this.els = {};
        this.isVisible = false;
    }

    init() {
        if (!CONFIG.UI.SHOW_PANEL) return;

        const { WIDTH, COLORS: C } = CONFIG.UI;
        document.head.appendChild(DOM.create('style', { html: `
            #consula-root {
                position: fixed; top: 40px; right: 20px; width: ${WIDTH}px;
                background: ${C.BG_DARK}; border: 1px solid ${C.BORDER};
                border-top: 5px solid ${C.PRIMARY}; box-shadow: 0 15px 40px rgba(0,0,0,0.9);
                z-index: 2147483647; font-family: 'Segoe UI', sans-serif; color: ${C.TEXT}; display: none;
                border-radius: 8px; overflow: hidden;
            }
            .consula-header {
                background: ${C.BG_HEADER}; padding: 12px 16px; cursor: move;
                display: flex; justify-content: space-between; font-size: 14px;
                font-weight: bold; border-bottom: 1px solid ${C.BORDER}; user-select: none;
            }
            .consula-body { padding: 20px; }
            .consula-log-container {
                background: ${C.BG_LOG}; border: 1px solid ${C.BORDER_CARD};
                margin-bottom: 15px; height: 160px; overflow-y: auto;
                padding: 10px; font-size: 12px; line-height: 1.4;
            }
            .log-entry { margin-bottom: 4px; border-bottom: 1px solid #222; padding-bottom: 4px; }
            .consula-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
            .consula-card {
                background: ${C.BG_CARD}; border: 3px solid ${C.BORDER_CARD};
                padding: 5px; cursor: pointer; position: relative; border-radius: 6px;
            }
            .consula-card img { width: 100%; border-radius: 4px; display: block; }
            .consula-card.predicted { border-color: ${C.PREDICT}; background: ${C.BG_PREDICTED}; }
            .consula-badge {
                position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
                background: ${C.PREDICT}; color: white; font-size: 10px; padding: 2px 8px;
                border-radius: 10px; z-index: 10; font-weight: bold;
            }
            .consula-count { font-size: 12px; text-align: center; margin-top: 5px; font-weight: bold; }
            .consula-status {
                margin-top: 15px; font-size: 12px; color: ${C.TEXT_MUTED};
                display: flex; justify-content: space-between; border-top: 1px solid ${C.BORDER};
                padding-top: 10px;
            }
        `}));

        this.root = DOM.create('div', { id: 'consula-root' }, [
            DOM.create('div', { className: 'consula-header', id: 'consula-hdr' }, [
                DOM.create('span', { text: 'CONSULA ANALYZER V23.2' }),
                DOM.create('span', {
                    text: '[X]',
                    style: { cursor: 'pointer' },
                    onclick: () => this.hide()
                })
            ]),
            DOM.create('div', { className: 'consula-body' }, [
                DOM.create('div', { className: 'consula-log-container', id: 'consula-log' }),
                DOM.create('div', { className: 'consula-grid', id: 'consula-grid' }),
                DOM.create('div', { className: 'consula-status' }, [
                    DOM.create('span', { id: 'consula-logic', text: 'Logic: Ready' }),
                    DOM.create('span', { id: 'consula-step', text: 'Step: -/-' })
                ])
            ])
        ]);

        document.body.appendChild(this.root);
        this.els = {
            log: DOM.$('consula-log'),
            grid: DOM.$('consula-grid'),
            logic: DOM.$('consula-logic'),
            step: DOM.$('consula-step'),
            hdr: DOM.$('consula-hdr')
        };

        Consula.setTerminal(this.els.log);
        this.#setupDragging();
    }

    #setupDragging() {
        if (!this.els.hdr) return;
        let mx = 0, my = 0;
        this.els.hdr.onmousedown = (e) => {
            mx = e.clientX;
            my = e.clientY;
            document.onmousemove = (e) => {
                const x = mx - e.clientX;
                const y = my - e.clientY;
                mx = e.clientX;
                my = e.clientY;
                this.root.style.top = (this.root.offsetTop - y) + "px";
                this.root.style.left = (this.root.offsetLeft - x) + "px";
            };
            document.onmouseup = () => {
                document.onmousemove = null;
            };
        };
    }

    show() {
        if (!CONFIG.UI.SHOW_PANEL) return;
        this.isVisible = true;
        this.#renderVisibility();
    }

    hide() {
        this.isVisible = false;
        this.#renderVisibility();
    }

    showConsula() {
        this.#renderVisibility();
    }

    #renderVisibility() {
        if (this.root) {
            this.root.style.display = (this.isVisible && CONFIG.UI.SHOW_PANEL) ? 'block' : 'none';
        }
    }

    clear() {
        if (this.els.grid) this.els.grid.innerHTML = '';
    }

    updateStatus(step, total, logicText) {
        if (this.els.step) this.els.step.textContent = `STEP: ${step}/${total}`;
        if (this.els.logic) this.els.logic.textContent = `LOGIC: ${logicText}`;
    }
}

// =============================================================================
// CONTROLLER
// =============================================================================

class CaptchaController {
    constructor() {
        this.panel = new Panel();
        this.api = new GradioClient();
        this.lastId = null;
    }

    start() {
        if (!unsafeWindow.TCaptcha?.setTaskId) {
            return setTimeout(() => this.start(), CONFIG.TIMING.HOOK_RETRY);
        }
        this.panel.init();
        this.#hook();
        Consula.success('Consula Controller Hooked');
    }

    #hook() {
        const tc = unsafeWindow.TCaptcha;
        const methods = ['setTaskId', 'setChallenge', 'setTaskItem', 'onNextClick'];

        methods.forEach(m => {
            if (typeof tc[m] === 'function') {
                const orig = tc[m];
                tc[m] = (...args) => {
                    const res = orig.apply(tc, args);
                    setTimeout(() => this.#refresh(), CONFIG.TIMING.UPDATE_DELAY);
                    return res;
                };
            }
        });
    }

    async #refresh() {
        const tc = unsafeWindow.TCaptcha;
        const task = tc?.getCurrentTask?.();

        if (!task) {
            this.lastId = null;
            this.panel.hide();
            this.panel.showConsula();
            return;
        }

        const id = `${tc.taskId}-${task.items?.length}-${task.str.length}`;
        if (this.lastId === id) return;
        this.lastId = id;

        this.panel.show();
        this.panel.showConsula();
        this.panel.clear();

        const logic = InstructionParser.parse(task.str);
        Consula.prompt(logic.cleanText);
        this.panel.updateStatus((tc.taskId || 0) + 1, tc.tasks.length, `${logic.type}`);

        try {
            let processedResults = [];

            if (logic.type === 'OUTLIER') {
                const data = await this.api.analyze(task.items, CONFIG.GRADIO.OUTLIER_ENDPOINT);
                processedResults = (data.results || []).map(r => ({
                    score: r.outlier_score,
                    isWinner: r.index === data.outlier_index,
                    label: `Score: ${r.outlier_score.toFixed(3)}`
                }));
            } else if (logic.keyword === 'dice') {
                const data = await this.api.analyze(task.items, CONFIG.GRADIO.DIE_ENDPOINT);
                const counts = data.results.map(r => r.pips || 0);

                let winnerIdx = -1;
                if (logic.type === 'MAX') {
                    winnerIdx = counts.indexOf(Math.max(...counts));
                } else if (logic.type === 'EXACT') {
                    let minDiff = Infinity;
                    counts.forEach((c, i) => {
                        const diff = Math.abs(c - logic.target);
                        if (diff < minDiff) {
                            minDiff = diff;
                            winnerIdx = i;
                        }
                    });
                }

                processedResults = counts.map((c, i) => ({
                    count: c,
                    isWinner: i === winnerIdx,
                    label: `Pips: ${c}`
                }));
            } else {
                const data = await this.api.analyze(task.items, CONFIG.GRADIO.BATCH_ENDPOINT);
                const results = data.results || [];

                const counts = results.map((r, idx) => {
                    const filtered = (r.detections || []).filter(d => d.class === logic.keyword);
                    if (CONFIG.LOGGING.LOG_RAW_RESPONSE) {
                        const classesFound = (r.detections || []).map(d => d.class).join(', ');
                        Consula.debug(`Img ${idx} detections: [${classesFound || 'None'}]`);
                    }
                    return filtered.length;
                });

                let winnerIdx = -1;
                if (logic.type === 'MAX') {
                    winnerIdx = counts.indexOf(Math.max(...counts));
                } else if (logic.type === 'EXACT') {
                    let minDiff = Infinity;
                    counts.forEach((c, i) => {
                        const diff = Math.abs(c - logic.target);
                        if (diff < minDiff) {
                            minDiff = diff;
                            winnerIdx = i;
                        }
                    });
                }

                processedResults = counts.map((c, i) => ({
                    count: c,
                    isWinner: i === winnerIdx,
                    label: `${logic.keyword}: ${c}`
                }));
            }

            this.#render(tc, task.items, processedResults);
        } catch (e) {
            Consula.error(`Analysis Failed: ${e.message}`);
        }
    }

    #render(tc, items, results) {
        const winnerIdx = results.findIndex(r => r.isWinner);

        if (CONFIG.UI.SHOW_PANEL) {
            items.forEach((b64, i) => {
                const res = results[i];
                const card = DOM.create('div', {
                    className: `consula-card ${res.isWinner ? 'predicted' : ''}`,
                    onclick: () => {
                        this.#applyAction(tc, i);
                        tc.onNextClick();
                    }
                }, [
                    DOM.create('img', { src: b64.includes(',') ? b64 : `data:image/png;base64,${b64}` }),
                    res.isWinner ? DOM.create('div', { className: 'consula-badge', text: 'MATCH' }) : null,
                    DOM.create('div', { className: 'consula-count', text: res.label })
                ]);
                this.panel.els.grid.appendChild(card);
            });
        }

        if (CONFIG.AUTO_SOLVE && winnerIdx !== -1) {
            setTimeout(() => {
                this.#applyAction(tc, winnerIdx);
                if (CONFIG.AUTO_SUBMIT) tc.onNextClick();
            }, CONFIG.TIMING.AUTO_SOLVE_DELAY);
        }
    }

    #applyAction(tc, idx) {
        if (!tc.sliderNode) return;
        tc.sliderNode.value = idx + 1;
        tc.sliderNode.dispatchEvent(new Event('input', { bubbles: true }));
        tc.sliderNode.dispatchEvent(new Event('change', { bubbles: true }));
        Consula.info(`Slider set to ${idx + 1}`);
    }
}

new CaptchaController().start();
