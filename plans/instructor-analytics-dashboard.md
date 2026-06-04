# Plan: Instructor Analytics Dashboard

> Source PRD: prd/instructor-analytics-dashboard.md

## Architectural decisions

- **New route**: `api.course-analytics.$courseId` (GET) — dedicated analytics API, auth-gated to course owner (Instructor or Admin). Returns 401/403/404 as appropriate.
- **Data loading**: `useFetcher` triggered on first Analytics tab click. A `hasLoadedAnalytics` boolean flag prevents re-fetching on subsequent tab switches. Data is fresh for the lifetime of the page visit.
- **No schema changes**: All required tables already exist — `enrollments`, `purchases`, `lessonProgress`, `quizAttempts`, `modules`, `lessons`, `quizzes`.
- **Curriculum order**: modules sorted by `modules.position`, then lessons sorted by `lessons.position` within each module.
- **Revenue units**: API always returns cents (integers). UI divides by 100 and formats as dollars.
- **Charting library**: Recharts — added in Phase 5 (first chart).
- **Chart colors**: Tailwind CSS variable tokens (e.g. `hsl(var(--primary))`).

---

## Phase 1: Analytics tab shell

**User stories**: 5, 6, 7, 20, 21

### What to build

Add an "Analytics" `TabsTrigger` and `TabsContent` to the existing course editor tab group (alongside Content, Settings, Sales Copy, Students). The tab content renders skeleton placeholders shaped like the four future sections — three card skeletons and three chart-area skeletons — while the fetcher is in flight. A `hasLoadedAnalytics` ref prevents re-fetching when the instructor switches away and back. No real data is fetched or displayed yet.

### Acceptance criteria

- [ ] Analytics tab appears in the course editor tab list without breaking existing tabs.
- [ ] Clicking the tab for the first time triggers a `useFetcher` GET request to the analytics route.
- [ ] Switching away and back does not trigger a second fetch.
- [ ] While the fetcher is in flight, skeleton placeholders are visible.
- [ ] When the fetcher is idle with no data yet (before first click), the tab content is empty/blank (not broken).

---

## Phase 2: API route scaffold

**User stories**: 5 (auth boundary)

### What to build

Create the `api.course-analytics.$courseId` GET route with full authentication and authorization: returns 401 if unauthenticated, 403 if the requesting user is not the course owner (or Admin), and 404 if the course does not exist. On success, return a hardcoded zero/empty payload that matches the full response contract shape:

```
{
  totalEnrolled: 0,
  totalRevenueCents: 0,
  completionRate: 0,
  granularity: "monthly",
  timeSeries: [],
  lessonDropoff: [],
  quizDistributions: []
}
```

This lets all future phases slot in real data without touching the route's auth or shape.

### Acceptance criteria

- [ ] GET request from an unauthenticated user returns 401.
- [ ] GET request from an authenticated user who does not own the course returns 403.
- [ ] GET request for a non-existent course ID returns 404.
- [ ] GET request from the course owner returns 200 with the correct zero/empty-shaped JSON.
- [ ] The Analytics tab in the UI receives the response and exits the skeleton state (showing zeros/empty sections).

---

## Phase 3: Summary cards

**User stories**: 1, 2, 3, 4, 22

### What to build

Replace the hardcoded zeros in the API with real queries: count rows in `enrollments` for the course (`totalEnrolled`), sum `purchases.pricePaid` for the course (`totalRevenueCents`, defaulting to 0 if no rows), and compute the percentage of enrollments where `completedAt IS NOT NULL` (`completionRate`). In the UI, render three metric cards — Total Students, Gross Revenue (formatted as dollars), and Completion Rate (formatted as a percentage). When `totalEnrolled === 0`, show a clear empty-state message instead of the funnel and time-chart sections (the cards themselves still show 0 / $0.00 / 0%).

### Acceptance criteria

- [ ] Summary cards display the correct enrolled student count.
- [ ] Gross revenue shows $0.00 when there are no purchases.
- [ ] Gross revenue shows the correct dollar amount (sum of `pricePaid` / 100) when purchases exist.
- [ ] Completion rate is a percentage between 0 and 100, computed from `completedAt` presence.
- [ ] When `totalEnrolled === 0`, an empty-state message is shown in place of the chart sections.

---

## Phase 4: Time series API

**User stories**: 8, 9, 10

### What to build

Add the `granularity` and `timeSeries` computation to the API route. Determine granularity by comparing the earliest enrollment or purchase timestamp against today: if within 90 days, use weekly buckets; otherwise monthly. Build the array of `{ label, enrollments, revenueCents }` buckets by grouping `enrollments.enrolledAt` and `purchases.createdAt` into the appropriate time buckets. If there are no enrollments and no purchases, default to monthly and return an empty array.

### Acceptance criteria

