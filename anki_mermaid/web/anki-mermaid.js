/*
 * Mermaid Diagrams for Anki: shared core.
 *
 * Finds ```mermaid fenced blocks in rendered HTML, loads the Mermaid library on
 * first use and turns each block into a diagram. It has no dependency on the
 * Anki add-on API, so the same file serves the reviewer, the previewer, the
 * card layout screen and the note editor.
 */
(function () {
    "use strict";

    // Anki keeps its pages alive between cards, so this file can be evaluated
    // more than once.
    if (window.AnkiMermaid) {
        return;
    }

    var scriptUrl = (document.currentScript && document.currentScript.src) || "";
    var baseUrl = scriptUrl.replace(/[^/]*$/, "");

    var OPEN_FENCE = /^\s*```+\s*mermaid\s*$/i;
    var CLOSE_FENCE = /^\s*```+\s*$/;
    var COLLAPSIBLE_ONLY = /^[ \t\r\n\f]*$/;
    var RENDER_TIMEOUT_MS = 8000;
    var CACHE_LIMIT = 60;

    var BLOCK_TAGS = {};
    (
        "ADDRESS ARTICLE ASIDE BLOCKQUOTE CENTER DD DETAILS DIV DL DT FIELDSET " +
        "FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV " +
        "OL P PRE SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL"
    )
        .split(" ")
        .forEach(function (tag) {
            BLOCK_TAGS[tag] = true;
        });

    var SKIP_TAGS = {
        SCRIPT: true,
        STYLE: true,
        SVG: true,
        TEMPLATE: true,
        TEXTAREA: true,
        NOSCRIPT: true,
    };

    /* ------------------------------------------------------------------ */
    /* Fence scanning                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Flatten the DOM under `root` into the lines a reader would see.
     *
     * Anki fields separate lines with <br>, with <div> blocks, or (inside
     * pre-formatted text) with real newlines, so all three count as breaks.
     * Each line remembers the DOM positions where its text starts and ends.
     */
    function scanLines(root) {
        var lines = [];
        var current = null;
        var whiteSpaceCache = new WeakMap();

        function preservesNewlines(element) {
            if (!element || element.nodeType !== 1) {
                return false;
            }
            if (!whiteSpaceCache.has(element)) {
                var value = "";
                try {
                    value = window.getComputedStyle(element).whiteSpace || "";
                } catch (error) {
                    value = "";
                }
                whiteSpaceCache.set(element, /^(pre|break-spaces)/.test(value));
            }
            return whiteSpaceCache.get(element);
        }

        function ensureLine(node, offset) {
            if (!current) {
                current = { text: "", start: [node, offset], end: [node, offset] };
            }
            return current;
        }

        function flush() {
            if (current) {
                lines.push(current);
                current = null;
            }
        }

        function addText(node) {
            var data = node.data;
            if (!data) {
                return;
            }
            var line;
            if (data.indexOf("\n") === -1 || !preservesNewlines(node.parentNode)) {
                // Whitespace between blocks produces no visible line.
                if (!current && COLLAPSIBLE_ONLY.test(data)) {
                    return;
                }
                line = ensureLine(node, 0);
                line.text += data.replace(/[\r\n\t\f]/g, " ");
                line.end = [node, data.length];
                return;
            }
            var position = 0;
            for (;;) {
                var newline = data.indexOf("\n", position);
                var stop = newline === -1 ? data.length : newline;
                if (stop > position || newline !== -1) {
                    line = ensureLine(node, position);
                    line.text += data.slice(position, stop).replace(/\r/g, "");
                    line.end = [node, stop];
                }
                if (newline === -1) {
                    break;
                }
                flush();
                position = newline + 1;
            }
        }

        function walk(parent) {
            var children = parent.childNodes;
            for (var index = 0; index < children.length; index++) {
                var node = children[index];
                if (node.nodeType === 3) {
                    addText(node);
                    continue;
                }
                if (node.nodeType !== 1) {
                    continue;
                }
                var tag = node.nodeName.toUpperCase();
                if (tag === "BR") {
                    ensureLine(parent, index);
                    flush();
                    continue;
                }
                if (SKIP_TAGS[tag] || node.classList.contains("anki-mermaid")) {
                    continue;
                }
                var isBlock = BLOCK_TAGS[tag] === true;
                if (isBlock) {
                    flush();
                }
                walk(node);
                if (isBlock) {
                    flush();
                }
            }
        }

        walk(root);
        flush();
        return lines;
    }

    function normalise(text) {
        return text.replace(/ /g, " ").replace(/[​﻿]/g, "");
    }

    /**
     * Return every ```mermaid block under `root` as
     * `{ source, range, closed }`. `range` runs from the opening fence to the
     * closing fence (or to the last line when the block is not closed yet).
     */
    function findBlocks(root) {
        var lines = scanLines(root);
        var blocks = [];
        var index = 0;
        while (index < lines.length) {
            if (!OPEN_FENCE.test(normalise(lines[index].text))) {
                index++;
                continue;
            }
            var sourceLines = [];
            var next = index + 1;
            while (next < lines.length && !CLOSE_FENCE.test(normalise(lines[next].text))) {
                sourceLines.push(normalise(lines[next].text).replace(/\s+$/, ""));
                next++;
            }
            var closed = next < lines.length;
            var last = lines[closed ? next : lines.length - 1];
            var range = document.createRange();
            range.setStart(lines[index].start[0], lines[index].start[1]);
            range.setEnd(last.end[0], last.end[1]);
            blocks.push({
                source: sourceLines.join("\n").replace(/^\n+/, "").replace(/\s+$/, ""),
                range: range,
                closed: closed,
            });
            index = next + 1;
        }
        return blocks;
    }

    /* ------------------------------------------------------------------ */
    /* Mermaid loading and rendering                                      */
    /* ------------------------------------------------------------------ */

    var loadPromise = null;

    function load() {
        if (window.mermaid && typeof window.mermaid.render === "function") {
            return Promise.resolve(window.mermaid);
        }
        if (!loadPromise) {
            loadPromise = new Promise(function (resolve, reject) {
                var script = document.createElement("script");
                script.src = baseUrl + "vendor/mermaid.min.js";
                script.onload = function () {
                    if (window.mermaid && typeof window.mermaid.render === "function") {
                        resolve(window.mermaid);
                    } else {
                        reject(
                            new Error(
                                "Mermaid could not start. This version of Anki may be too old to run it.",
                            ),
                        );
                    }
                };
                script.onerror = function () {
                    reject(new Error("Could not load the Mermaid library."));
                };
                document.head.appendChild(script);
            }).catch(function (error) {
                loadPromise = null;
                throw error;
            });
        }
        return loadPromise;
    }

    function isDark() {
        var root = document.documentElement;
        var body = document.body;
        return (
            root.classList.contains("night-mode") ||
            root.getAttribute("data-bs-theme") === "dark" ||
            (!!body &&
                (body.classList.contains("nightMode") || body.classList.contains("night_mode")))
        );
    }

    function mermaidConfig(dark) {
        var user = window.AnkiMermaidConfig || {};
        var config = {
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: dark ? user.theme_dark || "dark" : user.theme_light || "default",
            look: user.look || "classic",
            layout: user.layout || "dagre",
        };
        if (config.look === "classic") {
            // Mermaid 12 gives every flowchart node a 120px minimum width.
            // The classic look sizes nodes to their labels instead.
            config.flowchart = { minNodeWidth: 0, wrappingWidth: 200 };
        }
        return config;
    }

    function errorMessage(error) {
        var message = (error && (error.message || error.str)) || String(error);
        return String(message).trim() || "Mermaid could not draw this diagram.";
    }

    var cache = new Map();
    var renderQueue = Promise.resolve();
    var renderCount = 0;
    var activeTheme = null;

    function renderNow(mermaid, source, dark) {
        var theme = dark ? "dark" : "light";
        if (theme !== activeTheme) {
            mermaid.initialize(mermaidConfig(dark));
            activeTheme = theme;
        }
        var id = "anki-mermaid-svg-" + ++renderCount;
        return mermaid.render(id, source).then(
            function (result) {
                return { svg: result.svg };
            },
            function (error) {
                // Mermaid can leave its measuring element behind on failure.
                [id, "d" + id].forEach(function (leftover) {
                    var element = document.getElementById(leftover);
                    if (element) {
                        element.remove();
                    }
                });
                return { error: errorMessage(error) };
            },
        );
    }

    /**
     * Render Mermaid source. Always resolves, with `{ svg }` or `{ error }`.
     */
    function render(source, dark) {
        var key = (dark ? "dark" : "light") + "\n" + source;
        if (cache.has(key)) {
            return Promise.resolve(cache.get(key));
        }
        // One render at a time: the theme is global Mermaid state.
        var result = renderQueue.then(function () {
            return load().then(
                function (mermaid) {
                    return renderNow(mermaid, source, dark);
                },
                function (error) {
                    return { error: errorMessage(error) };
                },
            );
        });
        renderQueue = result.then(
            function () {},
            function () {},
        );
        return result.then(function (outcome) {
            if (outcome.svg) {
                if (cache.size >= CACHE_LIMIT) {
                    cache.delete(cache.keys().next().value);
                }
                cache.set(key, outcome);
            }
            return outcome;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Card rendering (reviewer, previewer, card layout)                  */
    /* ------------------------------------------------------------------ */

    function isEmptyNode(node) {
        if (node.nodeType === 3) {
            return node.data === "";
        }
        if (node.nodeType !== 1) {
            return true;
        }
        for (var child = node.firstChild; child; child = child.nextSibling) {
            if (!isEmptyNode(child)) {
                return false;
            }
        }
        return true;
    }

    /** Swap a block's fenced source for an empty diagram container. */
    function replaceWithPlaceholder(block) {
        var range = block.range;
        var boundary = range.commonAncestorContainer;
        var endNode = range.endContainer;

        var placeholder = document.createElement("div");
        placeholder.className = "anki-mermaid";
        range.deleteContents();
        range.insertNode(placeholder);

        // Deleting leaves the emptied wrapper of the closing fence behind.
        var leftover = endNode.nodeType === 3 ? endNode.parentNode : endNode;
        while (
            leftover &&
            leftover !== boundary &&
            leftover.parentNode &&
            !leftover.contains(placeholder) &&
            isEmptyNode(leftover)
        ) {
            var parent = leftover.parentNode;
            parent.removeChild(leftover);
            leftover = parent;
        }

        // The <br> that ended the closing fence line would now add a blank line.
        var after = placeholder.nextSibling;
        while (after && after.nodeType === 3 && after.data === "") {
            after = after.nextSibling;
        }
        if (after && after.nodeType === 1 && after.nodeName.toUpperCase() === "BR") {
            after.remove();
        }
        return placeholder;
    }

    function showError(container, source, message) {
        container.classList.add("anki-mermaid-error");
        container.textContent = "";
        var code = document.createElement("pre");
        code.className = "anki-mermaid-code";
        code.textContent = "```mermaid\n" + source + "\n```";
        var note = document.createElement("div");
        note.className = "anki-mermaid-message";
        note.textContent = message;
        container.appendChild(code);
        container.appendChild(note);
    }

    function fill(container, source, dark) {
        return render(source, dark).then(function (outcome) {
            if (outcome.svg) {
                container.innerHTML = outcome.svg;
            } else {
                showError(container, source, outcome.error);
            }
        });
    }

    /** Render every closed block under `root` in place. */
    function renderAll(root) {
        var blocks = findBlocks(root).filter(function (block) {
            return block.closed;
        });
        var dark = isDark();
        var jobs = [];
        // Back to front, so earlier ranges are untouched by later edits.
        for (var index = blocks.length - 1; index >= 0; index--) {
            var placeholder = replaceWithPlaceholder(blocks[index]);
            jobs.push(fill(placeholder, blocks[index].source, dark));
        }
        return Promise.all(jobs);
    }

    function updateHooks() {
        try {
            if (typeof require === "function") {
                var reviewer = require("anki/reviewer");
                if (reviewer && Array.isArray(reviewer.onUpdateHook)) {
                    return reviewer.onUpdateHook;
                }
            }
        } catch (error) {
            // Not a reviewer page.
        }
        return Array.isArray(window.onUpdateHook) ? window.onUpdateHook : null;
    }

    /**
     * Called from a script the add-on appends to each card that has a fence.
     * Anki waits for promises on its update hook before revealing the card,
     * so the raw source never flashes on screen.
     */
    function onCard() {
        var root = document.getElementById("qa") || document.body;
        var done = renderAll(root).catch(function (error) {
            console.error("Mermaid Diagrams:", error);
        });
        var hooks = updateHooks();
        if (hooks) {
            hooks.push(function () {
                // Never let a slow diagram keep the card hidden.
                return Promise.race([
                    done,
                    new Promise(function (resolve) {
                        setTimeout(resolve, RENDER_TIMEOUT_MS);
                    }),
                ]);
            });
        }
        return done;
    }

    window.AnkiMermaid = {
        findBlocks: findBlocks,
        isDark: isDark,
        load: load,
        onCard: onCard,
        render: render,
        renderAll: renderAll,
    };
})();
