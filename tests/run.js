/*
 * Browser tests for the add-on's JavaScript.
 *
 *     node tests/run.js
 *
 * The pages under tests/pages mimic Anki's reviewer and note editor closely
 * enough to exercise the real add-on files: the same card update sequence, the
 * same field DOM, and the editor's content security policy.
 * Screenshots are written to tests/output/.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { start } = require("./server");

const OUTPUT = path.join(__dirname, "output");
const PYTHON = fs.readFileSync(path.join(__dirname, "..", "anki_mermaid", "__init__.py"), "utf8");

/* Use exactly what the add-on injects, so the tests cannot drift from it. */
const CARD_TRIGGER = /^CARD_TRIGGER = "(.*)"$/m.exec(PYTHON)[1];
const EDITOR_LOADER = /return """\n([\s\S]*?)""" %/
    .exec(PYTHON)[1]
    .replace("%(config)s", "{}")
    .replace("%(base)s", JSON.stringify("/_addons/anki_mermaid/web"));

/* The diagram from the feature request, as the lines a user types. */
const EXAMPLE = [
    "flowchart LR",
    "A --> B -...-> C",
    "",
    "X --o Y --x Z",
    "",
    "1((1)) <--> 2([2]) o==o 3{{3}}",
    "",
];
const EXAMPLE_NODES = 9;
const EXAMPLE_EDGES = 6;

const escapeHtml = (text) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Field HTML where every line ends with <br>. */
const withBr = (lines) => ["```mermaid", ...lines, "```"].map(escapeHtml).join("<br>");

/** Field HTML as Chromium's contenteditable writes it: one <div> per line. */
const withDivs = (lines) =>
    "```mermaid" +
    [...lines, "```"].map((line) => `<div>${escapeHtml(line) || "<br>"}</div>`).join("");

const card = (fieldHtml) => `<div class="front">${fieldHtml}</div>${CARD_TRIGGER}`;

const tests = [];
const test = (name, run) => tests.push({ name, run });

/* ---------------------------------------------------------------------- */
/* Reviewer                                                               */
/* ---------------------------------------------------------------------- */

async function showCard(page, html, bodyClass = "card card1") {
    await page.evaluate(([h, c]) => window._showQuestion(h, c), [html, bodyClass]);
}

const cardState = (page) =>
    page.evaluate(() => {
        const qa = document.getElementById("qa");
        return {
            diagrams: qa.querySelectorAll(".anki-mermaid svg").length,
            nodes: qa.querySelectorAll(".anki-mermaid svg g.node").length,
            edges: qa.querySelectorAll(".anki-mermaid svg path.flowchart-link").length,
            errors: qa.querySelectorAll(".anki-mermaid-error").length,
            text: qa.innerText,
            shown: window.__shown,
            mermaidLoaded: typeof window.mermaid !== "undefined",
        };
    });