- [ ] A course with all enrollments within the last 90 days returns `granularity: "weekly"`.
- [ ] A course with enrollments older than 90 days returns `granularity: "monthly"`.
- [ ] A course with no enrollments and no purchases returns `granularity: "monthly"` and an empty `timeSeries`.
- [ ] Each bucket label is human-readable (e.g. "Jan 2025" or "Week of Mar 3").
- [ ] `revenueCents` in each bucket is the sum of `pricePaid` for purchases in that time window.
- [ ] Buckets with zero enrollments and zero revenue are still included to preserve continuity.

---

## Phase 5: Time series chart UI

**User stories**: 8, 9, 10

### What to build

Install Recharts. Render a `ComposedChart` inside the Analytics tab for the time series data: a `Bar` series for enrollments (left Y-axis) and a `Line` series for revenue in dollars (right Y-axis), both sharing the same X-axis of time bucket labels. When `timeSeries` is empty (zero enrollments), show an inline "No enrollment data yet" empty-state message instead of the chart.

### Acceptance criteria

- [ ] Recharts is added as a dependency and the chart renders without errors.
- [ ] Enrollment bars and revenue line appear on the same chart with their respective Y-axes.
- [ ] Revenue values on the Y-axis and tooltip are displayed in dollars (not cents).
- [ ] X-axis labels match the `label` strings returned by the API.
- [ ] When `timeSeries` is empty, an empty-state message is displayed instead of the chart.

---

## Phase 6: Drop-off API

**User stories**: 11, 12, 13, 14

### What to build

Add `lessonDropoff` to the API route. Fetch all modules for the course ordered by `modules.position`, then for each module fetch its lessons ordered by `lessons.position`. For each lesson, count how many enrolled students have a `lessonProgress` row with `status = 'completed'` and divide by `totalEnrolled` to get the completion rate (0 if `totalEnrolled` is 0). Return the flat array in full curriculum order.

### Acceptance criteria

- [ ] Lessons are returned in module-position-first, then lesson-position order.
- [ ] `completionRate` for each lesson is `completedCount / totalEnrolled * 100` (clamped to 0 when no enrollments).
- [ ] A lesson with no `lessonProgress` rows returns `completionRate: 0`.
- [ ] The array is empty when the course has no lessons.

---

## Phase 7: Drop-off chart UI

**User stories**: 11, 12, 13, 14

### What to build

Render a bar chart (Recharts `BarChart`) for the `lessonDropoff` data. Each bar represents one lesson in curriculum order; the bar height encodes the percentage of enrolled students who completed that lesson out of total enrolled. When `totalEnrolled === 0`, hide the funnel and show a "No student progress data yet" message instead.

### Acceptance criteria

- [ ] Bar chart renders one bar per lesson in curriculum order.
- [ ] Bar height reflects `completionRate` (0–100).
- [ ] Lesson titles appear as X-axis labels (or in tooltips if labels are too long).
- [ ] When `totalEnrolled === 0`, the funnel section is hidden and replaced with an empty-state message.

---

## Phase 8: Quiz distributions API

**User stories**: 15, 16, 17, 18, 19

### What to build

Add `quizDistributions` to the API route. For each quiz in the course (ordered by their lesson's curriculum position), find each student's best attempt score from `quizAttempts` (max `score` per `userId`/`quizId` pair). Bucket the best-attempt scores into five fixed ranges — [0, 0.2), [0.2, 0.4), [0.4, 0.6), [0.6, 0.8), [0.8, 1.0] (with 1.0 falling in the last bucket). Return `quizId`, `quizTitle`, `lessonTitle`, `passingScore`, `buckets` (five counts), and `totalAttempted`. If the course has no quizzes, return an empty array.

### Acceptance criteria

- [ ] Each quiz entry appears in curriculum order (by lesson position).
- [ ] `buckets` contains exactly 5 integers summing to `totalAttempted`.
- [ ] A score of exactly 1.0 falls in the last bucket.
- [ ] Only each student's best attempt is counted (not all attempts).
- [ ] When the course has no quizzes, `quizDistributions` is an empty array.
- [ ] `passingScore` is returned as a value between 0 and 1.

---

## Phase 9: Quiz distributions UI

**User stories**: 15, 16, 17, 18, 19

### What to build

For each entry in `quizDistributions`, render a histogram using Recharts `BarChart` with five bars (one per bucket) and a vertical `ReferenceLine` on the X-axis at the `passingScore` position. Label each histogram with the quiz title and lesson title. When `quizDistributions` is empty, do not render the section at all.

### Acceptance criteria

- [ ] One histogram is rendered per quiz in curriculum order.
- [ ] Each histogram has exactly five bars labeled with their score range.
- [ ] A vertical `ReferenceLine` marks the passing score threshold on each histogram.
- [ ] Quiz title and lesson title are shown above each histogram.
- [ ] When `quizDistributions` is empty, the entire section is absent from the DOM.
