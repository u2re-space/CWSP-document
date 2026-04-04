# Shells system preview

Core/System:
- `boot` is choice screen or what shell will be to boot (in CRX is `content`, silently).

UI-wrappers (for content):
- `base` is shell practially without toolbars or anything (can/may contain padding/margin only).
- `window` is virtual window wrapped content shell.

Minor (with content):
- `tabbed` (unmentioned) variant of `window` with multiple task tabs.
- `minimal` is tabbed/toolbar based UI environment, with single focused task. 
  - has at least only two or three elements: toolbar panel, content, and (sometimes) probably sidebar

Major (multiple-tasked):
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
- `content`
  - `window`
    - `base`
    - `minimal`
      - `base`
  - <overlays>
    - <sniping>
    - <tools>
    - <toasts>
- `environment`
  - <underlying>
    - <background>
    - <wallpaper>
    - <canvas>
  - `minimal`
    - <overlays>
    - <modals>
    - <toasts>
  - `window`
    - `base`
    - `minimal`
      - `base`
  - <overlays>
    - <taskbar>
    - <statusbar>
    - <modals>
    - <toasts>

From `window` shell remove those/such statusbar and taskbars...
