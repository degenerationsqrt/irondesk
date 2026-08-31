# IronDesk installable web beta launch pack

Status: **DRAFT — OWNER APPROVAL AND LIVE PWA VERIFICATION REQUIRED BEFORE POSTING**

Prepared for the IronDesk Facebook Page and LinkedIn Page. The launch should point to:

`https://irondeskpro.lovable.app`

Use only after the production URL has passed the PWA installation, offline-shell, update, authentication, privacy, and workout-write recovery checks. The posts deliberately describe an **installable web beta**, not a Google Play release or native Android app.

## Positioning

- **Product:** IronDesk
- **Category:** training intelligence and workout execution
- **Core promise:** Plan serious training, log the work, and turn progress and recovery context into clear action.
- **Launch line:** Train with evidence. Progress with intent.
- **Current CTA:** Explore the demo and request beta access.
- **Audience:** strength athletes, hybrid athletes, coaches, and consistent gym users who want more structure than a basic set tracker.

## Truthful claim boundary

Safe to say after the live PWA checks pass:

- Install IronDesk from a supported browser to a phone or desktop home screen.
- Open it in a focused standalone app window.
- Explore a clearly labeled, read-only demo with synthetic athlete data.
- Use the web product for programs, workout logging, history, progress, recovery, nutrition, and imports according to the functions visible in the live app.
- See a clear connection state and recoverable pending-write state when those exact behaviors are verified in production.

Do not say yet:

- Available on Google Play or the App Store.
- Fully offline workouts.
- Health Connect or watch synchronization is publicly available.
- Background synchronization is guaranteed.
- AI-generated coaching is live unless the exact public workflow is independently verified.
- IronDesk prevents injury, diagnoses recovery, or guarantees training results.

## Recommended Facebook Page post

> Training should create evidence—not more guesswork.
>
> We’re opening the IronDesk installable web beta: a focused training command center for planning workouts, logging the work, reviewing progress, and keeping recovery context in view.
>
> What you can explore today:
>
> • A workout-first training dashboard
>
> • Set, rep, load, RPE, and rest tracking
>
> • Programs, history, progress, recovery, and nutrition views
>
> • A mobile-friendly experience you can install from a supported browser
>
> • A clearly labeled demo that uses synthetic data; workout changes made in the demo are not persisted
>
> Explore the demo: https://irondeskpro.lovable.app
>
> We’re also looking for a small group of consistent lifters and coaches to help test the next beta. If you train at least three days a week and want to help shape IronDesk, comment **BETA** or send the Page a message.
>
> Train with evidence. Progress with intent.
>
> #IronDesk #StrengthTraining #TrainingLog #FitnessTechnology

### Short Facebook variant

> IronDesk is now an installable web beta.
>
> Plan serious training, log every set, review your progress, and keep recovery context in one focused workspace.
>
> Explore the read-only demo: https://irondeskpro.lovable.app
>
> Want to help test it? Comment **BETA** or message us.
>
> #IronDesk #StrengthTraining #FitnessTechnology

## Recommended LinkedIn Page post

> We’re opening the IronDesk installable web beta to validate one complete weekly training journey: plan the work, log every set, review progress, and adjust with recovery context.
>
> Today we’re introducing the IronDesk installable web beta—a training intelligence workspace designed around the behavior that matters most: completing the workout and preserving the evidence.
>
> IronDesk brings programs, set-by-set workout execution, training history, progress trends, recovery context, nutrition, and supported activity imports into one responsive product. On supported browsers, it can be installed to the home screen and opened in a focused standalone window.
>
> The public demo is clearly labeled and uses a fixed synthetic athlete. Workout changes made in the demo are not persisted.
>
> We’re recruiting a small group of strength athletes, hybrid athletes, and coaches for structured beta feedback. We want to learn where the current workflow saves time, where it creates friction, and what would make athletes and coaches return each training week.
>
> Explore IronDesk: https://irondeskpro.lovable.app
>
> Want to test IronDesk with your own training? Comment **BETA** or message the Page to join the tester list.
>
> Train with evidence. Progress with intent.
>
> #IronDesk #ProductDevelopment #StrengthTraining #ProgressiveWebApp

