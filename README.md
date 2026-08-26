# IronDesk Command

Build IronDesk 2.0, a premium training intelligence web app for serious athletes and strength/conditioning users. Start with a polished responsive dashboard inspired by a high-end dark performance dashboard: near-black background, subtle card borders, electric blue primary accent, green for positive/goal-met status, amber for vigorous/intensity, red for peak/warning. Typography should feel condensed, athletic, sharp, and premium. Use TypeScript, Tailwind, shadcn/ui, Recharts or equivalent for charts, and responsive layouts that work beautifully on desktop and mobile.

PRODUCT GOAL
IronDesk should feel like a professional athlete command center, not a generic fitness tracker. The app combines training, conditioning, recovery, nutrition, progress analytics, and AI coaching. Build the first working product shell with realistic mock data and a coherent design system. Prioritize visual quality, usability, and reusable components.

NAVIGATION
Create an app shell with desktop sidebar and mobile bottom navigation. Main routes: Dashboard, Workout, History, Exercises, Progress, Nutrition, Recovery, AI Coach, Settings.

DASHBOARD
Build a dense but clean “Today’s Summary” page. Include:
1. Top header with current date, status line such as “On target”, overall IronScore/strain score, and a grade badge.
2. Activity Strain card with large score and brief interpretation.
3. Cardio vs Muscular Strain horizontal split bar with percentages.
4. Workouts panel with multiple activity cards. Include a cardio session and a weights session. Each activity card should show duration, calories, average heart rate, cardio load, active zone minutes, and zone distribution bars.
5. Heart Rate analytics panel with line chart over time and colored zone threshold lines. Include average HR and a compact legend for Light, Moderate, Vigorous, Peak zones.
6. Time in Heart Rate Zones horizontal bars with duration and percentage.
7. Strength Metrics panel with total sets, total reps, total volume/tonnage, top lift, estimated 1RM delta, and PR indicators.
8. Nutrition Summary with calories, protein, carbs, fat, meal snippets, and macro breakdown chart.
9. Calories In vs Out card with intake estimate, exercise calories burned, net calories, and a semicircle/gauge style visual showing deficit/maintenance/surplus status.
10. Daily Grade panel with Cardio, Strength, Nutrition, Recovery, Consistency, and Overall grades.
11. Suggestions to Improve card with 3 to 5 actionable coaching suggestions.
12. Key Takeaway card with one concise AI-style coaching summary.
13. Add Weekly Load and Recent Progress mini cards if layout allows.

WORKOUT PAGE
Create a realistic active workout experience: workout title, elapsed timer, exercise list, sets/reps/load/RPE entry, rest timer, previous-performance reference, quick add set, notes, exercise substitution, and live totals for volume, sets, reps, and estimated effort. Make this fast to use one-handed on mobile.

HISTORY
Build workout history cards and table view with filters for date, workout type, body part, and intensity. Add a session detail drawer/page.

EXERCISES
Exercise library with search, filters, muscle groups, equipment, favorites, recent exercises, and exercise detail page with history and performance trends.

PROGRESS
Create charts and cards for bodyweight, estimated 1RM, volume, weekly training load, cardio fitness, streaks, and PR history. Include date-range controls.

NUTRITION
Build macro targets, calories consumed, protein/carbs/fat progress, meals, hydration, goal adherence, and weight-goal context.

RECOVERY
Create a readiness score with sleep, resting HR, HRV placeholder, soreness, fatigue, stress, and training recommendation. Use clear language indicating placeholders where wearable data is not yet connected.

AI COACH
Build a dedicated AI Coach page with: Today’s Recommendation, Tomorrow’s Plan, Training Observations, Risk/Load Notes, Suggested Adjustments, and a natural-language ask box. Use realistic deterministic mock insights for now; do not imply live AI integration yet.

SETTINGS
Profile, units, goals, equipment, integrations, notifications, and privacy placeholders.

DESIGN SYSTEM
Create reusable components: StatCard, MetricTile, SectionCard, ScoreBadge, GradeBadge, ProgressBar, ZoneBar, WorkoutCard, InsightCard, ChartCard, EmptyState, Skeleton, MobileNav, Sidebar. Keep spacing tight but not cramped. Use rounded corners moderately, subtle shadows, thin borders, and layered dark surfaces. Avoid neon overload.

BRAND
Use the name “IronDesk” prominently. Create a simple text-based logo treatment for now. Brand voice is serious, disciplined, performance-focused, intelligent, and direct.

MOCK DATA
Seed realistic mock data throughout so every page feels alive. Make sure all navigation works and charts render.

ARCHITECTURE
Keep components modular and data structures typed. Add a mock data/service layer so real Supabase data can replace mocks later without a full rewrite. Add a README or project notes explaining page structure and component organization.

IMPORTANT
Do not merely create a landing page. Build the actual authenticated-app-style product shell and functional dashboard experience first. Make it feel like something that could compete visually with premium fitness and readiness platforms, while keeping IronDesk’s own identity.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://iroirondesk.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/eed18f2c-5219-4d27-b990-ff314dde9ed8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitLab and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
