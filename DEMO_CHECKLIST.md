# AutoInspect AI Demo Checklist

Use this checklist before a product demo or GitHub release.

## 1. Start services

- [ ] **Backend:** `cd backend && venv\Scripts\activate && uvicorn main:app --reload`
- [ ] Confirm `GET http://localhost:8000/health` returns `"status": "ok"`
- [ ] **Frontend:** `cd frontend && npm run dev`
- [ ] Open **http://localhost:5173** — verify **AutoInspect AI** branding in header

## 2. Model weights (first run)

- [ ] If `backend/model/best.pt` is missing, the server auto-downloads from Hugging Face (~125 MB)
- [ ] Optional manual cache: see README → Model Weights section

## 3. Single-image inspection

- [ ] Open **Inspection** tab → **Single Image Inspection**
- [ ] Choose **Vehicle View** (Front recommended for accurate part mapping)
- [ ] Upload a damage photo and click **Detect Damage**
- [ ] Verify annotated output, detection cards, and inspection report
- [ ] Confirm low-confidence detections (&lt; 40%) under **Potential Findings — Needs Verification**
- [ ] Confirm **Rule-Based Localization** badge and **Likely Vehicle Part** labels

## 4. Multi-view inspection

- [ ] Switch to **Multi-View Inspection**
- [ ] Upload Front, Rear, Left Side, Right Side images
- [ ] Click **Run Multi-View Inspection**
- [ ] Review vehicle-level summary and combined report grouped by view

## 5. AI Inspector (optional)

- [ ] Set `AI_INSPECTOR_ENABLED=true` in `backend/.env`
- [ ] Run Ollama: `ollama pull qwen2.5:3b-instruct`
- [ ] Enable **AI Inspector Mode** and run an inspection
- [ ] Confirm **AI Inspection Assistant** card with summary and fleet decision
- [ ] If Ollama offline, confirm: *Using rule-based fallback summary.*

## 6. Fleet Dashboard

- [ ] Open **Fleet Dashboard** tab
- [ ] Confirm stat cards and recent inspections table
- [ ] Verify at least one inspection is saved (`backend/fleet.db`)

## 7. Inspection history

- [ ] Open **History** tab
- [ ] Search by vehicle ID
- [ ] Open inspection detail and **Export PDF**

## 8. Robot Simulator

- [ ] Open **Robot Simulator** tab
- [ ] Run autonomous **simulated capture sequence**
- [ ] Review mission timeline, map, progress, and final combined report

## 9. Product talking points

- [ ] **Product:** AutoInspect AI — fleet vehicle inspection platform
- [ ] **Model:** YOLOv11 segmentation fine-tuned for car damage (local inference)
- [ ] **Metrics:** Top-1 81.7% · Top-3 95.0% · Detection Recall 95.0%
- [ ] **Stack:** FastAPI, React, SQLite, YOLOv11, optional Ollama, PDF export
- [ ] **Roadmap:** Jetson edge, robot cameras, part segmentation model, cloud deployment

## 10. Pre-push sanity check

- [ ] `cd frontend && npm run build` succeeds
- [ ] No `EV Bots` references in source (search project)
- [ ] No secrets committed (`backend/.env`, `fleet.db`, model weights)

---

**Screenshots:** portfolio PNGs are in [`image/`](image/) (see [docs/screenshots/README.md](docs/screenshots/README.md)).

**Demo video:** add link in [docs/demo/README.md](docs/demo/README.md) when recorded. Script: [docs/demo/DEMO_SCRIPT.md](docs/demo/DEMO_SCRIPT.md).

**GitHub release:** complete [GITHUB_RELEASE_CHECKLIST.md](GITHUB_RELEASE_CHECKLIST.md) before pushing.
