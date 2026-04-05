# Shells system preview

Core/System:
- `boot` is choice screen or what shell will be to boot (in CRX is `content`, silently).

UI-wrappers (for content):
- `base` is shell practially without toolbars or anything (can/may contain padding/margin only).

Minor (virtual, with content, containement):
- `minimal`: Minimal UI/UX, focused by single process.
- `tabbed` : variant of `window` with multiple task tabs.
- `window` : is tabbed/toolbar based UI environment, with single focused task. 
  - has at least only two or three elements: toolbar panel, content, and (sometimes) probably sidebar

Major (multiple-tasked, managed):
- `minimal`: Minimal UI/UX, focused by single process.
- `environment`:
  - in underlying generally used wallpapers or canvas.
  - contains/uses multiple layers (underlying, items, content, overlays).
  - shell with status bar, speed dial (home view), taskbar, etc.
  - looks more like a desktop or webtop.
- `content` for CRX/extensions only (chrome extensions content scripts).
  - has layers: content of website, and overlays (include toasts, and snipping).

---

Needs to make much better system of shells (compatibility, nesting)...
- `base`
  - <overlays>
    - <toasts>
    - <modals>
- `minimal`
  - `base`
  - <overlays>
    - <modals>
    - <toasts>
- `content` (CRX/chrome only)
  - <overlays>
    - <sniping>
    - <tools>
    - <toasts>
- `environment`
  - <underlying>
    - <background>
    - <wallpaper>
    - <canvas>
  - <content>
  - `tabbed`
    - `base`
    - <overlays>
    - <modals>
    - <toasts>
  - `window`
    - `base`
    - <overlays>
    - <modals>
    - <toasts>
  - <overlays>
    - <taskbar>
    - <statusbar>
    - <modals>
    - <toasts>

From `window` shell remove those/such statusbar and taskbars...
