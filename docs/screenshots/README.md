# AutoInspect AI — Screenshots

Portfolio screenshots are stored in the repo root **`image/`** folder:

| File | Description |
|------|-------------|
| `homepage.png` | Home / hero — inspection landing page |
| `multiview.png` | Multi-view combined report |
| `aiinspecion.png` | AI Inspection Assistant |
| `fleet.png` | Fleet dashboard |
| `history.png` | Inspection history and PDF export |
| `simulator.png` | Robot inspection simulator |
| `Single_image.png` | Legacy single-inspection capture (optional) |

These are embedded in the root [README.md](../../README.md).

## Optional: automated capture

To regenerate screenshots with Playwright (uses your own upload images, not CarDD `test_images/`):

```powershell
# Start backend + frontend first, then:
cd scripts
python capture_portfolio_screenshots.py
```

Output defaults to `docs/screenshots/` with numbered filenames (`01_home_hero.png`, etc.). Copy or replace files in `image/` if you prefer that folder for the README.

## Tips

- Run backend + frontend before capturing.
- Use your own vehicle photos for demos (the portfolio `image/` set was captured with real uploads).
- Blur or crop sensitive vehicle IDs if needed for a public portfolio.
