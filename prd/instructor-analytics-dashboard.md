# PRD: Instructor Analytics Dashboard

## Problem Statement

Instructors on Cadence currently have no way to understand how their courses are performing at a glance. They can browse a per-student roster and see individual progress, but they cannot answer high-level questions like: "How much have I earned from this course?", "What percentage of my students actually finish?", "At which lesson do most students drop off?", or "Are my quizzes too hard or too easy?" Without aggregated analytics, instructors must mentally piece together patterns from a raw student table — a slow, error-prone process that obscures actionable insights.

## Solution

Add an **Analytics tab** inside the existing course editor. When an instructor clicks the tab, the platform lazily fetches aggregated statistics for that course and renders four sections:

1. **Summary cards** — three key metrics at a glance: total enrolled students, total gross revenue, and overall course completion rate.
2. **Enrollments & Revenue over time** — a combo chart (enrollment bars + revenue line) showing when students joined and what that generated financially, with granularity that adapts to the course's age.
3. **Lesson drop-off funnel** — a bar chart showing, for each lesson in curriculum order, what percentage of enrolled students completed it. Reveals exactly where students stop progressing.
4. **Quiz score distributions** — for each quiz in the course, a histogram of students' best-attempt scores across five fixed buckets, with a reference line at the passing threshold.

## User Stories

1. As an instructor, I want to see the total number of students enrolled in my course, so that I can gauge overall reach.
2. As an instructor, I want to see my course's total gross revenue in dollars, so that I can understand the financial return on my content investment.
3. As an instructor, I want courses with no purchases to show $0.00 revenue rather than hiding the metric, so that I know the course has had no paid conversions.
4. As an instructor, I want to see the overall completion rate for my course as a percentage, so that I can judge whether students find value all the way through.
5. As an instructor, I want the Analytics tab to load its data only when I first click it, so that the course editor stays fast when I just want to edit content.
6. As an instructor, I want analytics data to remain visible when I switch to another tab and come back, so that I do not have to wait for a reload every time.
7. As an instructor, I want to see skeleton placeholders while analytics are loading, so that I know something is coming and the page does not feel broken.
8. As an instructor, I want to see a chart of new enrollments over time, so that I can identify when my course attracted the most students (e.g., after a promotion).
9. As an instructor, I want to see revenue over time on the same chart as enrollments, so that I can correlate enrollment spikes with earnings without switching views.
10. As an instructor, I want the time chart to use weekly buckets when my course is less than 90 days old, and monthly buckets otherwise, so that the chart is always appropriately granular and readable.
11. As an instructor, I want to see a drop-off funnel for my lessons, so that I can identify which lesson causes the most students to stop progressing.
12. As an instructor, I want the drop-off funnel to show lessons in full curriculum order (module position first, then lesson position within each module), so that the funnel reflects the actual sequence a student experiences.
13. As an instructor, I want each bar in the drop-off funnel to show the percentage of enrolled students who completed that lesson out of the total enrolled (not just those who reached it), so that I can compare lessons on a consistent scale.
14. As an instructor, I want to understand that a low completion rate on lesson 1 means most students never started, while a low rate on a later lesson means students dropped off mid-course, so that I can correctly interpret the funnel.
15. As an instructor, I want to see quiz score distributions for each quiz in my course, so that I can determine if a quiz is too hard, too easy, or well-calibrated.
16. As an instructor, I want quiz scores grouped into five fixed buckets (0–20%, 20–40%, 40–60%, 60–80%, 80–100%), so that I can quickly see the shape of the score distribution.
17. As an instructor, I want a vertical reference line on each quiz histogram marking the passing score threshold, so that I can immediately see how many students passed versus failed.
18. As an instructor, I want to see one histogram section per quiz in the course, so that I can compare difficulty across quizzes.
19. As an instructor, I want the quiz distributions section to be hidden entirely when my course has no quizzes, so that the page does not show an empty or confusing section.
20. As an instructor, I want the analytics tab to be accessible from the same course editor I already use, so that I do not have to navigate to a separate page to find analytics.
21. As an instructor, I want the analytics tab to exist alongside the existing Students tab (not replace it), so that I can still inspect individual students when needed.
22. As an instructor, I want to see a clear empty state when my course has zero enrollments, so that I understand the data is absent rather than broken.

## Implementation Decisions

### Placement
- The Analytics tab is added as a new tab inside the existing course editor (alongside Content, Settings, Sales Copy, and Students). It is a client-side tab switch, not a new route.

### Data Loading Strategy
- Analytics data is **not** loaded in the course editor's main loader. Instead, a `useFetcher` triggers a GET request to a dedicated analytics API route when the instructor **first** clicks the Analytics tab.
- A boolean flag (e.g., `hasLoadedAnalytics`) tracks whether the fetch has already been triggered. Subsequent tab switches reuse the data already in the fetcher — no re-fetch occurs. This means analytics data is fresh for the lifetime of the page visit but does not update live.
- The API route is scoped to a single course and requires the requesting user to be an Instructor or Admin who owns that course.

### API Route Contract
- **Route:** `api.course-analytics.$courseId` (GET)
- **Auth:** Must be authenticated as an Instructor or Admin who owns the course. Returns 401 if unauthenticated, 403 if unauthorized, 404 if the course does not exist.
- **Response — summary:**
  - `totalEnrolled: number`
  - `totalRevenueCents: number` — sum of all `purchases.pricePaid` for this course; 0 if no purchases.
  - `completionRate: number` — percentage (0–100) of enrolled students who have `enrollments.completedAt` set.
