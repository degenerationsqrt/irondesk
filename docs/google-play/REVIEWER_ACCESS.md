# Google Play reviewer access

Status: **TEMPLATE — CREDENTIALS MUST NEVER BE COMMITTED TO THIS REPOSITORY**

Google must be able to reach every restricted feature without creating a new account, waiting for an email, supplying a personal phone number, receiving a one-time code from the owner, starting a paid trial, or contacting support. Keep the review account active and reusable for later updates.

Official guidance: [Prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en).

## Reviewer-account requirements

- Dedicated synthetic account used only for Play review.
- Email is already confirmed.
- Password is stable, tested, and stored only in the approved password manager and Play Console's restricted App access field.
- No OTP, MFA, magic-link, CAPTCHA, location restriction, IP allowlist, expiring invitation, or device approval is required.
- Account has access to every feature in the submitted artifact, including any paid/restricted feature.
- Account contains realistic synthetic workouts, history, progress, nutrition, recovery, and imported records but no real person's data.
- Account can create a fresh Health Connect pairing code if companion pairing is part of the submitted build.
- Account is excluded from destructive production automations and ordinary employee offboarding.
- Account health is checked before every submission and periodically while the app remains published.
- Reviewers can delete the review account if they test deletion; the release owner can recreate an equivalent synthetic account and immediately update Play Console access details.

## Secure credential record

Do not fill these values in Git, tickets visible to testers, screenshots, videos, email, or public support channels.

| Field | Private value/location |
| --- | --- |
| Review email | `[ENTER ONLY IN PLAY CONSOLE APP ACCESS AND APPROVED PASSWORD MANAGER]` |
| Review password | `[ENTER ONLY IN PLAY CONSOLE APP ACCESS AND APPROVED PASSWORD MANAGER]` |
| Entitlement/subscription state | `[OWNER INPUT REQUIRED — full access, no purchase required]` |
| Account seed version/date | `[PRIVATE RECORD]` |
| Credential owner and backup owner | `[PRIVATE RECORD]` |
| Last successful clean-device test | `[DATE + PRIVATE EVIDENCE LINK]` |

## Scope gate

Choose exactly one instruction set for the Play form:

- **Scope U — unified IronDesk:** use the first copy block after the unified Android sign-in/Health Connect UX exists and is tested.
- **Scope C — IronDesk Health companion:** use the second copy block with the current pair-from-web flow.

Do not paste both into the Console. Mixed instructions make the review path ambiguous.

## Play Console copy — Scope U unified app

This block is not usable until the unified Android app exists. Replace every bracketed value and verify wording against the exact build.

### Instruction name

`IronDesk full review access`

### Username/email field

`[PLAY CONSOLE SECRET — REVIEW EMAIL]`

### Password field

`[PLAY CONSOLE SECRET — REVIEW PASSWORD]`

### Other instructions

> 1. Open IronDesk and select Sign in.
> 2. Enter the supplied email and password. The account is pre-confirmed and does not require OTP, MFA, a subscription purchase, or external approval.
> 3. The account opens to a synthetic athlete profile. All records are test data.
> 4. To review training, open Workout, select an assigned or available workout, and use the set controls to log reps, load, RPE, and rest. History and Progress contain existing synthetic records.
> 5. To review recovery and nutrition, use Recovery and Nutrition from navigation.
> 6. To review Health Connect, open `[FINAL IN-APP PATH]`, read the rationale, select a minimal set of types, and continue to Android's Health Connect permission screen. Grant or deny types as desired. Return to IronDesk, preview the selected range, then press Sync now. The app can show zero records if the review device has no Health Connect data; existing synthetic imported records are visible in `[FINAL IN-APP PATH]`.
> 7. Health Connect access is read-only and user-initiated. No background health-data read or upload is used. Manage or revoke access from the same screen or Android Health Connect settings.
> 8. To review privacy, open Settings → Privacy or visit https://irondeskpro.lovable.app/privacy.
> 9. To review account deletion, open Settings → Account → Danger zone → Delete my account. The same instructions are available while signed out at https://irondeskpro.lovable.app/account-deletion. Deletion permanently removes this review account; please use it last.
> 10. Support for review access: `[OWNER INPUT REQUIRED — MONITORED PRIVATE SUPPORT EMAIL]`.

Before using this block, replace `[FINAL IN-APP PATH]` with an exact label/path from the signed unified app. Do not describe the current browser-based pairing flow if the unified app no longer uses it.

## Play Console copy — Scope C companion

This block matches the current `app.irondesk.health` design, but the build remains an unsigned engineering private beta. Replace every bracketed value and retest the production routes before use.

