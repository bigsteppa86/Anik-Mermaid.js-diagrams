"""Mermaid Diagrams: render ```mermaid fenced blocks in Anki.

All rendering happens in JavaScript (see ``web/``). This module only wires the
scripts into Anki's webviews:

* card views (reviewer, previewer, card layout) get the core script, and each
  card containing a fence gets a one-line trigger appended;
* note editors get the core script plus the live-preview script.
"""

from __future__ import annotations

import json
from typing import Any

from aqt import gui_hooks, mw

ADDON_PACKAGE = mw.addonManager.addonFromModule(__name__)
WEB_BASE = f"/_addons/{ADDON_PACKAGE}/web"
CONFIG_KEYS = ("theme_light", "theme_dark", "look", "layout")

FENCE = "```"
CARD_TRIGGER = "<script>window.AnkiMermaid&&window.AnkiMermaid.onCard();</script>"

mw.addonManager.setWebExports(__name__, r"web/.*")


def _config_json() -> str:
    """The user's settings as a JSON literal that is safe inside <script>."""
    config = mw.addonManager.getConfig(__name__) or {}
    chosen = {key: config[key] for key in CONFIG_KEYS if isinstance(config.get(key), str)}
    return json.dumps(chosen).replace("</", "<\\/")


def _shows_cards(context: Any) -> bool:
    from aqt.browser.previewer import Previewer
    from aqt.clayout import CardLayout
    from aqt.reviewer import Reviewer

    return isinstance(context, (Reviewer, Previewer, CardLayout))


def _on_webview_will_set_content(web_content: Any, context: Any) -> None:
    if not _shows_cards(context):
        return
    web_content.css.append(f"{WEB_BASE}/anki-mermaid.css")
    web_content.js.append(f"{WEB_BASE}/anki-mermaid.js")
    web_content.head += f"<script>window.AnkiMermaidConfig = {_config_json()};</script>"


def _on_card_will_show(text: str, card: Any, kind: str) -> str:
    if FENCE in text:
        return text + CARD_TRIGGER
    return text


def _editor_loader() -> str:
    """JavaScript that pulls the add-on's files into an editor page.

    The editor's content security policy forbids inline scripts but allows
    files served from /_addons/, so the scripts are added as <script src>.
    """
    return """
(function () {
    if (window.__ankiMermaidLoader) { return; }
    window.__ankiMermaidLoader = true;
    window.AnkiMermaidConfig = %(config)s;
    var base = %(base)s;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = base + "/anki-mermaid.css";
    document.head.appendChild(link);
    function add(name, then) {
        var script = document.createElement("script");
        script.src = base + "/" + name;
        script.onload = then || null;
        document.head.appendChild(script);
    }
    add("anki-mermaid.js", function () { add("editor.js"); });
})();
""" % {"config": _config_json(), "base": json.dumps(WEB_BASE)}


def _on_editor_did_init(editor: Any) -> None:
    editor.web.eval(_editor_loader())


gui_hooks.webview_will_set_content.append(_on_webview_will_set_content)
gui_hooks.card_will_show.append(_on_card_will_show)
gui_hooks.editor_did_init.append(_on_editor_did_init)
