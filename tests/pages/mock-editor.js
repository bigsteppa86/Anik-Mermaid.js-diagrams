/*
 * Builds the same field structure as Anki's editor (RichTextInput.svelte and
 * ContentEditable.svelte, 26.09): each .rich-text-editable host gets an open
 * shadow root holding the styles and an <anki-editable contenteditable>.
 *
 * Hosts marked data-late mount their editable after a delay, as Anki does
 * while a field's styles are still loading.
 */
(function () {
    "use strict";

    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", function (event) {
        window.__cspViolations.push(event.violatedDirective + " " + event.blockedURI);
    });

    // editable-base.scss + content-editable.scss, plus the per-field "userBase" rule.
    var EDITABLE_CSS =
        "* { max-width: 100%; }" +
        "p { margin-top: 0; margin-bottom: 1rem; }" +
        "pre { white-space: pre-wrap; }" +
        "anki-editable { display: block; position: relative; overflow: auto;" +
        " overflow-wrap: anywhere; word-break: break-word; min-height: 1.5em; }" +
        "anki-editable:focus { outline: none; }" +
        "anki-editable { color: var(--fg); font-family: Arial; font-size: 20px; direction: ltr; }";

    function mountEditable(host) {
        var editable = document.createElement("anki-editable");
        editable.setAttribute("contenteditable", "true");
        editable.setAttribute("role", "textbox");
        editable.setAttribute("tabindex", "0");
        host.shadowRoot.appendChild(editable);
    }

    document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll(".rich-text-editable").forEach(function (host) {
            var shadow = host.attachShadow({ mode: "open" });
            var style = document.createElement("style");
            style.textContent = EDITABLE_CSS;
            shadow.appendChild(style);
            if (host.dataset.late) {
                setTimeout(function () {
                    mountEditable(host);
                }, 400);
            } else {
                mountEditable(host);
            }
        });
    });
})();
