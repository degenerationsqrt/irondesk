# Google Play artwork and screenshots

Status: **DRAFT ASSETS — BRAND APPROVAL AND FINAL-BUILD RECAPTURE REQUIRED**

These files were prepared on 2026-08-31 for the proposed unified `IronDesk` listing. They are not evidence that a Play app, package, release, or listing has been created.

## Deliverables

| File | Dimensions | Purpose |
| --- | ---: | --- |
| `app-icon-512.png` | 512 × 512 | Play store icon candidate |
| `feature-graphic-1024x500.png` | 1024 × 500 | Play feature graphic candidate |
| `phone-screenshots/01-today-1080x1920.png` | 1080 × 1920 | Real live demo: Today dashboard |
| `phone-screenshots/02-workout-1080x1920.png` | 1080 × 1920 | Real live demo: active workout |
| `phone-screenshots/03-progress-1080x1920.png` | 1080 × 1920 | Real live demo: progress trends |
| `phone-screenshots/04-recovery-1080x1920.png` | 1080 × 1920 | Real live demo: recovery guidance |

The screenshots were captured from `https://irondeskpro.lovable.app` in its explicitly labeled, read-only demo mode at a 540 × 960 CSS viewport and then scaled exactly 2×. The Lovable editor badge was dismissed before each final capture. No personal account, credential, or real health record appears in the images.

These screenshots must be recaptured from the exact signed release candidate before submission. The release-candidate run must confirm that every pictured state is reachable in the submitted Android artifact and that the listing captions do not overstate behavior.

During that recapture, use a neutral synthetic avatar instead of initials and keep a visible demo/test-data indicator on every screen that shows readiness, sleep, heart-rate, training-load, or history metrics. The current files contain no identified person, but consistent synthetic-data labeling removes avoidable reviewer ambiguity.

## Brand sources and generation provenance

The `ID` dumbbell mark comes from the existing tracked source:

`connectiq/irondesk/store-assets/irondesk-icon-source.png`

`feature-graphic-background-generated.png` was created with the built-in image-generation tool and then combined deterministically with the existing mark and text by `build-store-assets.cjs`.

Final background prompt:

```text
Use case: ads-marketing
Asset type: Google Play feature graphic background, wide 2.048:1 composition
Primary request: Create a premium abstract performance-training background for IronDesk, a serious athlete command-center app.
Scene/backdrop: near-black layered graphite panels fading into a subtle technical grid, with restrained electric-blue energy lines, a few small green and amber performance accents, and faint chart/heart-rate geometry.
Style/medium: polished modern 3D-digital brand artwork, sharp and disciplined, not playful.
Composition/framing: very wide landscape; keep the left-center area calmer and readable for a logo and title to be composited later; concentrate the most interesting blue depth and motion toward the right third; no central subject.
Lighting/mood: high-contrast studio glow, premium, focused, intelligent.
Color palette: #07090d, #10141b, electric blue #149cff, small accents #35d07f and #f2ad22.
Constraints: background only; no text, no letters, no logo, no dumbbells, no people, no phones, no UI screenshots, no watermark; avoid neon overload; preserve generous clean negative space.
```

## Rebuild

The build script requires the tooling-only `sharp` package. If it is not already available in the workspace, install it without adding it to the product dependency manifest, or point `IRONDESK_SHARP_MODULE` at a trusted installed copy.

```powershell
$env:IRONDESK_SHARP_MODULE = 'C:\absolute\path\to\node_modules\sharp'
node .\docs\google-play\assets\build-store-assets.cjs
```

The script:

- sanitizes low-alpha generator noise from the tracked source mark;
- rebuilds the opaque 512 × 512 icon;
- rebuilds the 1024 × 500 feature graphic;
- processes raw screenshots from `output/playwright/` when those temporary files exist;
- leaves the checked-in final screenshots unchanged when no temporary screenshot inputs exist.

## Approval checks

- [ ] Owner approves the mark, wordmark, tagline, palette, and use of generated background art.
- [ ] Trademark/name review approves `IronDesk` and the `ID` mark for the intended countries.
- [ ] Icon remains legible under Play's supported masks and at small launcher sizes.
- [ ] Feature graphic contains no inaccurate UI, price, rating, award, device, or health claim.
- [ ] Every screenshot is recaptured from the final Android release candidate.
- [ ] Every metric-bearing screenshot visibly identifies synthetic demo/test data and uses a neutral avatar.
- [ ] No screenshot contains a real name, email, identifier, notification, health record, or reviewer credential.
- [ ] Asset dimensions, file format, transparency, and file size pass the current live Console checks.
- [ ] Only the final icon, feature graphic, and phone screenshots are selected for upload; source art, scripts, and this README remain supporting files.
