# CWSP-document

Документная поверхность U2RE: открыть Markdown, сверка raw / render, печать и экспорт в DOCX. Синоним пути: `apps/CrossWord`.

Это не только viewer: файл или текст из буфера, стили просмотра, выгрузка `.md` / `.docx`, связка с [`CWSP-crx`](../CWSP-crx/) (CRX Snip и распознавание).

## Возможности

- Open / Paste / drag-and-drop `.md`.
- Режимы Raw и Rendered; заголовки, списки, таблицы, код, картинки, математика в поддерживаемом рендерере.
- Печать через браузер и экспорт в Word (таблицы, ссылки, изображения, формулы — насколько умеет конвертер).
- На хосте артефакт `cw-markdown` (`md.` / `/markdown`).
- CRX Snip: снимок области страницы → AI pipeline (если в Settings задан провайдер). Без провайдера остаётся только захват.

## Команды

```bash
cd apps/CWSP-document   # или apps/CrossWord
npm run dev
npm run build
npm run build:cw-markdown    # → runtime/fastify/apps/cw-markdown
npm run build:capacitor
```

## Структура

```text
apps/CWSP-document/
├── src/frontend/web/cw-markdown/
├── src/frontend/views/
├── src/shared/
└── scripts/
```

SoT документа: `markdown-view`, `subsystem/other/document` (HTML / DOCX). Не править копии под `*/views`.
