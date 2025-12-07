# SE_HMI_SPIN

## Getting started
## SE_HMI_SPIN

An HMI front-end for SECoP devices built on top of the Spin framework. This repository contains the GUI (HTML/CSS/JS) and a small Spin plugin that discovers SECoP nodes, exposes device parameters to the frontend, and persists visual layouts to disk.

This README explains how to run the project, the recommended development workflow (where to edit files), and troubleshooting steps for layout persistence and asset serving.

### Highlights / Features
- Spin-based HMI page under `content/system.html` (served at runtime via `configuration/`)
- Frontend logic split into `content/system.js` and `content/system.css` for easier editing
- Backend plugin `configuration/node_manager.py`:
	- Discovers SECoP nodes
	- Exposes device parameters to the frontend (`device_params.json`)
	- Saves / lists / serves layout JSON files from project `layout/` directory
- Layout persistence with both localStorage (browser) and server-side save/load

---

## Quick start (development)

Prerequisites:
- Python 3.10+ (for local Spin development)
- Docker and docker-compose (optional; recommended for reproducing the demo environment)

Run locally via Docker Compose (recommended):

```bash
docker compose up -d --build
# or to tail logs
docker compose logs -f
```

Open the browser at the address Spin shows (default: http://localhost:8080) and navigate to the `system` page.

---

## Project layout (important files)

- `content/` — canonical HTML/CSS/JS you should edit during development:
	- `content/system.html` — page markup
	- `content/system.js` — frontend logic (device boxes, layout save/load, Spin handlers)
	- `content/system.css` — styles
- `configuration/` — Spin configuration and runtime files (served from `/c/` by Spin):
	- `configuration/node_manager.py` — Spin plugin that handles discovery and layout persistence
	- `configuration/device_params.json` — device metadata used by the UI
	- `configuration/system.js` and `configuration/system.css` — runtime copies (often symlinked to `content/`)
- `layout/` — server-side saved layout JSON files; the server writes files here on `nodemanager.save_layout`.

Important note: Spin serves `/c/*` assets from the configuration root; the recommended development pattern is to edit files in `content/` and expose them to Spin by creating symlinks (or copies) under `configuration/` so the runtime files are available at `/c/system.js` and `/c/system.css`.

---

## Development workflow (recommended)

1. Edit UI and JS in `content/` (this repository's source-of-truth).
2. Ensure `configuration/system.js` and `configuration/system.css` point to the content versions (symlinks are convenient on macOS/Linux):

	 ```bash
	 ln -s ../content/system.js configuration/system.js
	 ln -s ../content/system.css configuration/system.css
	 ```

3. Start Spin (or restart) so the updated plugin and assets are loaded.
4. Use browser DevTools to inspect `spinupdate` events and network messages.

If your environment doesn't support symlinks (e.g., some Windows setups or container mounts), copy the files into `configuration/` as part of your edit/save workflow or use a file-watcher to sync them.

---

## Layout saving and troubleshooting

Where layouts are stored:

- The UI supports two places for layouts:
	- Browser localStorage (key: `gas_system_layouts`) — quick local saves for the browser session.
	- Server-side `layout/` folder — persistent files saved by the Spin plugin (recommended for sharing and persistence).

How to save a layout to the server:

1. In the UI, click Save and enter a name.
2. The frontend requests `nodemanager.save_layout` — the Spin plugin writes `layout/<name>.json` and replies with the written path.
3. The frontend then requests `nodemanager.list_layouts` and replaces the layout dropdown with the authoritative server list.

If you save and the file does not appear under your *host* project's `layout/` folder, possible causes:

- The plugin wrote the file inside a container but the project directory is not mounted into the container. If you're running Spin inside Docker, make sure the container mounts the repository folder (docker-compose should do this). Check with `docker compose logs -f` to see the plugin's "Saving layout 'NAME' to /path/layout/NAME.json" message.
- File permission issues in the target directory. Ensure the process running Spin can write to `layout/` (chown/chmod or adjust container user).

Quick checks:

- In browser DevTools Console, run:
	- `Spin.send_request('nodemanager.list_layouts', '', 'read', 'read', null)` — forces server to send current list
- In server logs you should see messages like: `Saving layout 'my_layout' to /path/to/project/layout/my_layout.json` and the file should appear there on the host if volumes are configured correctly.

---



## Tests

There are no automated tests included yet. Small, self-contained tests and basic linting (ESLint for JS, flake8 for Python), but in planning.

---

## Authors
Zhengyu Chen, department of Sample Envrionment, Helmholtz Zentrum Berlin.