### Instruction name

`IronDesk Health pairing and full review access`

### Username/email field

`[PLAY CONSOLE SECRET — REVIEW EMAIL]`

### Password field

`[PLAY CONSOLE SECRET — REVIEW PASSWORD]`

### Other instructions

> IronDesk Health is a companion for an IronDesk account. It does not ask for the account password inside the Android companion.
>
> 1. In a browser, open https://irondeskpro.lovable.app/auth?redirect=%2Fconnections and sign in with the supplied review email and password. The account is pre-confirmed and requires no OTP or MFA.
> 2. Under Health Connect companion, select Generate Android code. The eight-character code is single-use and expires after 15 minutes.
> 3. Open IronDesk Health on Android, enter that fresh code, use any synthetic device label, and select Pair this phone.
> 4. Read the in-app Health Connect rationale. Select only the record types you want to test, then select Grant read access and approve or deny types in Android Health Connect.
> 5. Choose a range and select Preview data. The app may show zero records if the review device contains none. Existing synthetic import history is visible in the browser account.
> 6. Select Sync now. Nothing uploads before that action and there is no background health-data sync.
> 7. Return to the browser's Connections & Imports screen and refresh to view the linked-device/sync result.
> 8. Use Unlink in the companion or browser to revoke the device credential. Health Connect permissions can also be revoked in Android settings.
> 9. The public privacy policy is https://irondeskpro.lovable.app/privacy. Account deletion is under web Settings → Account → Danger zone; signed-out instructions are at https://irondeskpro.lovable.app/account-deletion. Deletion permanently removes this review account, so please use it last.
> 10. Support for review access: `[OWNER INPUT REQUIRED — MONITORED PRIVATE SUPPORT EMAIL]`.

## Reviewer video companion notes

Provide a private, stable video URL in the relevant Play declaration if requested. The video supplements rather than replaces working access.

The video should:

- identify the app name, package, version code/name, and test date without showing a secret;
- use a synthetic account and synthetic Health Connect records;
- show the public privacy policy while signed out;
- show sign-in without exposing the password;
- show pairing only if the submitted scope uses pairing;
- show the rationale before Health Connect permission;
- show one permission granted and another denied;
- show the denied type is skipped and the granted type remains usable;
- show preview before manual sync;
- show the imported result in IronDesk;
- repeat sync to demonstrate deduplication;
- show revoke/unlink and account-deletion controls;
- blur account email, pairing code, tokens, device identifiers, health values, notification content, and browser password-manager UI.

## Clean-room rehearsal

Have a person who did not write these instructions run them from a clean device and browser.

| Check | Result/evidence |
| --- | --- |
| Install from the intended Play track | `[PASS/FAIL + LINK]` |
| Credentials accepted first attempt | `[PASS/FAIL + LINK]` |
| No confirmation/OTP/MFA/intervention | `[PASS/FAIL + LINK]` |
| Full product accessible without purchase | `[PASS/FAIL + LINK]` |
| Core workout path completes | `[PASS/FAIL + LINK]` |
| Health Connect rationale and permission flow reachable | `[PASS/FAIL + LINK]` |
| Zero-data state is clear and non-blocking | `[PASS/FAIL + LINK]` |
| Synthetic prior import visible | `[PASS/FAIL + LINK]` |
| Privacy and deletion links load signed out | `[PASS/FAIL + LINK]` |
| Unlink/revoke works | `[PASS/FAIL + LINK]` |
| Instructions match exact labels | `[PASS/FAIL + LINK]` |
| Support channel monitored | `[PASS/FAIL + LINK]` |

## Failure handling

If the review account, backend, or instructions fail:

1. Do not ask the reviewer to create an account or contact an individual employee.
2. Restore the dedicated account or create an equivalent one using the approved process.
3. Rehearse the complete flow from a clean device.
4. Update Play Console's App access entry immediately; do not commit credentials to Git.
5. If changes are already in review, use Publishing overview according to the current Console workflow and record what changed.
6. Investigate why the account failed and add a recurring credential-health check without logging the secret.

## Sign-off

| Review | Owner | Date | Evidence/result |
| --- | --- | --- | --- |
| Scope-specific copy matches candidate | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Clean-room access rehearsal | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[PRIVATE LINK]` |
| Full/restricted access verified | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[PRIVATE LINK]` |
| Privacy/deletion/revocation verified | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[LINK]` |
| Credentials entered only in approved locations | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[PRIVATE RECORD]` |
| Reviewer video approved | `[OWNER INPUT REQUIRED]` | `[DATE]` | `[PRIVATE LINK]` |
