---
name: markdown-writing
description: Standards for writing and editing Markdown (.md) files — CommonMark CJK bold/emphasis flanking rules, math delimiters, GFM tables, nested code fences, list indentation, and heading structure. Read before creating or substantially editing .md documents.
---

# Markdown Writing Standards

Follow strict CommonMark + GFM rules so `.md` files render reliably across GitHub, Obsidian, Typora, VS Code, and web renderers.

## 1. Bold & Emphasis Around CJK Punctuation

CommonMark's flanking-delimiter rules break `**...**` when punctuation (`“”‘’《》（）【】：、，。；！？`) sits immediately inside the delimiter next to CJK characters with no surrounding space.

- **Keep outer punctuation outside `**...**`**:
  - Wrong: `这是**“重要”**结论` / `**注意：**请检查`
  - Right: `这是“**重要**”结论` / `**注意**：请检查`
- **If punctuation must stay inside bold**, add a single space outside the delimiter when adjacent to non-space characters: `这是 **“重要”** 结论`.
- Never place spaces directly *inside* `**` (`** 错误 **` does not render).

## 2. Math Formulas (LaTeX / KaTeX)

- Use `$...$` for inline math and `$$` on standalone lines for display math in `.md` files (avoid `\(...\)` / `\[...\]`, which many Markdown editors do not parse).
- Leave no space immediately inside inline `$...$` (`$x + 1$`, not `$ x + 1 $`).
- Always leave a blank line before and after `$$ ... $$` display blocks.
- Escape literal currency `$` as `\$` in prose when another `$` appears in the same paragraph (`\$100`), or wrap shell variables in backticks (`` `$HOME` ``).

## 3. Blank Lines & Headings

- Put a blank line before and after every heading, fenced code block, table, blockquote, list block, and `$$` math block.
- Use one `#` H1 title at the top of the document; do not skip heading levels (`#` -> `##` -> `###`).
- Put a single space after `#` markers and avoid trailing punctuation or bold wrapping on headings (`## 背景`, not `## **背景：**`).

## 4. Code Blocks & Nested Fences

- Always include an explicit info string (language tag) on fenced code blocks (`ts`, `python`, `bash`, `json`, `text`, etc.).
- When showing Markdown that itself contains triple-backtick fences, wrap the outer fence in four backticks (```` ````markdown ````) or tildes (`~~~`).

## 5. GFM Tables & Lists

- Every row in a table (header, `| --- | --- |` delimiter, and body rows) must have the exact same column count. Escape literal `|` inside cells as `\|` and use `<br>` for multi-line cells.
- Indent nested list items to align with the parent item's text start (2 spaces under `- `, 3–4 spaces under `1. `) so sub-lists nest instead of flattening.
- Separate consecutive bullet/numbered lists from preceding paragraphs with a blank line.

## 6. Links & Paths

- Wrap link destinations containing spaces or parentheses in angle brackets (`[notes](<./Chapter 1 (Draft).md>)`) or percent-encode them (`%20`).
- Use standard relative or `file://` links without bare unescaped spaces.
