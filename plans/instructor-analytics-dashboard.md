# Plan: Instructor Analytics Dashboard

> Source PRD: prd/instructor-analytics-dashboard.md

## Architectural decisions

- **New route**: `api.course-analytics.$courseId` (GET) — dedicated analytics API, auth-gated to course owner (Instructor or Admin). Returns 401/403/404 as appropriate.
- **Data loading**: `useFetcher` triggered on first Analytics tab click. A `hasLoadedAnalytics` boolean flag prevents re-fetching on subsequent tab switches. Data is fresh for the lifetime of the page visit.
- **No schema changes**: All required tables already exist — `enrollments`, `purchases`, `lessonProgress`, `quizAttempts`, `modules`, `lessons`, `quizzes`.
- **Curriculum order**: modules sorted by `modules.position`, then lessons sorted by `lessons.position` within each module.
- **Revenue units**: API always returns cents (integers). UI divides by 100 and formats as dollars.
- **Charting library**: Recharts — added in Phase 3 (first chart).
- **Chart colors**: Tailwind CSS variable tokens (e.g. `hsl(var(--primary))`).

---

## Phase 1: Tracer bullet — Analytics tab + summary cards

**User stories**: 1, 2, 3, 4, 5, 6, 7, 20, 21, 22

### What to build

The thinnest end-to-end slice that touches every layer: add the Analytics tab to the course editor, wire up a `useFetcher` that fires on first click and never re-fires, create the `api.course-analytics.$courseId` GET route with full auth (401/403/404), query real data for `totalEnrolled`, `totalRevenueCents`, and `completionRate`, and render three metric cards. Show skeleton placeholders while loading. Show an empty-state message when `totalEnrolled === 0`. The rest of the response shape (`timeSeries`, `lessonDropoff`, `quizDistributions`) can be returned as empty arrays for now.

### Acceptance criteria

- [x] Analytics tab appears in the course editor alongside existing tabs.
- [x] Clicking it for the first time triggers exactly one GET request to `api.course-analytics.$courseId`.
- [x] Switching away and back does not re-fetch.
- [x] Unauthenticated requests return 401; non-owner requests return 403; missing course returns 404.
- [x] Skeleton placeholders are shown while the fetcher is in flight.
- [x] Three summary cards render with real data: total enrolled students, gross revenue in dollars, completion rate.
- [x] Gross revenue shows $0.00 when there are no purchases.
- [x] When `totalEnrolled === 0`, an empty-state message is shown in place of the chart sections.

---

## Phase 2: Time series API

**User stories**: 8, 9, 10

### What to build

Add `granularity` and `timeSeries` to the API response. Determine granularity by comparing the earliest enrollment or purchase timestamp to today: within 90 days → weekly buckets, otherwise → monthly. Build `{ label, enrollments, revenueCents }` buckets by grouping `enrollments.enrolledAt` and `purchases.createdAt`. Default to monthly with an empty array when there are no enrollments and no purchases.

### Acceptance criteria

- [x] A course with all activity within 90 days returns `granularity: "weekly"`.
- [x] A course with older activity returns `granularity: "monthly"`.
- [x] A course with no activity returns `granularity: "monthly"` and `timeSeries: []`.
- [x] Each bucket label is human-readable (e.g. "Jan 2025" or "Week of Mar 3").
- [x] `revenueCents` per bucket is the sum of `pricePaid` for purchases in that window.

---

## Phase 3: Time series chart UI

**User stories**: 8, 9, 10

### What to build

Install Recharts. Render a `ComposedChart` with a `Bar` series for enrollments (left Y-axis) and a `Line` series for revenue in dollars (right Y-axis), sharing the same X-axis of time bucket labels. Show "No enrollment data yet" when `timeSeries` is empty.

### Acceptance criteria

- [x] Recharts is added as a dependency and the chart renders without errors.
- [x] Enrollment bars and revenue line appear on the same chart with their respective Y-axes.
- [x] Revenue is displayed in dollars on the Y-axis and in tooltips.
- [x] When `timeSeries` is empty, an empty-state message is displayed instead of the chart.

---

## Phase 4: Drop-off API

**User stories**: 11, 12, 13, 14

### What to build

Add `lessonDropoff` to the API response. Fetch modules ordered by `modules.position`, then lessons ordered by `lessons.position` within each module. For each lesson, count students with `lessonProgress.status = 'completed'` and divide by `totalEnrolled` (0 if no enrollments) to get `completionRate`.

### Acceptance criteria

- [x] Lessons are returned in module-position-first, then lesson-position order.
- [x] `completionRate` equals `completedCount / totalEnrolled * 100` (0 when no enrollments).
- [x] A lesson with no progress rows returns `completionRate: 0`.
- [x] Returns an empty array when the course has no lessons.

---

## Phase 5: Drop-off chart UI

**User stories**: 11, 12, 13, 14

### What to build

Render a `BarChart` for `lessonDropoff`. Each bar represents one lesson in curriculum order; height encodes the percentage of enrolled students who completed it. When `totalEnrolled === 0`, hide the section and show "No student progress data yet".

### Acceptance criteria

- [x] One bar per lesson rendered in curriculum order.
- [x] Bar height reflects `completionRate` (0–100).
- [x] Lesson titles appear in tooltips or as X-axis labels.
- [x] When `totalEnrolled === 0`, the section is hidden with an empty-state message.

---

## Phase 6: Quiz distributions API

**User stories**: 15, 16, 17, 18, 19

### What to build

Add `quizDistributions` to the API response. For each quiz (ordered by its lesson's curriculum position), find each student's best attempt score (`MAX(score)` per `userId`/`quizId`). Bucket scores into five fixed ranges: [0, 0.2), [0.2, 0.4), [0.4, 0.6), [0.6, 0.8), [0.8, 1.0] (1.0 falls in the last bucket). Return `quizId`, `quizTitle`, `lessonTitle`, `passingScore` (0–1), `buckets` (five counts), and `totalAttempted`. Return an empty array when the course has no quizzes.

### Acceptance criteria

- [x] Quizzes appear in curriculum order.
- [x] `buckets` has exactly 5 integers summing to `totalAttempted`.
- [x] A score of exactly 1.0 falls in the last bucket.
- [x] Only each student's best attempt is counted.
- [x] Returns `[]` when the course has no quizzes.

---

## Phase 7: Quiz distributions UI

**User stories**: 15, 16, 17, 18, 19

### What to build

For each entry in `quizDistributions`, render a `BarChart` histogram with five bars and a vertical `ReferenceLine` at `passingScore`. Label each histogram with the quiz title and lesson title. When `quizDistributions` is empty, do not render the section at all.

### Acceptance criteria

- [x] One histogram per quiz in curriculum order.
- [x] Each histogram has five bars labeled with their score range (e.g. "0–20%").
- [x] A vertical `ReferenceLine` marks the passing score on each histogram.
- [x] Quiz title and lesson title are displayed above each histogram.
- [x] When `quizDistributions` is empty, the section is absent from the DOM.