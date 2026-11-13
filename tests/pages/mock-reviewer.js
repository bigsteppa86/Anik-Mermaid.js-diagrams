/*
 * A cut-down copy of the card update logic in Anki's ts/reviewer/index.ts
 * (26.09): hooks are reset, the card is hidden, its HTML is swapped in, its
 * scripts are re-created so they run, the update hooks are awaited, and only
 * then is the card revealed.
 */
(function () {
    "use strict";

    var onUpdateHook = [];
    var onShownHook = [];

    window.require = function (name) {
        if (name === "anki/reviewer") {
            return { onUpdateHook: onUpdateHook, onShownHook: onShownHook };
        }
        throw new Error("Cannot require " + name);
    };

    function runHook(hooks) {
        var promises = [];
        hooks.forEach(function (hook) {
            try {
                promises.push(hook());
            } catch (error) {
                console.log("Hook failed: ", error);
            }
        });
        return Promise.allSettled(promises);
    }

    function replaceScript(oldScript) {
        return new Promise(function (resolve) {
            var newScript = document.createElement("script");
            var mustWaitForNetwork = true;
            if (oldScript.src) {
                newScript.addEventListener("load", function () {
                    resolve();
                });
                newScript.addEventListener("error", function () {
                    resolve();
                });
            } else {
                mustWaitForNetwork = false;
            }
            Array.from(oldScript.attributes).forEach(function (attribute) {
                newScript.setAttribute(attribute.name, attribute.value);
            });
            newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            oldScript.replaceWith(newScript);
            if (!mustWaitForNetwork) {
                resolve();
            }
        });
    }

    async function setInnerHTML(element, html) {
        element.innerHTML = html;
        for (const oldScript of element.getElementsByTagName("script")) {
            await replaceScript(oldScript);
        }
    }

    /** Resolves once the card is visible, like the end of _updateQA. */
    window._showQuestion = async function (html, bodyclass) {
        document.body.className = bodyclass;
        onUpdateHook.length = 0;
        onShownHook.length = 0;
        var qa = document.getElementById("qa");
        qa.style.opacity = "0";
        await setInnerHTML(qa, html);
        await runHook(onUpdateHook);
        // What the user would see in the first visible frame.
        window.__shown = {
            diagrams: qa.querySelectorAll(".anki-mermaid svg").length,
            errors: qa.querySelectorAll(".anki-mermaid-error").length,
        };
        qa.style.opacity = "1";
        await runHook(onShownHook);
    };
})();
