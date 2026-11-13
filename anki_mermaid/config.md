These settings control how every diagram is drawn. Reopen the editor or
restart the review session for a change to take effect.

- `theme_light`: Mermaid theme used when Anki is in light mode. Default `default`.
- `theme_dark`: Mermaid theme used when Anki is in dark mode. Default `dark`.
- `look`: `classic` (the familiar Mermaid look), `neo` or `handDrawn`.
- `layout`: `dagre` (classic layout) or `elk`.

Themes include `default`, `dark`, `neutral`, `forest`, `base`, `neo` and
`neo-dark`. A single diagram can override any of these with Mermaid's own
frontmatter, for example:

    ```mermaid
    ---
    config:
      theme: forest
    ---
    flowchart LR
    A --> B
    ```