function reviewerTests(context, origin) {
    let page;
    const open = async () => {
        page = await context.newPage();
        page.on("pageerror", (error) => assert.fail(`page error: ${error.message}`));
        await page.goto(`${origin}/reviewer.html`);
    };

    test("reviewer: a card without a fence never loads Mermaid", async () => {
        await open();
        await showCard(page, '<div class="front">What is the capital of France?</div>');
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 0);
        assert.strictEqual(state.mermaidLoaded, false);
        assert.match(state.text, /capital of France/);
    });

    test("reviewer: an unclosed fence is left as typed", async () => {
        await showCard(page, card("```mermaid<br>flowchart LR<br>A --&gt; B"));
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 0);
        assert.match(state.text, /```mermaid/);
    });

    test("reviewer: <br>-separated example renders, hidden until drawn", async () => {
        await showCard(page, card(withBr(EXAMPLE)));
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 1);
        assert.strictEqual(state.nodes, EXAMPLE_NODES);
        assert.strictEqual(state.edges, EXAMPLE_EDGES);
        assert.strictEqual(state.errors, 0);
        const nodeWidth = await page.evaluate(
            () => document.querySelector("#qa svg g.node rect").getBBox().width,
        );
        assert.ok(nodeWidth < 100, `nodes are sized to their labels (got ${nodeWidth}px)`);
        assert.ok(!state.text.includes("```"), "fence text is gone");
        assert.ok(!state.text.includes("flowchart"), "source text is gone");
        assert.deepStrictEqual(state.shown, { diagrams: 1, errors: 0 });
        await page.screenshot({ path: path.join(OUTPUT, "reviewer-light.png") });
    });

    test("reviewer: <div>-separated example renders and leaves no empty wrappers", async () => {
        await showCard(page, card(withDivs(EXAMPLE)));
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 1);
        assert.strictEqual(state.nodes, EXAMPLE_NODES);
        assert.strictEqual(state.edges, EXAMPLE_EDGES);
        const front = await page.evaluate(() =>
            Array.from(document.querySelector(".front").children).map((el) => el.className),
        );
        assert.deepStrictEqual(front, ["anki-mermaid"]);
    });

    test("reviewer: surrounding text, &nbsp; and inline formatting are handled", async () => {
        const field =
            "Before the diagram<br>" +
            "```mermaid&nbsp;<br>" +
            "<span style=\"color: rgb(0, 0, 0);\">flowchart&nbsp;LR</span><br>" +
            "&nbsp; A --&gt; <b>B</b><br>" +
            "```<br>" +
            "After the diagram";
        await showCard(page, card(field));
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 1);
        assert.strictEqual(state.nodes, 2);
        assert.match(state.text, /^Before the diagram\s+A\s*B\s+After the diagram$/);
    });

    test("reviewer: two blocks in one card both render in order", async () => {
        const field = withBr(["flowchart LR", "First --> One"]) + "<br>and<br>" +
            withDivs(["flowchart LR", "Second --> Two --> Three"]);
        await showCard(page, card(field));
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 2);
        const counts = await page.evaluate(() =>
            Array.from(document.querySelectorAll("#qa .anki-mermaid svg")).map(
                (svg) => svg.querySelectorAll("g.node").length,
            ),
        );
        assert.deepStrictEqual(counts, [2, 3]);
    });

    test("reviewer: newline-separated source in pre-formatted text renders", async () => {
        await showCard(
            page,
            card('<div style="white-space: pre-wrap">```mermaid\nflowchart LR\nA --&gt; B\n```</div>'),
        );
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 1);
        assert.strictEqual(state.nodes, 2);
    });

    test("reviewer: other diagram types render", async () => {
        const field = withBr([
            "sequenceDiagram",
            "Alice->>Bob: Hello",
            "Bob-->>Alice: Hi",
        ]) + "<br>" + withBr(["pie title Pets", '"Dogs" : 3', '"Cats" : 2']);
        await showCard(page, card(field));
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 2);
        assert.strictEqual(state.errors, 0);
    });

    test("reviewer: invalid source becomes a code box with the error", async () => {
        await showCard(page, card(withBr(["flowchart LR", "A --> --> B ((("])));
        const state = await cardState(page);
        assert.strictEqual(state.diagrams, 0);
        assert.strictEqual(state.errors, 1);
        assert.deepStrictEqual(state.shown, { diagrams: 0, errors: 1 });
        const box = await page.evaluate(() => ({
            code: document.querySelector("#qa .anki-mermaid-code").textContent,
            message: document.querySelector("#qa .anki-mermaid-message").textContent,
            strays: document.querySelectorAll("body > :not(#qa):not(script)").length,
        }));
        assert.match(box.code, /^```mermaid\nflowchart LR\nA --> --> B \(\(\(\n```$/);
        assert.ok(box.message.length > 0, "an error message is shown");
        assert.strictEqual(box.strays, 0, "Mermaid left nothing behind in the page");
        await page.screenshot({ path: path.join(OUTPUT, "reviewer-error.png") });
    });

    test("reviewer: night mode uses the dark theme", async () => {
        const fill = () =>
            page.evaluate(() =>
                getComputedStyle(document.querySelector("#qa .anki-mermaid svg .node rect")).fill,
            );
        await showCard(page, card(withBr(EXAMPLE)));
        const light = await fill();
        await showCard(page, card(withBr(EXAMPLE)), "card card1 nightMode night_mode");
        const dark = await fill();
        assert.notStrictEqual(light, dark);
        assert.strictEqual((await cardState(page)).nodes, EXAMPLE_NODES);
        await page.screenshot({ path: path.join(OUTPUT, "reviewer-dark.png") });
        await page.close();
    });
}

/* ---------------------------------------------------------------------- */
/* Editor                                                                 */
/* ---------------------------------------------------------------------- */

