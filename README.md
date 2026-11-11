# SE_HMI_SPIN

## Getting started
## SE_HMI_SPIN

An HMI front-end for SECoP devices built on top of the Spin framework. This repository contains the GUI (HTML/CSS/JS) and automatic discovery of SECoP nodes via UDP broadcasting, exposes device parameters to the frontend, and persists visual layouts to disk.


This README explains how to run the project, the recommended development workflow (where to edit files), and troubleshooting steps for layout persistence and asset serving.

### Highlights / Features
- Spin-based HMI page under
- Backend plugin `configuration/node_manager.py`:
	- Discovers SECoP nodes
	- Exposes device parameters to the frontend (`device_params.json`, the json will be automatically generated once you start the application)
	- Saves / lists / serves layout JSON files from project `layout/` directory
- Fast and continuous prototyping of system layout for experiment system with different level of complexity with both localStorage (browser) and server-side save/load

---

## Getting started

Prerequisites:
- Python 3.10+ 
- Docker and docker-compose 

Create your own configuration file `.env`, refer to `.env.example`, then run locally via Docker Compose (recommended):

```bash
docker compose up
# or to tail logs
docker compose logs -f
```

Open the browser at http://localhost:8001.

### GUI pages

Open **Configure system layout** and use **+ Add page** beside the **Main** tab.
Enter a name, then add devices, plots or custom elements to the new page as usual.
Click a page tab to switch pages; pending edits stay with their page.

Select a subpage to **Rename page** or **Remove page**. Removing a page removes
its contents after confirmation. The Main page is kept.

Use **Save layout** to save the Main page and all subpages together. Page tabs
also work in the normal GUI view. Existing layouts open as a single Main page.

After changing frontend source, rebuild and recreate the application container:

```bash
docker compose up -d --build se_hmi_spin
```

Frontend validation (Node.js 20 or newer):

```bash
cd frontend
npm ci
npm run typecheck
npm run build
npx playwright install chromium
npm run test:pages
```

The page tests use mocked API responses and do not connect to devices.








---

## Authors
Zhengyu Chen, department of Sample Envrionment, Helmholtz Zentrum Berlin.




