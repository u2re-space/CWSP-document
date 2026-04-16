Search and read in:
- `/home/u2re-dev/U2RE.space/modules/projects/uniform.ts/src/newer/` (internal)
- `/home/u2re-dev/U2RE.space/runtime/cwsp/endpoint/` (network)

---

## Network stack:

How &ould works our network.

```
[ Laptop/Ultrabook ] Bi-dir  {[ Server (Endpoint), Have External Entry IP ]}
[ L-192.168.0.110  ] ←←---→→ {[ 192.168.0.200:8443 / 45.147.121.152:8443  ]}
          ↑                         ↑                         ↑
          ┷                         ↑                         ↑ 
          |                         ↓                         ↓ 
          ┗------------------{[ [L-192.168.0.196] |- - -| [L-192.168.0.208] ]}   # Phone device groups (cws-androids, PWA-airpad)
                                [Android Phone 1]         [Android Phone 2]
```

### Topology

**L-192.168.0.110 <---> L-192.168.0.196**
- clipboard (via android application, and cwsp endpoint server)
- `airpad` signals (PWA/WebView application)
  - mouse
  - keyboard
  - clipboard
- tunneling through 192.168.0.200:8443 / 45.147.121.152:8443 if in LTE/NAT mode, using identification client token

**L-192.168.0.110 <---> L-192.168.0.208**
- clipboard (via android application, and cwsp endpoint server)
- `airpad` signals (PWA/WebView application)
  - mouse
  - keyboard
  - clipboard
- tunneling through 192.168.0.200:8443 / 45.147.121.152:8443 if in LTE/NAT mode, using identification client token

**L-192.168.0.196 <---> L-192.168.0.208**
- clipboard (via android application, and cwsp endpoint server)
- tunneling through 192.168.0.200:8443 / 45.147.121.152:8443 if one of in LTE/NAT mode, using identification client token

**L-192.168.0.110 <---> {[ 192.168.0.200:8443 / 45.147.121.152:8443 ]}**
- initiated or initiator exchanger (bridge/tunnel/link)
- `L-192.168.0.110` is AirPad controllable (by PWA apps)
  - Or directly, or through bridge/proxy
- `L-192.168.0.110` is one of `clipboard` (and/or other data) synchronize/exchanger member
  - Devices through bridge/proxy can/may ask or pass `clipboard` (and/or other data) data

**{[ 192.168.0.200:8443 / 45.147.121.152:8443 ]}** 
- is in general a central coordinator (bridge, and/or tunnel/proxy)

---

## Potential routes what needs to support

- Airpad (PWA) or Native from `L-192.168.0.196` to https://192.168.0.110:8443/ (local/private network)
- Airpad (PWA) or Native from `L-192.168.0.196` through `https://192.168.0.200:8443/`  to `L-192.168.0.110` (local/private network)
- Airpad (PWA) or Native from `L-192.168.0.196` through `https://45.147.121.152:8443/` to `L-192.168.0.110` (any network of device)
- Native (app) Clipboard (and/or other data) from `L-192.168.0.196` to https://192.168.0.110:8443/ (local network, directly)
- Native (app) Clipboard (and/or other data) from `L-192.168.0.196` to through `https://192.168.0.200:8443/`  to `L-192.168.0.110` (local network, directly)
- Native (app) Clipboard (and/or other data) from `L-192.168.0.196` to through `https://45.147.121.152:8443/` to `L-192.168.0.110` (any network of device)
- CWSP/`endpoint` Clipboard (and/or other data) from `L-192.168.0.110` to https://192.168.0.196:8443/ (rare case, local network, directly)
- CWSP/`endpoint` Clipboard (and/or other data) from `L-192.168.0.110` to through `https://192.168.0.200:8443/`  to `L-192.168.0.196` (local network, directly)
- CWSP/`endpoint` Clipboard (and/or other data) from `L-192.168.0.110` to through `https://45.147.121.152:8443/` to `L-192.168.0.196` (any network of device)

### `L-192.168.0.196` may/can be:

- Simulator/debug client from `45.150.9.153` (VDS), with client token `n3v3rm1nd` instead of IP
- PWA or Native application from NAT (unknown IP, but with client token `n3v3rm1nd` instead of IP)
- PWA or Native application from private/local network with IP `192.168.0.196`.
