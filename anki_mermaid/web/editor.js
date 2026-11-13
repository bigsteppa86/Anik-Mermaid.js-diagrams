/*
 * Mermaid Diagrams for Anki: note editor integration.
 *
 * For every rich-text field this draws a shaded box behind each ```mermaid
 * block and shows the rendered diagrams in a panel beneath the field, updating
 * as the user types.
 *
 * Nothing here ever changes the contents of <anki-editable>: whatever is in
 * that element is saved into the note, so the box and the preview both live
 * outside it.
 */
(function () {
    "use strict";

    if (window.AnkiMermaidEditor || !window.AnkiMermaid) {
        return;
    }
    window.AnkiMermaidEditor = true;

    var core = window.AnkiMermaid;
    var PREVIEW_DELAY_MS = 250;
    var BOX_PAD_X = 4;
    var BOX_PAD_Y = 3;
    var UNCLOSED_HINT = "Finish the block with ``` on its own line to show it on the card.";
    var EMPTY_HINT = "Type a Mermaid diagram between the fences.";

    /** host element (.rich-text-editable) -> field state */
    var fields = new Map();
    var pendingHosts = new WeakSet();

    /* ------------------------------------------------------------------ */
    /* Code box                                                           */
    /* ------------------------------------------------------------------ */

    function drawBoxes(state) {
        var blocks = state.blocks;
        var layer = state.layer;
        while (layer.children.length > blocks.length) {
            layer.lastChild.remove();
        }
        while (layer.children.length < blocks.length) {
            var box = document.createElement("div");
            box.className = "anki-mermaid-box";
            layer.appendChild(box);
        }
        if (!blocks.length) {
            return;
        }
        var origin = state.relative.getBoundingClientRect();
        var host = state.host.getBoundingClientRect();
        blocks.forEach(function (block, index) {
            var rect = block.range.getBoundingClientRect();
            var style = layer.children[index].style;
            style.top = rect.top - origin.top - BOX_PAD_Y + "px";
            style.height = rect.height + BOX_PAD_Y * 2 + "px";
            // The field has 6px of padding around the text to grow into.
            style.left = host.left - origin.left - BOX_PAD_X + "px";
            style.width = host.width + BOX_PAD_X * 2 + "px";
        });
    }

    /* ------------------------------------------------------------------ */
    /* Live preview                                                       */
    /* ------------------------------------------------------------------ */

    function createFigure(panel) {
        var element = document.createElement("div");
        element.className = "anki-mermaid-figure";
        var diagram = document.createElement("div");
        diagram.className = "anki-mermaid";
        var note = document.createElement("div");
        note.className = "anki-mermaid-note";
        note.hidden = true;
        element.appendChild(diagram);
        element.appendChild(note);
        panel.appendChild(element);
        return { element: element, diagram: diagram, note: note, key: null };
    }

    function setNote(figure, text, isError) {
        figure.note.textContent = text || "";
        figure.note.hidden = !text;
        figure.note.classList.toggle("is-error", !!isError);
    }

    function refreshPreview(state) {
        var generation = ++state.generation;
        var blocks = state.blocks;
        var figures = state.figures;
        var dark = core.isDark();

        while (figures.length > blocks.length) {
            figures.pop().element.remove();
        }
        while (figures.length < blocks.length) {
            figures.push(createFigure(state.panel));
        }
        state.panel.hidden = blocks.length === 0;

        blocks.forEach(function (block, index) {
            var figure = figures[index];
            var hint = block.closed ? "" : UNCLOSED_HINT;
            if (!block.source) {
                figure.diagram.textContent = "";
                figure.element.classList.remove("is-stale");
                figure.key = null;
                setNote(figure, block.closed ? EMPTY_HINT : hint, false);
                return;
            }
            var key = (dark ? "dark" : "light") + "\n" + block.source;
            if (figure.key === key) {
                setNote(figure, hint, false);
                return;
            }
            core.render(block.source, dark).then(function (outcome) {
                if (generation !== state.generation) {
                    return;
                }
                if (outcome.svg) {
                    figure.diagram.innerHTML = outcome.svg;
                    figure.element.classList.remove("is-stale");
                    figure.key = key;
                    setNote(figure, hint, false);
                } else {
                    // Keep the last good drawing, dimmed, while the source is
                    // mid-edit and does not parse.
                    figure.element.classList.add("is-stale");
                    figure.key = null;
                    setNote(figure, outcome.error, true);
                }
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Field tracking                                                     */
    /* ------------------------------------------------------------------ */

    function update(state) {
        state.frame = 0;
        if (!state.host.isConnected) {
            return;
        }
        state.blocks = core.findBlocks(state.editable);
        drawBoxes(state);
        clearTimeout(state.timer);
        state.timer = setTimeout(function () {
            refreshPreview(state);
        }, PREVIEW_DELAY_MS);
    }

    function schedule(state) {
        if (!state.frame) {
            state.frame = requestAnimationFrame(function () {
                update(state);
            });
        }
    }

    function attach(host, editable) {
        var relative = host.parentElement;
        var input = host.closest(".rich-text-input") || relative;

        var layer = document.createElement("div");
        layer.className = "anki-mermaid-boxes";
        // Lets the layer sit behind the text but above the field background.
        relative.style.isolation = "isolate";
        relative.appendChild(layer);

        var panel = document.createElement("div");
        panel.className = "anki-mermaid-preview";
        panel.hidden = true;
        input.appendChild(panel);

        var state = {
            host: host,
            editable: editable,
            relative: relative,
            layer: layer,
            panel: panel,
            blocks: [],
            figures: [],
            generation: 0,
            frame: 0,
            timer: 0,
        };
        state.mutations = new MutationObserver(function () {
            schedule(state);
        });
        state.mutations.observe(editable, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        state.resizes = new ResizeObserver(function () {
            schedule(state);
        });
        state.resizes.observe(host);

        fields.set(host, state);
        schedule(state);
    }

    function detach(host) {
        var state = fields.get(host);
        fields.delete(host);
        state.mutations.disconnect();
        state.resizes.disconnect();
        clearTimeout(state.timer);
        cancelAnimationFrame(state.frame);
        state.layer.remove();
        state.panel.remove();
    }

    function discover() {
        fields.forEach(function (state, host) {
            if (!host.isConnected) {
                detach(host);
            }
        });
        document.querySelectorAll(".rich-text-editable").forEach(function (host) {
            if (fields.has(host)) {
                return;
            }
            var shadow = host.shadowRoot;
            var editable = shadow && shadow.querySelector("anki-editable");
            if (editable) {
                attach(host, editable);
            } else if (shadow && !pendingHosts.has(host)) {
                // The editable is mounted into the shadow root a little after
                // the host appears, which the document observer cannot see.
                pendingHosts.add(host);
                var waiter = new MutationObserver(function () {
                    if (shadow.querySelector("anki-editable")) {
                        waiter.disconnect();
                        discover();
                    }
                });
                waiter.observe(shadow, { childList: true, subtree: true });
            }
        });
    }

    var discoverFrame = 0;
    function scheduleDiscover() {
        if (!discoverFrame) {
            discoverFrame = requestAnimationFrame(function () {
                discoverFrame = 0;
                discover();
            });
        }
    }

    new MutationObserver(scheduleDiscover).observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Redraw the diagrams when Anki switches between light and dark.
    new MutationObserver(function () {
        fields.forEach(function (state) {
            schedule(state);
        });
    }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-bs-theme"],
    });

    window.addEventListener("resize", function () {
        fields.forEach(function (state) {
            schedule(state);
        });
    });

    discover();
})();