- **Response — time series:**
  - `granularity: "weekly" | "monthly"` — weekly if the earliest enrollment or purchase timestamp is within the last 90 days relative to today; monthly otherwise. If there are no enrollments and no purchases, default to monthly.
  - `timeSeries: Array<{ label: string; enrollments: number; revenueCents: number }>` — each entry is one time bucket. `label` is a human-readable string (e.g., "Jan 2025" or "Week of Mar 3"). All revenue values in this array are in cents; the UI converts to dollars for display.
- **Response — drop-off:**
  - `lessonDropoff: Array<{ lessonId: number; title: string; completionRate: number }>` — sorted by full curriculum order: modules sorted by `modules.position`, then lessons sorted by `lessons.position` within each module. `completionRate` = (count of students with `lessonProgress.status = 'completed'` for that lesson) ÷ `totalEnrolled` × 100. If `totalEnrolled` is 0, all rates are 0.
- **Response — quiz distributions:**
  - `quizDistributions: Array<{ quizId: number; quizTitle: string; lessonTitle: string; passingScore: number; buckets: [number, number, number, number, number]; totalAttempted: number }>`
  - `buckets` = counts of students (by best attempt score) in ranges [0–0.2), [0.2–0.4), [0.4–0.6), [0.6–0.8), [0.8–1.0]. A score of exactly 1.0 falls in the last bucket.
  - Only the student's best attempt per quiz is counted.
  - `passingScore` is a value between 0 and 1. The UI renders it as a `ReferenceLine` on the histogram's x-axis.
  - Quizzes are ordered by their lesson's full curriculum position (same ordering as drop-off).
  - If the course has no quizzes, this array is empty and the quiz distributions section is not rendered.

### Curriculum Ordering for Drop-off and Quiz Distributions
- Lessons do not have a global position — they have a position within their module, and modules have a position within the course. To produce correct curriculum order, the server must: (1) fetch all modules for the course sorted by `modules.position`, (2) for each module fetch its lessons sorted by `lessons.position`, (3) flatten the result. This produces the same sequence a student experiences.

### Drop-off Signal
- Drop-off is computed exclusively from `lessonProgress.status`. A lesson counts as completed only when `status = 'completed'`. `in_progress` and `not_started` both count as not completed.
- The denominator is always `totalEnrolled` (all enrolled students), not "students who reached that lesson." This means early lessons with low rates indicate students who never started; later lessons with low rates indicate mid-course drop-off.
- `videoWatchEvents` is not used for this feature.

### Quiz Histograms
- Five fixed buckets regardless of passing score (0–20%, 20–40%, 40–60%, 60–80%, 80–100%).
- A vertical `ReferenceLine` (from Recharts' `ComposedChart`) marks the `passingScore` on the x-axis.
- Only the best attempt per student per quiz is counted.

### Combo Chart
- The enrollments + revenue over time chart uses Recharts' `ComposedChart` with a `Bar` series for enrollments (left y-axis) and a `Line` series for revenue (right y-axis, displayed in dollars).
- Both series share the same x-axis (time buckets).

### Charting Library
- **Recharts** is added as a new dependency. It is the only new package required.
- Chart colors use the existing Tailwind CSS variable tokens (e.g., `hsl(var(--primary))`) for theme consistency.

### Loading / Skeleton State
- While the fetcher is in flight (`fetcher.state !== 'idle'`), render skeleton placeholders shaped like the four sections: three card skeletons, and three chart-area skeletons of appropriate height.
- Once data arrives, replace skeletons with live content.

### Empty States
- If `totalEnrolled === 0`: summary cards show 0 / 0% / $0.00, the time chart shows an empty state message ("No enrollment data yet"), and the drop-off funnel is hidden with a message ("No student progress data yet").
- If `quizDistributions` is empty: the entire quiz distributions section is not rendered.

### Revenue Units
- All revenue values in the API response are in cents (integers). The UI is solely responsible for dividing by 100 and formatting as dollars (e.g., "$1,234.56"). No revenue value is ever returned as dollars from the server.

### Existing Students Tab
- The Students tab (per-student roster with progress bars and quiz scores) is left untouched.
- The Analytics tab is purely additive.

## Out of Scope

- **Date range filtering** — The chart always shows all-time data. Preset or custom date range filters are a future enhancement.
- **Cross-course analytics** — A top-level overview page aggregating data across all of an instructor's courses is not part of this PRD.
- **Video watch-depth analytics** — Using `videoWatchEvents` to show how far into a video students watched before dropping off is not included.
- **Platform fee deduction** — Revenue is always gross. Net revenue after platform cuts is a future concern.
- **Real-time / auto-refresh** — Analytics are fetched once on first tab click per page visit. Live updates are out of scope.
- **CSV/export** — No data export functionality.
- **Admin-level analytics** — Cross-instructor or platform-wide analytics are out of scope.

## Further Notes

- No schema migrations are required. All data needed (purchases, enrollments, lessonProgress, quizAttempts, modules, lessons) is already in the database.
- The 90-day threshold for weekly vs. monthly granularity is a soft constant that can be adjusted in the API route if it proves too aggressive or too conservative in practice.
- The drop-off funnel becomes most meaningful with 10 or more enrolled students. For very small cohorts, the percentages can be misleading. A future improvement could display absolute student counts alongside percentages.
- The "fetch once per page visit" strategy means an instructor who enrolls a new student and then opens the Analytics tab in the same browser session will see stale data. This is an acceptable trade-off for the initial version.
