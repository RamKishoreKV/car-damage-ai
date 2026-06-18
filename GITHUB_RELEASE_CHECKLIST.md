# GitHub Release Checklist — AutoInspect AI

Complete this checklist before pushing the repository to public GitHub.

## Branding & content

- [ ] No company-specific references remain (search for old demo/client names)
- [ ] Root README shows **AutoInspect AI** title and portfolio summary
- [ ] Portfolio screenshots present in `image/` (see `docs/screenshots/README.md`)
- [ ] Demo video link added in `docs/demo/README.md` (if available)

## Secrets & generated files

- [ ] `backend/.env` is **not** committed (only `.env.example`)
- [ ] `frontend/.env` is **not** committed (only `.env.example`)
- [ ] `backend/fleet.db` is gitignored and not staged
- [ ] `backend/uploads/` contents are gitignored (`.gitkeep` only)
- [ ] `backend/outputs/` contents are gitignored (`.gitkeep` only)
- [ ] `backend/evaluation_outputs/` runtime files are gitignored
- [ ] `backend/model/best.pt` and other large weights are **not** committed

## Build & runtime verification

- [ ] `cd frontend && npm run build` succeeds
- [ ] Backend starts: `uvicorn main:app --reload`
- [ ] `GET http://localhost:8000/health` returns OK
- [ ] Frontend starts: `npm run dev`
- [ ] **Single-image inspection** completes successfully
- [ ] **Multi-view inspection** completes successfully
- [ ] **PDF export** downloads from inspection history
- [ ] Fleet dashboard loads with saved inspection data

## Documentation

- [ ] `README.md` — architecture, metrics, setup, screenshots, roadmap
- [ ] `DEMO_CHECKLIST.md` — interactive demo steps
- [ ] `docs/demo/DEMO_SCRIPT.md` — recording script
- [ ] `docs/RESUME_BULLETS.md` — portfolio copy

## Optional polish before publish

- [ ] Add GitHub repo description: _AI-powered vehicle damage inspection for fleets_
- [ ] Add topics: `yolo`, `computer-vision`, `fastapi`, `react`, `fleet-management`, `pytorch`
- [ ] Pin README screenshot hero image (`image/homepage.png`)
- [ ] Add LICENSE file if required by employer or model license

## Do not

- Do not commit API keys, tokens, or personal data
- Do not force-push to `main` unless intentional
- Do not include private client images in screenshots

---

When all items are checked, the repository is ready for public portfolio release.
