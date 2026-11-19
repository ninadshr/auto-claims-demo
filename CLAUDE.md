# Coding Agent Rules (Greenfield Home Build)
1. **Plan File:** Follow `auto_claims_implementation_plan.md`. Assume a greenfield repo where `src/lib/*`, `src/components/*`, and `tests/*` do not exist yet.
2. **NEVER Read Binary/Media Files:** You are running on a text-only model (`glm-5p3`). NEVER call the `Read` tool on `.jpg`, `.jpeg`, `.png`, `.webp`, or `.pdf` files (causes `API Error: 400 Invalid image or video input`). Verify images strictly via `file <path>` and `ls -lh`.
3. **Missing Sample:** `public/samples/clean_car.jpg` is still missing. Fetch one CC/PD Wikimedia Commons photo of an undamaged/clean car via `curl -L -A "Mozilla/5.0"` and verify with `file` that it outputs `JPEG image data`.