### Short LinkedIn variant

> IronDesk is taking an evidence-led path.
>
> We’re validating the complete training journey—program, workout execution, saved history, progress, and recovery context—as an installable web beta before investing in a full native-store launch.
>
> Explore the synthetic-data demo: https://irondeskpro.lovable.app
>
> Want to test IronDesk with your own training? Comment **BETA** or message the Page to join the tester list.
>
> #IronDesk #FitnessTechnology #ProgressiveWebApp

## First comment for either platform

> Beta note: IronDesk is currently an installable web app, not a Google Play or App Store release. Demo mode uses a fixed synthetic athlete, and workout changes made in the demo are not persisted. Native Health Connect and watch integrations remain private engineering work until their device, privacy, and release checks are complete.

## Suggested replies

### “Is it an app?”

> It is currently an installable web app. On supported browsers you can add IronDesk to your home screen and open it in a focused app window. A native store release is a later phase.

### “Is the beta free?”

> Yes. We’re keeping the first beta free while we validate workout reliability, usability, and repeat use.

### “Does the demo save my data?”

> Demo mode uses a fixed synthetic athlete. Workout changes made in the demo are not persisted. A real account is separate from the public demo.

### “Does it connect to Health Connect or my watch?”

> Those integrations are not part of the public web-beta claim. We’re validating native Health Connect and device workflows separately before public distribution.

### “Is this medical advice?”

> No. IronDesk provides general fitness and training information. It is not a medical device and does not diagnose, treat, cure, or prevent a medical condition.

## Visual assets

Generate the checked-in campaign cards with:

```powershell
$env:IRONDESK_SHARP_MODULE = 'C:\Users\johnm\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\sharp'
& 'C:\Users\johnm\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\docs\marketing\build-social-assets.cjs
```

Outputs:

| File | Dimensions | Use |
| --- | ---: | --- |
| `assets/irondesk-pwa-launch-1200x627.png` | 1200 × 627 | LinkedIn URL/Page post and Facebook landscape post |
| `assets/irondesk-pwa-launch-1080x1080.png` | 1080 × 1080 | Square Facebook/LinkedIn feed alternative |

The graphics use the existing IronDesk mark, the existing approved-candidate brand background, and real production-web demo screenshots. They do not use a synthetic athlete photo or represent an unbuilt native screen.

Publishing alt text for either graphic:

> IronDesk installable web beta graphic showing the Today dashboard and an in-progress workout on mobile screens, with the line “Train with evidence. Progress with intent.”

## Pre-publication checklist

- [ ] Owner chooses the long or short copy for each Page.
- [ ] Owner confirms the correct Facebook Page and LinkedIn Page.
- [ ] The account has Facebook Page access that permits creating and publishing Page content, plus LinkedIn super-admin or content-admin access.
- [ ] Production PWA manifest, service worker, icons, install flow, update flow, and offline shell are verified.
- [ ] Production workout writes show no known loss or duplication under the tested retry cases.
- [ ] `https://irondeskpro.lovable.app` and `/privacy` load successfully while signed out.
- [ ] Demo mode is visibly labeled and confirmed not to persist writes.
- [ ] Selected campaign graphic is visually inspected at desktop and mobile-feed size.
- [ ] The publishing alt text is added to the uploaded image on each platform.
- [ ] The final post contains no Google Play, native Android, public Health Connect, medical, or guaranteed-result claim.
- [ ] The support inbox is monitored before comments and beta requests begin.
- [ ] Publish Facebook first, verify the live post and link, then publish LinkedIn and verify it separately.
- [ ] Record publication URLs and a screenshot of each final post.

## Seven-day follow-up

Record separately for Facebook and LinkedIn:

- Reach and impressions
- Link clicks
- Demo starts
- Beta requests
- Qualified tester conversations
- Comments that request a native-only capability
- Sign-ups and first completed workouts attributable to the campaign

Do not use likes alone as the launch decision. The useful signal is whether the posts produce qualified testers who complete workouts and return.