function editorTests(context, origin) {
    let page;
    const field = (index) => `.field-container[data-index="${index}"]`;

    const typeLines = async (lines) => {
        for (const line of lines) {
            if (line) {
                await page.keyboard.type(line);
            }
            await page.keyboard.press("Enter");
        }
    };

    const fieldState = (index) =>
        page.evaluate((selector) => {
            const root = document.querySelector(selector);
            const host = root.querySelector(".rich-text-editable");
            const editable = host.shadowRoot.querySelector("anki-editable");
            const panel = root.querySelector(".anki-mermaid-preview");
            const blocks = window.AnkiMermaid.findBlocks(editable);
            const rect = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
            return {
                html: editable.innerHTML,
                closed: blocks.map((block) => block.closed),
                ranges: blocks.map((block) => rect(block.range.getBoundingClientRect())),
                boxes: Array.from(root.querySelectorAll(".anki-mermaid-box")).map((box) =>
                    rect(box.getBoundingClientRect()),
                ),
                host: rect(host.getBoundingClientRect()),
                panelHidden: !panel || panel.hidden,
                diagrams: panel ? panel.querySelectorAll("svg").length : 0,
                nodes: panel ? panel.querySelectorAll("svg g.node").length : 0,
                stale: panel ? panel.querySelectorAll(".is-stale").length : 0,
                notes: panel
                    ? Array.from(panel.querySelectorAll(".anki-mermaid-note:not([hidden])")).map(
                          (note) => note.textContent,
                      )
                    : [],
            };
        }, field(index));

    /** Wait until the debounced preview shows `count` elements matching `selector`. */
    const settled = (index, selector, count) =>
        page.waitForFunction(
            ([fieldSelector, inner, expected]) => {
                const panel = document.querySelector(fieldSelector + " .anki-mermaid-preview");
                return panel && panel.querySelectorAll(inner).length === expected;
            },
            [field(index), selector, count],
            { timeout: 15000 },
        );

    test("editor: add-on scripts load under the editor's content security policy", async () => {
        page = await context.newPage();
        page.on("pageerror", (error) => assert.fail(`page error: ${error.message}`));
        await page.goto(`${origin}/editor.html`);
        await page.evaluate(EDITOR_LOADER);
        await page.waitForFunction(() => window.AnkiMermaidEditor === true);
        // The policy really is enforced: an inline script must be refused.
        await page.evaluate(() => {
            const inline = document.createElement("script");
            inline.textContent = "window.__inlineRan = true";
            document.head.appendChild(inline);
        });
        const result = await page.evaluate(() => ({
            inlineRan: window.__inlineRan === true,
            violations: window.__cspViolations.length,
        }));
        assert.strictEqual(result.inlineRan, false);
        assert.strictEqual(result.violations, 1, "only the deliberate inline script was blocked");
    });

    test("editor: typing an unclosed block draws the box and a live preview", async () => {
        await page.locator(`${field(0)} anki-editable`).click();
        await page.keyboard.type("Describe the flow:");
        await page.keyboard.press("Enter");
        await typeLines(["```mermaid", "flowchart LR", "A --> B"]);
        await settled(0, "svg g.node", 2);
        const state = await fieldState(0);
        assert.deepStrictEqual(state.closed, [false]);
        assert.strictEqual(state.boxes.length, 1);
        assert.strictEqual(state.diagrams, 1);
        assert.strictEqual(state.notes.length, 1);
        assert.match(state.notes[0], /Finish the block/);
    });

    test("editor: the finished example renders and the box frames the code", async () => {
        // Replace the short diagram with the full example.
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Delete");
        await page.keyboard.type("Describe the flow:");
        await page.keyboard.press("Enter");
        await typeLines(["```mermaid", ...EXAMPLE]);
        await page.keyboard.type("```");
        await settled(0, "svg g.node", EXAMPLE_NODES);
        const state = await fieldState(0);
        console.log("      stored field HTML:", state.html);
        assert.deepStrictEqual(state.closed, [true]);
        assert.strictEqual(state.diagrams, 1);
        assert.deepStrictEqual(state.notes, []);
        assert.strictEqual(state.stale, 0);

        const [box] = state.boxes;
        const [range] = state.ranges;
        assert.ok(box.top <= range.top && box.bottom >= range.bottom, "box covers the block");
        assert.ok(box.top > state.host.top, "box starts below the line above the block");
        assert.ok(box.left < state.host.left && box.right > state.host.right, "box spans the field");
        const frame = await page.evaluate(
            (selector) => {
                const r = document.querySelector(selector + " .rich-text-input").getBoundingClientRect();
                return { left: r.left, right: r.right };
            },
            field(0),
        );
        assert.ok(box.left > frame.left && box.right < frame.right, "box stays inside the field frame");
        await page.screenshot({ path: path.join(OUTPUT, "editor-light.png") });
    });

    test("editor: the note content holds only what was typed", async () => {
        const state = await fieldState(0);
        assert.ok(!/anki-mermaid|<svg|<style/.test(state.html), "nothing was injected");
        const text = await page.evaluate(
            (selector) =>
                document.querySelector(selector + " .rich-text-editable").shadowRoot
                    .querySelector("anki-editable").innerText,
            field(0),
        );
        const typed = ["Describe the flow:", "```mermaid", ...EXAMPLE, "```"];
        assert.deepStrictEqual(text.replace(/\n$/, "").split("\n"), typed);
    });

    test("editor: a syntax error keeps the last drawing, dimmed, with the message", async () => {
        // Break the closing line's neighbour: turn the block into invalid source.
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("End");
        await page.keyboard.type(" -->");
        await settled(0, ".is-stale", 1);
        let state = await fieldState(0);
        assert.strictEqual(state.diagrams, 1, "previous drawing is still shown");
        assert.strictEqual(state.notes.length, 1);
        assert.ok(state.notes[0].length > 0);

        for (let i = 0; i < 4; i++) {
            await page.keyboard.press("Backspace");
        }
        await settled(0, ".is-stale", 0);
        state = await fieldState(0);
        assert.strictEqual(state.nodes, EXAMPLE_NODES);
        assert.deepStrictEqual(state.notes, []);
    });

    test("editor: a field mounted late gets its own box and preview", async () => {
        await page.locator(`${field(1)} anki-editable`).click();
        await typeLines(["```mermaid", "flowchart TD", "Start --> Stop"]);
        await page.keyboard.type("```");
        await settled(1, "svg g.node", 2);
        const state = await fieldState(1);
        assert.strictEqual(state.boxes.length, 1);
        assert.strictEqual((await fieldState(0)).nodes, EXAMPLE_NODES, "first field is unaffected");
    });

    test("editor: removing the block removes the box and the preview", async () => {
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Delete");
        await page.keyboard.type("Just text now");
        await page.waitForFunction(
            (selector) => {
                const root = document.querySelector(selector);
                return (
                    root.querySelectorAll(".anki-mermaid-box").length === 0 &&
                    root.querySelector(".anki-mermaid-preview").hidden
                );
            },
            field(1),
        );
    });

    test("editor: switching to dark mode redraws with the dark theme", async () => {
        const fill = () =>
            page.evaluate(
                (selector) =>
                    getComputedStyle(
                        document.querySelector(selector + " .anki-mermaid-preview svg .node rect"),
                    ).fill,
                field(0),
            );
        const light = await fill();
        await page.evaluate(() => document.documentElement.classList.add("night-mode"));
        await page.waitForFunction(
            ([selector, before]) => {
                const rect = document.querySelector(selector + " .anki-mermaid-preview svg .node rect");
                return rect && getComputedStyle(rect).fill !== before;
            },
            [field(0), light],
        );
        await page.screenshot({ path: path.join(OUTPUT, "editor-dark.png") });
    });

    test("editor: nothing the add-on did was blocked by the security policy", async () => {
        const violations = await page.evaluate(() => window.__cspViolations);
        assert.strictEqual(violations.length, 1, violations.join("\n"));
        await page.close();
    });
}

/* ---------------------------------------------------------------------- */

async function main() {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const { server, origin } = await start();
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 900, height: 760 },
        deviceScaleFactor: 2,
    });

    reviewerTests(context, origin);
    editorTests(context, origin);

    let failed = 0;
    for (const { name, run } of tests) {
        try {
            await run();
            console.log(`  ok    ${name}`);
        } catch (error) {
            failed++;
            console.log(`  FAIL  ${name}\n        ${String(error.message).replace(/\n/g, "\n        ")}`);
        }
    }

    await browser.close();
    server.close();
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
