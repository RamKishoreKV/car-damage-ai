# AutoInspect AI — Demo Video

## Demo video link

**Demo video:** _Coming soon — add YouTube, Loom, or GitHub link here._

Example format:

```markdown
[![AutoInspect AI Demo](https://img.youtube.com/vi/VIDEO_ID/0.jpg)](https://www.youtube.com/watch?v=VIDEO_ID)
```

## Recommended length

**2–3 minutes** — enough to show the full workflow without losing viewer attention.

## Demo script outline

1. **Introduce AutoInspect AI** — fleet vehicle inspection platform, local YOLO inference
2. **Show evaluation metrics** — 81.7% Top-1, 95.0% Top-3, 95.0% recall on 60-image CarDD set
3. **Single-image inspection** — upload, detect, annotated output, inspection report
4. **Multi-view inspection** — front/rear/sides, combined vehicle-level report
5. **AI Inspector** — optional Ollama summary from structured detections
6. **Fleet Dashboard** — saved inspections and fleet stats
7. **Export PDF** — download inspection report from history
8. **Robot Simulator** — simulated autonomous capture sequence
9. **Roadmap** — Jetson edge, real robot cameras, dedicated part segmentation model

## Full script

See **[DEMO_SCRIPT.md](./DEMO_SCRIPT.md)** for a word-for-word 2–3 minute recording script.

## Recording checklist

- [ ] Backend running (`uvicorn main:app --reload`)
- [ ] Frontend running (`npm run dev`)
- [ ] Model warmed up (one test inference completed)
- [ ] At least one inspection saved to fleet DB for dashboard/history/PDF
- [ ] Microphone clear, 1080p screen capture
- [ ] Close unrelated tabs and notifications

## Related docs

- [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) — full narration script
- [../screenshots/README.md](../screenshots/README.md) — static screenshots for README
- [../../DEMO_CHECKLIST.md](../../DEMO_CHECKLIST.md) — interactive demo checklist
- [../../GITHUB_RELEASE_CHECKLIST.md](../../GITHUB_RELEASE_CHECKLIST.md) — pre-push verification
