# Tabbed Window

Multi-tabbed version of `${view}` process of windowed shell.

| = | Tab A | Tab B | ------------ | mn | mx | x |
|------------------------------------------------|
|   |                                            |
|Sid| Tab A Content (For Example) by `base`      |
|   |                                            |
|------------------------------------------------|

**Under:**
- Tab A Content (`base`)
- Tab B Content (`base`, `hidden`)

Oftenly may be content wrapped with/by `base` shell

**Layers:**
- <ShellUI>
- <Contents>
- <Overlays>

## Compatible with

- `environment` shell (child-process)
- `base` shell (contained)
- `${view}` process (contained)
