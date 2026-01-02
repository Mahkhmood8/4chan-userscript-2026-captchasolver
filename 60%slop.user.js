// ==UserScript==
// @name         4chan TCaptcha Debugger (No CV)
// @namespace    4chan-debugger
// @match        https://*.4chan.org/*
// @match        https://*.4channel.org/*
// @grant        unsafeWindow
// @run-at       document-end
// @version      14.0
// ==/UserScript==

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONSTANTS & CONFIGURATION
    // ═══════════════════════════════════════════════════════════════

    const TARGET_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const CONFIG = Object.freeze({
        UI: Object.freeze({
            WIDTH: 550,
            COLORS: Object.freeze({
                PRIMARY: '#007acc',
                BG_DARK: '#1e1e1e',
                BG_HEADER: '#252526',
                BG_LOG: '#000000',
                BG_CARD: '#2d2d2d',
                BORDER: '#333',
                BORDER_CARD: '#444',
                TEXT: '#eee',
                TEXT_MUTED: '#888',
                TEXT_SUCCESS: '#6a9955',
                TEXT_LOG: '#b5cea8'
            })
        }),
        TIMING: Object.freeze({
            HOOK_RETRY: 250,
            UPDATE_DELAY: 150
        })
    });

    const LogicType = Object.freeze({
        UNKNOWN: 'UNKNOWN',
        MAX: 'MAX',
        EXACT: 'EXACT',
        NO_PAIR: 'NO_PAIR'
    });

    // ═══════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════

    const DOM = {
        create(tag, attrs = {}, children = []) {
            const el = document.createElement(tag);
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'className') el.className = v;
                else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
                else if (k === 'text') el.textContent = v;
                else if (k === 'html') el.innerHTML = v;
                else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
                else el.setAttribute(k, v);
            }
            children.forEach(c => el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
            return el;
        },
        $(id) { return document.getElementById(id); }
    };

    // ═══════════════════════════════════════════════════════════════
    // INSTRUCTION PARSER WITH HTML SANITIZATION
    // ═══════════════════════════════════════════════════════════════

    class InstructionParser {
        static parse(html) {
            const cleanText = this.#sanitize(html);
            const type = this.#detectType(cleanText);
            const target = type === LogicType.EXACT ? this.#extractNumber(cleanText, html) : 0;
            return { type, target, cleanText };
        }

        static #sanitize(html) {
            // Remove escaped slashes from JSON-encoded strings
            const unescaped = html.replace(/\\\//g, '/');

            // Parse HTML
            const doc = new DOMParser().parseFromString(unescaped, 'text/html');

            // Remove hidden elements (handling the typo "nnone" vs "none")
            doc.querySelectorAll('*').forEach(el => {
                const style = (el.getAttribute('style') || '').replace(/\s/g, '');

                // Remove elements with opacity:0 or valid display:none
                if (style.includes('opacity:0') ||
                    style.includes('visibility:hidden') ||
                    style.match(/display:\s*none(?!;)/)) {
                    el.remove();
                }

                // Keep elements with the typo "display:nnone" (they render visible)
            });

            return doc.body.textContent.toLowerCase().replace(/\s+/g, ' ').trim();
        }

        static #detectType(text) {
            if (text.includes('highest number') || text.includes('most empty')) return LogicType.MAX;
            if (text.includes('exactly')) return LogicType.EXACT;
            if (text.includes('does not have a pair')) return LogicType.NO_PAIR;
            return LogicType.UNKNOWN;
        }

        static #extractNumber(text, html) {
            // Try to extract number from cleaned text first
            const textMatch = text.match(/exactly\s*(\d+)/);
            if (textMatch) return parseInt(textMatch[1], 10);

            // Fallback to raw HTML parsing
            const htmlMatch = html.match(/exactly.*?(\d+)/i) || html.match(/>\s*(\d+)\s*</);
            if (htmlMatch) return parseInt(htmlMatch[1], 10);

            return 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // STYLES
    // ═══════════════════════════════════════════════════════════════

    class Styles {
        static inject() {
            const { WIDTH, COLORS: C } = CONFIG.UI;
            document.head.appendChild(DOM.create('style', { html: `
                #imgui-root {
                    position: fixed; top: 60px; right: 20px; width: ${WIDTH}px;
                    background: ${C.BG_DARK}; border: 1px solid ${C.BORDER};
                    border-top: 4px solid ${C.PRIMARY};
                    box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 2147483647;
                    font-family: 'Segoe UI', Tahoma, sans-serif; color: ${C.TEXT};
                    display: none;
                }
                .imgui-header {
                    background: ${C.BG_HEADER}; padding: 8px 12px; cursor: move;
                    display: flex; justify-content: space-between;
                    font-size: 12px; font-weight: bold; border-bottom: 1px solid ${C.BORDER};
                    user-select: none;
                }
                .imgui-header span:last-child { cursor: pointer; }
                .imgui-header span:last-child:hover { color: #ff3e3e; }
                .imgui-body { padding: 12px; }
                .imgui-log {
                    background: ${C.BG_LOG}; padding: 10px; font-size: 14px;
                    color: ${C.TEXT_LOG}; border: 1px solid ${C.BORDER_CARD};
                    margin-bottom: 12px; font-family: monospace; border-radius: 2px;
                    word-break: break-word;
                }
                .imgui-grid {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
                    max-height: 500px; overflow-y: auto; padding-right: 5px;
                }
                .imgui-card {
                    background: ${C.BG_CARD}; border: 2px solid ${C.BORDER_CARD};
                    padding: 6px; cursor: pointer; position: relative; border-radius: 4px;
                    transition: border-color 0.15s, transform 0.1s;
                }
                .imgui-card:hover { transform: scale(1.02); }
                .imgui-card img { width: 100%; display: block; border-radius: 2px; }
                .imgui-footer {
                    display: flex; justify-content: space-between; margin-top: 4px;
                    font-size: 11px; color: ${C.TEXT_MUTED};
                }
                .imgui-status {
                    margin-top: 12px; font-size: 11px; color: ${C.TEXT_SUCCESS};
                    display: flex; justify-content: space-between;
                    padding-top: 8px; border-top: 1px solid ${C.BORDER};
                }
                .imgui-grid::-webkit-scrollbar { width: 4px; }
                .imgui-grid::-webkit-scrollbar-thumb { background: ${C.BORDER_CARD}; border-radius: 2px; }
            `}));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // DRAGGABLE
    // ═══════════════════════════════════════════════════════════════

    class Draggable {
        constructor(el, handle) {
            this.el = el;
            this.pos = { x: 0, y: 0 };
            this.dragging = false;

            handle.addEventListener('mousedown', e => this.#onDown(e));
            document.addEventListener('mousemove', e => this.#onMove(e));
            document.addEventListener('mouseup', () => this.dragging = false);
        }

        #onDown(e) {
            if (e.target.closest('[id$="-close"]')) return;
            this.dragging = true;
            this.startX = e.clientX - this.pos.x;
            this.startY = e.clientY - this.pos.y;
        }

        #onMove(e) {
            if (!this.dragging) return;
            e.preventDefault();
            this.pos.x = e.clientX - this.startX;
            this.pos.y = e.clientY - this.startY;
            this.el.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PANEL
    // ═══════════════════════════════════════════════════════════════

    class Panel {
        constructor() {
            this.root = null;
            this.els = {};
        }

        init() {
            Styles.inject();
            this.#build();
            new Draggable(this.root, this.els.header);
            this.els.close.addEventListener('click', () => this.hide());
        }

        #build() {
            this.root = DOM.create('div', { id: 'imgui-root' }, [
                DOM.create('div', { className: 'imgui-header', id: 'imgui-header' }, [
                    DOM.create('span', { text: 'TCAPTCHA DEBUGGER v14 (NO CV)' }),
                    DOM.create('span', { id: 'imgui-close', text: '[X]' })
                ]),
                DOM.create('div', { className: 'imgui-body' }, [
                    DOM.create('div', { className: 'imgui-log', id: 'imgui-prompt', text: 'READY' }),
                    DOM.create('div', { className: 'imgui-grid', id: 'imgui-grid' }),
                    DOM.create('div', { className: 'imgui-status' }, [
                        DOM.create('span', { id: 'imgui-logic', text: 'LOGIC: IDLE' }),
                        DOM.create('span', { id: 'imgui-step', text: 'STEP: 0/0' })
                    ])
                ])
            ]);
            document.body.appendChild(this.root);

            this.els = {
                header: DOM.$('imgui-header'),
                close: DOM.$('imgui-close'),
                prompt: DOM.$('imgui-prompt'),
                grid: DOM.$('imgui-grid'),
                logic: DOM.$('imgui-logic'),
                step: DOM.$('imgui-step')
            };
        }

        show() { this.root.style.display = 'block'; }
        hide() { this.root.style.display = 'none'; }
        setPrompt(t) { this.els.prompt.textContent = `PROMPT: ${t}`; }
        setStep(c, t) { this.els.step.textContent = `STEP: ${c} OF ${t}`; }
        setLogic(type, target) {
            this.els.logic.textContent = `LOGIC: ${type}${target != null ? '_' + target : ''}`;
        }
        clearGrid() { this.els.grid.innerHTML = ''; }
        addCard(card) { this.els.grid.appendChild(card); }
    }

    // ═══════════════════════════════════════════════════════════════
    // CARD BUILDER
    // ═══════════════════════════════════════════════════════════════

    class CardBuilder {
        static create(idx, b64, onClick) {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;

            const card = DOM.create('div', { className: 'imgui-card', onClick }, [
                img,
                DOM.create('div', { className: 'imgui-footer' }, [
                    DOM.create('span', { text: `#${idx + 1}` })
                ])
            ]);

            return { card, img };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN CONTROLLER
    // ═══════════════════════════════════════════════════════════════

    class CaptchaDebugger {
        constructor() {
            this.panel = new Panel();
        }

        start() {
            if (!this.#ready()) {
                setTimeout(() => this.start(), CONFIG.TIMING.HOOK_RETRY);
                return;
            }
            console.log('[TCaptcha Debugger] Hooks armed.');
            this.panel.init();
            this.#hook();
            this.#checkExisting();
        }

        #ready() {
            return TARGET_WINDOW.TCaptcha?.setTaskId;
        }

        #hook() {
            const tc = TARGET_WINDOW.TCaptcha;

            ['setTaskId', 'setChallenge', 'setTaskItem', 'toggleSlider'].forEach(m => {
                const orig = tc[m];
                if (!orig) return;
                tc[m] = (...args) => {
                    const res = orig.apply(tc, args);
                    setTimeout(() => this.#refresh(), CONFIG.TIMING.UPDATE_DELAY);
                    return res;
                };
            });

            const origClear = tc.clearChallenge;
            tc.clearChallenge = (...args) => {
                origClear?.apply(tc, args);
                this.panel.hide();
            };
        }

        #checkExisting() {
            if (TARGET_WINDOW.TCaptcha.tasks?.length) this.#refresh();
        }

        #refresh() {
            const tc = TARGET_WINDOW.TCaptcha;
            const task = tc?.getCurrentTask?.();

            if (!task) {
                this.panel.hide();
                return;
            }

            this.panel.show();
            const logic = InstructionParser.parse(task.str || '');
            this.panel.setPrompt(logic.cleanText);
            this.panel.setStep((tc.taskId || 0) + 1, tc.tasks.length);
            this.panel.setLogic(logic.type, logic.type === LogicType.EXACT ? logic.target : null);

            this.#displayImages(tc, task.items);
        }

        #displayImages(tc, items) {
            this.panel.clearGrid();

            items.forEach((b64, idx) => {
                const { card } = CardBuilder.create(idx, b64, () => this.#select(tc, idx));
                this.panel.addCard(card);
            });
        }

        #select(tc, idx) {
            if (!tc.sliderNode) return;
            tc.sliderNode.value = idx + 1;
            tc.sliderNode.dispatchEvent(new Event('input', { bubbles: true }));
            tc.onNextClick();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ENTRY POINT
    // ═══════════════════════════════════════════════════════════════

    new CaptchaDebugger().start();

})();