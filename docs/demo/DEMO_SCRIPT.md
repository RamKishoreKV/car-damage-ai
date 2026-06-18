# AutoInspect AI — Demo Script (2–3 minutes)

Professional narration script for a portfolio or recruiter demo recording.

---

## [0:00 – 0:20] Introduction

> Hi — this is **AutoInspect AI**, an AI-powered vehicle damage inspection platform I built for fleet operations.
>
> It runs **local YOLOv11 segmentation** to detect damage, generates structured inspection reports, stores fleet history, exports PDFs, and includes an optional **AI inspection assistant** — all without sending images to the cloud.

---

## [0:20 – 0:40] Evaluation metrics

> On a **60-image CarDD evaluation set**, the model reaches **81.7% Top-1 accuracy**, **95.0% Top-3 accuracy**, and **95.0% detection recall**, running on a local **RTX 4070 GPU**.
>
> The stack is **FastAPI**, **React**, **SQLite**, **PyTorch**, and **Ultralytics YOLOv11**.

---

## [0:40 – 1:10] Single-image inspection

> On the **Inspection** tab, I upload a vehicle photo and select the capture view — for example, front.
>
> The backend runs YOLO segmentation and returns damage type, confidence, bounding box, and mask data.
>
> The report includes **likely vehicle part** labels from rule-based localization, severity, and suggested fleet actions. Low-confidence detections are flagged separately as **potential findings** that need verification.

---

## [1:10 – 1:40] Multi-view inspection

> For a full vehicle assessment, I switch to **Multi-View Inspection** and upload front, rear, and side images.
>
> Each view gets its own annotated output. The platform merges everything into one **combined inspection report** with vehicle-level severity and fleet status.

---

## [1:40 – 2:00] AI Inspector (optional)

> With **AI Inspector Mode** enabled, the system sends only structured detection data — not raw images — to a local **Ollama** model for a natural-language summary, risk assessment, and recommended next steps.
>
> If Ollama is offline, it falls back to a rule-based summary automatically.

---

## [2:00 – 2:25] Fleet Dashboard & PDF

> Every inspection is saved to **SQLite**. The **Fleet Dashboard** shows total inspections, high-severity counts, and recent activity.
>
> In **History**, I can search by vehicle ID, review details, and **export a PDF** report for maintenance records.

---

## [2:25 – 2:50] Robot Simulator

> The **Robot Simulator** demonstrates an autonomous inspection workflow — a simulated robot moves around the vehicle, captures multiple views, runs inference, and saves the result to the fleet database.

---

## [2:50 – 3:00] Roadmap & close

> Next steps include **Jetson edge deployment**, **real robot camera integration**, a **dedicated vehicle part segmentation model**, and **cloud deployment** with production authentication.
>
> Thanks for watching — the full project is open on GitHub.

---

## Recording tips

- Speak at a steady pace; pause briefly when switching tabs.
- Zoom browser to 100–110% so UI text is readable in recording.
- Pre-run inspections so dashboard and history are populated.
- Keep cursor movement deliberate — avoid rapid scrolling.
