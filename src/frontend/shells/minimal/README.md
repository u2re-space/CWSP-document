# Multi-process minimal UI shell

There is container based (alternate of `base`), contained `${view}` process.
Full-screen only process...

|----------------------------------------|
| = | App 1 | App 2 |----------------| & | 
|----------------------------------------|
|   |                                    |
|Sid|  App 1 on focus                    |
|   |                                    |
|----------------------------------------|

**Where:**
- App 1 is in `base` shell.

**Layers:**
- <ShellUI>
- <Contents>
- <Overlays>

## Compatible with

- `base` shell (contained)
- `${view}` process (contained)

Minimal shell (`minimal`) can't be inside virtual `environment` window, but can be inside dedicated real window or view.
For that (similar functional), use `tabbed` window version.
