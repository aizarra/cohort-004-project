# Developer Log — Cadence Course Platform

This file documents every feature we build and every bug we fix, written in a way that helps you understand not just *what* was done, but *why* and *how*. Think of it as a running textbook for this project.

---

## Feature: Instructor Analytics Dashboard — Phase 7 (Quiz Distributions UI)

### What we built

The Analytics tab now renders a **quiz score distribution histogram** for every quiz in the course, completing the analytics feature. Each histogram shows the five fixed score buckets (0–20%, 20–40%, 40–60%, 60–80%, 80–100%) as bars, with a vertical `ReferenceLine` marking the passing threshold. When a course has no quizzes, the entire section is absent from the DOM.

### Why histograms need a different chart than the drop-off funnel

The drop-off funnel had a natural numeric Y-axis (0–100% completion). Quiz distributions, by contrast, show *counts* of students on the Y-axis and *score ranges* on the X-axis — a classic histogram shape. We use Recharts' `BarChart` with a categorical `XAxis` (one bar per bucket label) instead of `ComposedChart`.

### The ReferenceLine and the "bucket snapping" problem

The passing threshold (`passingScore`) is a continuous value between 0 and 1, but our X-axis has only five categorical positions. Recharts' `ReferenceLine` with `x` on a categorical axis must snap to one of those category labels — it cannot float between bars.

We resolve this by computing the **first bucket whose range starts at or above the passing threshold**:

```ts
const passingBucketLabel = BUCKET_LABELS[Math.min(Math.floor(quiz.passingScore / 0.2), 4)];
```

For `passingScore = 0.6`:
- `Math.floor(0.6 / 0.2) = 3` → `"60–80%"`

That bucket and every bar to its right represent passing scores. The ReferenceLine lands on that bucket's bar with a label like `Pass ≥60%`, giving the instructor an instant visual split between failing and passing score ranges.

### Empty states

- If `quiz.totalAttempted === 0`: renders a "No attempts yet" message inside the card (same height as a chart, so the layout stays stable).
- If `quizDistributions.length === 0` (no quizzes in the course): the entire section — including the heading — is not rendered at all.

---

## Feature: Instructor Analytics Dashboard — Phase 6 (Quiz Distributions API)

### What we built

The analytics API route now returns real **quiz score distribution data** instead of an empty stub array. When an instructor views the Analytics tab, the server computes how each student performed across every quiz in the course — grouped into five fixed score buckets — ready for the histogram charts that Phase 7 will render.

### The core design challenge: "best attempt" semantics

Students may take the same quiz multiple times. Counting every attempt would skew the distribution toward low scores (because early, failed attempts would outnumber later, successful ones). Instead, we count only each student's **best** attempt score.

In SQL terms, this is a `GROUP BY (userId, quizId)` with a `MAX(score)` aggregate — one row per student per quiz, keeping only their highest score:

```sql
SELECT quiz_id, MAX(score) AS best_score
FROM quiz_attempts
WHERE quiz_id IN (...)
GROUP BY user_id, quiz_id
```

This gives us a flat list of per-student best scores that we then bucket in JavaScript.

### Curriculum ordering (same as Phase 4's drop-off funnel)

Quizzes don't have a position of their own — they belong to a **lesson**, which belongs to a **module**, which has a position within the course. So we join four tables (`quizzes → lessons → modules → course`) and sort by `modules.position` then `lessons.position`. This guarantees quizzes appear in the exact sequence a student encounters them.

### The five fixed buckets

Scores are real numbers in [0, 1]. We map each score to one of five fixed ranges:

| Bucket | Range       |
|--------|-------------|
| 0      | [0%, 20%)   |
| 1      | [20%, 40%)  |
| 2      | [40%, 60%)  |
| 3      | [60%, 80%)  |
| 4      | [80%, 100%] |

The index formula is `Math.floor(score / 0.2)`, with one special case: a score of exactly `1.0` would yield index `5` (out of range), so we clamp it to `4`. This is a classic **off-by-one at the upper boundary** — always worth a dedicated comment in the code.

### Query efficiency

We make exactly **two** database queries for quiz distributions:
1. `quizzesInOrder` — one JOIN query to get all quizzes in curriculum order.
2. `bestAttemptsRaw` — one query with an `IN` clause to get best scores across all quizzes at once.

We then merge in JavaScript using a `Map<quizId, number[]>`, giving O(1) per-quiz lookup. This is the same pattern used by the Phase 4 drop-off calculation and avoids an N+1 query anti-pattern.

### Empty-course guard

When `quizIds` is an empty array (no quizzes in the course), we skip the `quizAttempts` query entirely and return `quizDistributions: []`. The UI uses this as the signal to omit the section from the DOM completely.

---

## Feature: Instructor Analytics Dashboard — Phase 1 (Tracer Bullet)

### What we built

An **Analytics tab** inside the existing course editor, backed by a dedicated API route that returns aggregated course statistics. This is the thinnest end-to-end slice: it touches every layer (database → API route → UI) and is immediately demoable, which is exactly what a tracer bullet is for.

### New files

- **`app/routes/api.course-analytics.$courseId.ts`** — a GET-only route that computes `totalEnrolled`, `totalRevenueCents`, and `completionRate` from the database, then returns them alongside empty arrays for the chart sections that will be populated in later phases.
- The route is registered in `app/routes.ts` as `api/course-analytics/:courseId`.

### UI changes

`instructor.$courseId.tsx` gains:
- An **Analytics tab trigger** — sits next to the existing Content, Settings, Sales Copy, and Students tabs.
- A `useFetcher` that fires `analyticsFetcher.load(...)` the *first* time the tab is clicked. A `hasLoadedAnalytics` boolean guards against re-fetching on subsequent tab switches.
- **Skeleton placeholders** (animated pulse divs) while the fetcher is in flight.
- **Three summary cards** once data arrives: Total Enrolled, Gross Revenue (formatted from cents to `$X,XXX.XX`), and Completion Rate (as a percentage).
- An **empty state** when `totalEnrolled === 0`, explaining that charts appear once students enroll.

### Key concepts

#### Lazy data loading with useFetcher

Most routes in React Router load data eagerly: the `loader` runs on every navigation to the route. But for the Analytics tab, we deliberately *delay* the fetch until the instructor actually clicks the tab. This keeps the course editor fast when the instructor just wants to edit content.

The pattern looks like this:

```tsx
const analyticsFetcher = useFetcher({ key: `analytics-${course.id}` });
const [hasLoadedAnalytics, setHasLoadedAnalytics] = useState(false);

function handleAnalyticsTabClick() {
  if (!hasLoadedAnalytics) {
    setHasLoadedAnalytics(true);
    analyticsFetcher.load(`/api/course-analytics/${course.id}`);
  }
}
```

`hasLoadedAnalytics` ensures we only ever fire one request per page visit. The `key` prop on `useFetcher` gives us a stable reference — the same fetcher instance is used across renders, so switching tabs and coming back shows the cached data immediately.

#### return vs. throw in fetcher-targeted API routes

This is a subtle but important distinction. When you `throw data(...)` from a loader, React Router's error boundary mechanism activates — it walks up the component tree looking for the nearest error boundary and replaces the matching UI. For a route error on a page you own, that's fine. But for an API route called by a fetcher that targets a *different* route (like `/api/course-analytics/:courseId`), throwing replaces the entire page — the instructor would lose the whole editor view.

The safe pattern: **always `return data(...)` (not `throw`) from API routes that serve fetchers**. Returning keeps the error as the fetcher's `.data` and leaves the rest of the page untouched.

#### Revenue in cents, display in dollars

The API always returns `totalRevenueCents` as an integer (e.g., `4999` for $49.99). The UI is solely responsible for dividing by 100 and formatting:

```tsx
(analyticsData.totalRevenueCents / 100).toLocaleString("en-US", {
  style: "currency",
  currency: "USD",
})
```

This separation of concerns prevents floating-point errors in monetary arithmetic and makes the API response predictable regardless of locale.

---

## Feature: Instructor Analytics Dashboard — Phase 2 (Time Series API)

### What we built

The `api.course-analytics.$courseId` route now populates `granularity` and `timeSeries` with real data. Given a course ID, the API determines whether to bucket activity by week or by month, then returns an ordered array of `{ label, enrollments, revenueCents }` objects that a chart can render directly.

### Changed files

- **`app/routes/api.course-analytics.$courseId.ts`** — added helper functions (`getWeekStart`, `weekKey`, `monthKey`, `weekLabel`, `monthLabel`, `buildTimeSeries`) and replaced the hardcoded `granularity: "monthly", timeSeries: []` stub with real computation.

### Key concepts

#### Determining granularity: a single threshold check

The decision between weekly and monthly detail comes down to one question: *how old is the oldest activity for this course?* We query `MIN(enrolled_at)` and `MIN(created_at)` from the two relevant tables, take the earlier of the two, and compare it to today:

```ts
const granularity: "weekly" | "monthly" =
  earliestTs && Date.now() - new Date(earliestTs).getTime() <= NINETY_DAYS_MS
    ? "weekly"
    : "monthly";
```

If the course has no activity at all, `earliestTs` is `null`, the condition short-circuits to `false`, and we default to `"monthly"` with an empty `timeSeries` array — exactly what the PRD specifies.

#### Generating every bucket, even empty ones

A naive approach would group only the rows that actually exist in the database, skipping periods with zero activity. That produces a chart where bars jump from one non-adjacent date to the next, making it look like a promotion that ran for three weeks was actually a single event. Instead, `buildTimeSeries` enumerates *every* bucket between the earliest timestamp and today, initialises each to zero, then fills in the real counts:

```ts
// weekly: advance by exactly 7 days
let cursor = getWeekStart(earliest);
while (cursor <= getWeekStart(now)) {
  orderedKeys.push(cursor.toISOString().slice(0, 10));
  cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
}
```

This means the chart always shows a continuous timeline, with authentic zeros for quiet periods.

#### Sunday-based weeks and UTC discipline

All date arithmetic uses UTC methods (`getUTCFullYear`, `getUTCDay`, etc.) to avoid surprises from daylight-saving time transitions. Weeks start on Sunday — `getWeekStart` backs up to the preceding Sunday by subtracting `getUTCDay()` days — so "Week of Mar 3" always means the same calendar week regardless of where the server is hosted.

#### Bucket keys as internal identifiers

Each time bucket is identified by an opaque string key (`"2025-03-03"` for a weekly bucket, `"2025-03"` for monthly). These keys are never sent to the client; the UI receives only the human-readable `label`. Using a key that is also a valid date string has a side benefit: lexicographic sort order equals chronological order, which is why `candidates.sort()[0]` correctly picks the earlier of two ISO timestamps.

---

## Feature: Instructor Analytics Dashboard — Phase 3 (Time Series Chart UI)

### What we built

The Analytics tab now renders an **Enrollments & Revenue Over Time** chart. When `timeSeries` has data, a `ComposedChart` from Recharts displays enrollment counts as bars on the left Y-axis and revenue as a line on the right Y-axis — both sharing the same time-bucket X-axis. When `timeSeries` is empty, a "No enrollment data yet" message takes its place.

### Changed files

- **`app/routes/instructor.$courseId.tsx`** — added Recharts imports and replaced the old enrollment-zero empty-state block with the full chart section.
- **`package.json`** — `recharts` added as a dependency.

### Key concepts

#### The ComposedChart: mixing series types on one canvas

Recharts' `ComposedChart` is the component to reach for when you want more than one series type in the same chart. It accepts any combination of `Bar`, `Line`, `Area`, and `Scatter` children. Here, bars encode *count* (enrollments) and a line encodes *money* (revenue) — two quantities with different magnitudes and units.

```tsx
<ComposedChart data={data}>
  <Bar yAxisId="left"  dataKey="enrollments"   />
  <Line yAxisId="right" dataKey="revenueDollars" />
</ComposedChart>
```

Without the `yAxisId` prop, both series would compete on the same scale — a course with 5 enrollments and $500 revenue would make the enrollment bars nearly invisible at 1% the height of the revenue line. Two Y-axes solve this: each series lives on a scale calibrated to its own range.

#### Dual Y-axes: left for counts, right for dollars

Two `<YAxis>` components registered with matching `yAxisId` strings tell Recharts to render a second scale on the opposite side of the chart:

```tsx
<YAxis yAxisId="left"  />                  {/* enrollment count */}
<YAxis yAxisId="right" orientation="right" {/* revenue in dollars */}
  tickFormatter={(v) => v.toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  })}
/>
```

The `tickFormatter` on the right axis converts raw numbers to currency strings so the scale reads "$0", "$500", "$1,000" rather than bare integers.

#### Transforming cents to dollars at the render boundary

The API returns `revenueCents` (an integer) to avoid floating-point arithmetic in the server-side aggregation. The chart transforms it to `revenueDollars` in the `.map()` that builds the chart data array — the one place where UI concerns are allowed to touch monetary values:

```tsx
data={analyticsData.timeSeries.map((b) => ({
  label: b.label,
  enrollments: b.enrollments,
  revenueDollars: b.revenueCents / 100,   // ← only conversion in the UI
}))}
```

The Tooltip `formatter` applies the same rule: format as currency only for the "Revenue" series, leave counts as integers.

#### CSS custom property colors in SVG

Chart colors use the design system tokens defined in `app.css` — `var(--chart-1)` (amber) for enrollment bars and `var(--chart-2)` (teal) for the revenue line. In HTML-embedded SVG (as opposed to standalone `.svg` files), CSS custom properties resolve correctly in `fill` and `stroke` attributes, so Recharts can accept them as plain strings:

```tsx
<Bar  fill="var(--chart-1)" />
<Line stroke="var(--chart-2)" />
```

This keeps the chart visually consistent with the rest of the UI and automatically follows any future theme changes.

---

## Feature: Course Rating

**Commit:** `ee34581 adds rating feature`

### What we built

A star-rating system that lets enrolled students rate a course. The rating is submitted without navigating away from the page, and the UI updates immediately to reflect the new score.

### Key concepts

#### useFetcher — mutations without navigation

Normally in React Router, submitting a form triggers a full navigation cycle: the action runs, then all the loaders for the current page re-run, and the UI updates with fresh data. This is great for most cases, but it's overkill when you just want to record a rating.

`useFetcher` gives you a way to call an action (or loader) *outside* the normal navigation flow. The submission happens in the background, the fetcher has its own `state` (`idle → submitting → loading → idle`), and no navigation occurs.

```tsx
const fetcher = useFetcher();

<fetcher.Form method="post" action="/api/course-rating">
  <input type="hidden" name="courseId" value={course.id} />
  <input type="hidden" name="rating" value={selectedRating} />
  <button type="submit">Submit Rating</button>
</fetcher.Form>
```

#### Optimistic UI

Instead of waiting for the server to respond before showing the updated rating, we can read `fetcher.formData` to know what the user submitted *while the request is still in flight*, and immediately show the new value. If the request fails, the UI would snap back to the real value.

This pattern makes the UI feel instant even though it's still doing a round-trip to the server.

#### API route — loader vs action

In React Router, a route file can export both a `loader` (handles GET requests) and an `action` (handles POST/PUT/DELETE). The `/api/course-rating` route only needs an action because we're only ever *writing* data, never reading it via this endpoint.

```ts
// routes/api.course-rating.ts
export async function action({ request }) {
  // handle POST
}
// No loader needed — nobody GETs this endpoint
```

---

## Feature: Lesson Comments

**Commit:** `ef7c0c2 adds lesson comment feature`

### What we built

A full comment system for lessons: students can open a collapsible comment section below each lesson, read existing comments, post new ones, reply to comments, and delete their own. The instructor can also delete any comment on their lesson.

Comments are written in Markdown and rendered with syntax-highlighted code blocks server-side.

### Database — the schema

We added a new `lesson_comments` table with the following columns:

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Auto-increment primary key |
| `lesson_id` | integer | FK → lessons.id |
| `user_id` | integer | FK → users.id |
| `parent_id` | integer | FK → lesson_comments.id (self-reference, for replies) |
| `body` | text | The raw Markdown content |
| `deleted_at` | text | NULL if not deleted — this is a "soft delete" |
| `created_at` | text | ISO 8601 timestamp |

**Why soft delete?** Instead of permanently removing a row with `DELETE FROM`, we record the deletion time in `deleted_at`. This lets us show "this comment was deleted" in the thread, preserving the context of any replies. A hard delete would leave orphaned replies pointing to nothing.

**Why a self-referencing foreign key for replies?** A top-level comment has `parent_id = NULL`. A reply has `parent_id = <id of parent comment>`. This "adjacency list" model is the simplest way to represent a two-level thread (comments and their replies) in a relational database.

### The API route — `/api/lesson-comments`

This route exports both a `loader` and an `action` because it handles both reading and writing.

#### The loader (GET)

Called by `fetcher.load('/api/lesson-comments?lessonId=X&offset=0')`. It:
1. Validates the user is logged in
2. Confirms the user is enrolled (or is the instructor)
3. Fetches the top-level comments with pagination (`LIMIT` + `OFFSET`)
4. Fetches all replies for those top-level comments in one additional query
5. Renders each comment's `body` from Markdown to HTML on the server

**Why render Markdown on the server?** Two reasons. First, security: we never send raw user Markdown to the client to render, which eliminates a class of XSS risks. Second, we use Shiki for syntax highlighting — Shiki loads language grammars that are large and slow to ship to the browser.

The Shiki highlighter instance is **cached as a module-level singleton** so it's only initialized once per server process, not on every request.

#### The action (POST)

Handles two intents, distinguished by a hidden `intent` field in the form data:

- `intent = "create"` — creates a new comment or reply
- `intent = "delete"` — soft-deletes an existing comment

Using a single action with an `intent` field is a common React Router pattern for routes that need to support multiple mutation types without creating separate endpoints.

#### Input validation with Zod

Rather than manually checking `if (!body || body.length > 5000)`, we define schemas with [Zod](https://zod.dev/):

```ts
const createSchema = z.object({
  intent: z.literal("create"),
  lessonId: z.coerce.number().int().positive(),
  body: z.string().min(1).max(5000),
  parentId: z.coerce.number().int().positive().optional(),
});
```

`z.coerce.number()` automatically converts the string from FormData into a number. If validation fails, we return `{ success: false }` rather than throwing (more on why below).

### The client — LessonComments component

The comment section uses **two separate fetchers**:

| Fetcher | Key | Purpose |
|---|---|---|
| `loaderFetcher` | `comments-load-${lessonId}` | GETs comments from the server |
| `mutateFetcher` | `comments-mutate-${lessonId}` | POSTs creates/deletes |

Giving each fetcher a stable `key` means React Router keeps its state across re-renders. Two fetchers are used because loading and mutating are different concerns — you might want to show a "loading more" spinner independently from a "posting" spinner.

#### Tracking state transitions with useRef

React's `useEffect` fires whenever its dependencies change, but we often need to know *what changed* — specifically, we want to react to a transition from one state to another (e.g., "loading → idle") not just "state is now idle".

We solve this with a ref that remembers the previous state:

```tsx
const prevLoaderState = useRef(loaderFetcher.state);

useEffect(() => {
  if (prevLoaderState.current !== "idle" && loaderFetcher.state === "idle" && loaderFetcher.data) {
    // The fetch just completed — process the results
    setAllComments(loaderFetcher.data.comments);
  }
  prevLoaderState.current = loaderFetcher.state; // remember for next time
}, [loaderFetcher.state, loaderFetcher.data]);
```

A `useRef` is used instead of `useState` because updating a ref does **not** trigger a re-render — it's purely a memory slot for tracking side-effect state.

#### Optimistic comments

When the user hits "Post", we immediately render their comment in a dimmed/translucent style before the server responds. If the server succeeds, we refetch to replace the optimistic version with the real one (including the server-assigned `id` and timestamp).

```tsx
const optimisticBody =
  isMutating &&
  mutateFetcher.formData?.get("intent") === "create" &&
  !mutateFetcher.formData?.get("parentId")
    ? String(mutateFetcher.formData.get("body"))
    : null;
```

---

## Bug Fix: Comments caused "page flicker" and users couldn't post

**Commit:** `8206005 fixes comment bug`

### The symptoms

1. Opening the comment section caused the entire page to visually "flicker or reload"
2. Some users (specifically Emma, a student) reported they couldn't post comments

### Investigation — two separate problems found

#### Problem 1: The root error boundary was rendering on every failed fetch

This was the most severe bug. Here's how it worked:

In React Router, there are two kinds of problems a route can have:
- **Thrown errors from actions/loaders** — these are treated as route errors and handed to the nearest *error boundary*
- **Returned data** — these go into `fetcher.data` and are handled by your component

We were using `throw data("Forbidden", { status: 403 })` in the comment API for all error cases. When a fetcher submits to an *external* route (`/api/lesson-comments`) and that route *throws*, React Router tries to find the nearest error boundary **relative to the API route's ID** — which is not in the current page's route hierarchy at all. So it falls back to the **root** error boundary, replacing the entire application UI.

This is the "page reload" — it wasn't a reload, it was the entire component tree being replaced by the error screen.

```
User clicks "Post" →
  fetcher submits to /api/lesson-comments →
    action throws data("Forbidden", { status: 403 }) →
      React Router calls setFetcherError() →
        findNearestBoundary() can't find /api/lesson-comments in current matches →
          Falls back to root route →
            Root error boundary replaces entire page ← "page reload"
```

**The fix:** Never `throw` from the comment API. Return `{ success: false }` instead. When you *return* (not throw), the data goes to `fetcher.data` and your component stays in control.

```ts
// Before — dangerous:
if (!enrolled) {
  throw data("Forbidden", { status: 403 }); // triggers root error boundary
}

// After — safe:
if (!enrolled) {
  return { success: false }; // goes to mutateFetcher.data, no error boundary
}
```

The client then checks `mutateFetcher.data?.success` and shows a toast if it's false.

**The lesson:** The distinction between `throw` and `return` in a route handler is not just stylistic — it determines whether the error boundary takes over or your component handles it gracefully. For fetchers that target external routes, always `return` errors rather than throw them.

#### Problem 2: The loading skeleton flashed in

When the user clicked "Open Comments", the code called `setIsOpen(true)` (a React state update) and `loaderFetcher.load(...)` (a React Router operation) in the same event handler. React batched the `setIsOpen` call and re-rendered the component, but at that point `loaderFetcher.state` was still `"idle"` because React Router hadn't processed the load yet.

The old skeleton condition was:
```tsx
{isLoading && allComments.length === 0 && (
  <Skeleton />
)}
```

This meant: for one render frame (roughly 16ms), the comments section was open *but neither the skeleton nor comments were shown* — just blank space. On the very next render, `isLoading` became `true` and the skeleton appeared. This brief jump was the "flicker."

**The fix:** Track whether we've ever received comments data with an `everLoaded` boolean. Show the skeleton as long as `everLoaded` is false:

```tsx
const [everLoaded, setEverLoaded] = useState(false);

// In the effect that processes new data:
setEverLoaded(true);

// In the JSX:
{!everLoaded && <Skeleton />}
{everLoaded && allComments.length === 0 && <p>No comments yet.</p>}
```

Now the skeleton appears from the very first render (before `loaderFetcher.state` even switches to `"loading"`), stays until data arrives, then transitions cleanly to either comments or the empty state.

#### Problem 3: Lesson loader was rerunning after comment submissions (preventive fix)

After a fetcher *action* completes, React Router by default reruns all active route loaders to keep the page data fresh. This is useful after most mutations, but when the mutation is a comment (which doesn't change the lesson content, video progress, or enrollment status), it's wasted work — and it caused the navigation loading bar to flash.

We added a `shouldRevalidate` export to the lesson route to opt out of this:

```ts
// In courses.$slug.lessons.$lessonId.tsx
export function shouldRevalidate({ formAction, defaultShouldRevalidate }) {
  if (formAction === "/api/lesson-comments") return false;
  return defaultShouldRevalidate;
}
```

`shouldRevalidate` is called by React Router after every action. If it returns `false`, that route's loader will not re-run for that specific action. The `formAction` argument tells you which endpoint was posted to.

**The lesson:** Not every mutation needs to invalidate every loader. Being selective with `shouldRevalidate` prevents unnecessary server roundtrips and keeps the UI stable.

---

## Concepts Reference

### React Router: throw vs return in route handlers

| | `throw data(...)` | `return data(...)` |
|---|---|---|
| Goes to | Nearest error boundary | `fetcher.data` / `loaderData` |
| For fetchers targeting external routes | Root error boundary (dangerous!) | Stays in component (safe) |
| Best for | Genuine 404s, auth guards in page loaders | Validation errors, "soft" failures in fetcher actions |

### React Router: navigation.state vs fetcher.state

`useNavigation().state` tells you about the *current route navigation* (clicking a Link, the browser loading a new page). It becomes `"loading"` during route transitions and revalidation after actions.

`useFetcher().state` tells you about *a specific background request*. It cycles `idle → submitting → loading → idle` without affecting `navigation.state` at all.

This is why the NavigationLoadingBar (which watches `navigation.state === "loading"`) should not flash during comment operations — fetcher loads and submits are entirely independent of the navigation state.

### SQLite: soft delete vs hard delete

A soft delete sets a `deleted_at` timestamp. The row stays in the database.

```sql
UPDATE lesson_comments SET deleted_at = '2026-06-03T...' WHERE id = 42;
```

A hard delete removes the row permanently:

```sql
DELETE FROM lesson_comments WHERE id = 42;
```

Use soft delete when:
- You need to preserve context (e.g., "this comment was deleted" in a thread)
- You want an audit trail
- Other rows reference the deleted row (FK constraints)

Use hard delete when:
- The data is truly irrelevant after deletion
- You need to comply with data retention laws (GDPR right to erasure)

### Server-side Markdown rendering

Rendering Markdown on the server (rather than the client) has two benefits:

1. **Security** — You can strip dangerous HTML, block raw `<script>` tags, and sanitize links before they ever reach the browser.
2. **Performance** — You can use heavyweight tools like Shiki (which bundles language grammars) without sending that code to every browser.

The tradeoff is that every comment needs a server round-trip to render, which is why we cache the Shiki highlighter as a singleton.

---

## Feature: Lesson Bookmarks

### What we built

A private bookmark system that lets enrolled students save lessons for later reference. Students can toggle a bookmark directly on the lesson page. Everywhere else — the curriculum sidebar and the course detail page — the bookmark icon appears as a passive indicator only, so you can see at a glance which lessons you've already saved.

### Database — the schema

We added a `lesson_bookmarks` table:

| Column | Type | Notes |
|---|---|---|
| `id` | integer | Auto-increment primary key |
| `user_id` | integer | FK → users.id |
| `lesson_id` | integer | FK → lessons.id |
| `created_at` | text | ISO 8601 timestamp |

A unique index on `(user_id, lesson_id)` prevents a student from bookmarking the same lesson twice — the database enforces the one-bookmark-per-lesson rule so we don't have to do it in code.

### The service — `bookmarkService.ts`

Three functions, following the same pattern as `reviewService.ts`:

- **`isLessonBookmarked`** — looks up whether a specific user/lesson pair exists in the table. Returns a boolean. Used by the lesson page loader to know the initial state.
- **`toggleBookmark`** — checks for an existing row: if found, deletes it; if not, inserts one. Returns `{ bookmarked: boolean }` so the caller knows the new state.
- **`getBookmarkedLessonIds`** — takes a `userId` and `courseId`, finds all lesson IDs in that course that the user has bookmarked. Returns a `number[]`. This is the "batch load" used by loaders to avoid N+1 queries.

Note: all these functions take two integer parameters of the same type, so they use object parameters — `opts: { userId: number; lessonId: number }` — rather than positional arguments. This follows the project convention in CLAUDE.md and makes call sites self-documenting.

### Loading strategy — batch upfront, not on demand

A key design decision: both the lesson page loader and the course detail loader call `getBookmarkedLessonIds` during the server request and pass the full list of bookmarked IDs down to the UI as a `number[]`.

This means the bookmark indicators in the sidebar and course detail are **server-rendered** — no extra network requests, no flicker, no loading states. The only time the network is involved is when the user clicks the toggle button.

The component receives the array and converts it to a `Set<number>` at the call site (`new Set(bookmarkedLessonIds)`), so lookups in the render loop are O(1) instead of O(n).

### Optimistic UI on the toggle button

The bookmark toggle button on the lesson page uses a dedicated fetcher:

```tsx
const bookmarkFetcher = useFetcher({ key: `bookmark-${lesson.id}` });
```

The displayed state is computed optimistically: while a toggle request is in flight, we immediately flip the icon without waiting for the server to confirm:

```tsx
const optimisticBookmarked =
  bookmarkFetcher.formData?.get("intent") === "toggle-bookmark"
    ? !isBookmarked
    : isBookmarked;
```

If `formData` is set (meaning a submission is in flight), we assume the opposite of the current server state. If it's `null` (idle), we use the real server value. This makes the icon respond instantly to clicks with no perceptible lag.

### Where the icon appears — two different roles

The bookmark icon plays two different roles across the app:

| Location | Role | Interactive? |
|---|---|---|
| Lesson page metadata row | Toggle button | Yes — click to bookmark/unbookmark |
| Curriculum sidebar (lesson row) | Passive indicator | No |
| Curriculum sidebar (module header) | Passive indicator if any child bookmarked | No |
| Course detail page (lesson row) | Passive indicator | No |
| Course detail page (module card header) | Passive indicator if any child bookmarked | No |

The module-level indicator is useful when a module is collapsed: you can see at a glance that something inside is bookmarked without having to expand it first.

The icon uses `fill="currentColor"` with `text-amber-500` when bookmarked, and `fill="none"` with `text-muted-foreground` for the toggle button's unset state. Passive indicators only appear when bookmarked — there is no "empty" icon in list views.

---

## Feature: Instructor Analytics Dashboard — Phase 4 (Drop-off API)

### What we built

The analytics API now populates **`lessonDropoff`** — previously a placeholder empty array — with real per-lesson completion rates ordered by full curriculum position.

### Changed files

- **`app/routes/api.course-analytics.$courseId.ts`** — replaced the `lessonDropoff: []` stub with two database queries and a JS merge step. Added `asc`, `inArray` to the drizzle-orm import, and `modules`, `lessons`, `lessonProgress` to the schema import.

### Key concepts

#### Curriculum order without a global position column

Lessons don't have a single `position` number that spans the whole course — they have a position *within their module*, and modules have a position *within the course*. To produce the sequence a student actually experiences, you must sort on two levels:

```ts
.orderBy(asc(modules.position), asc(lessons.position))
```

A single JOIN between `lessons` and `modules` is enough to expose both columns; the ORDER BY clause does the rest. This is far cleaner than sorting in application code.

#### One IN query beats N COUNT queries

For each lesson we need a completion count. The naïve approach would fire one `SELECT count(*) FROM lesson_progress WHERE lesson_id = ?` per lesson — an N+1 query pattern. Instead we collect all lesson IDs first, then run a single aggregation query with `inArray`:

```ts
db.select({ lessonId: lessonProgress.lessonId, count: sql<number>`count(*)` })
  .from(lessonProgress)
  .where(and(inArray(lessonProgress.lessonId, lessonIds), eq(lessonProgress.status, "completed")))
  .groupBy(lessonProgress.lessonId)
  .all()
```

The result is a flat array of `{ lessonId, count }` pairs. We load it into a `Map<lessonId, count>` so the final merge loop runs in O(1) per lesson rather than O(lessons × results).

#### The denominator is always `totalEnrolled`

The PRD is deliberate about this: the completion rate for *every* lesson is divided by the *total enrolled* count, not by "students who reached that lesson". This means:

- A 10% rate on lesson 1 → 90% of students never started.
- A 10% rate on lesson 8 → most students dropped off somewhere along the way.

Using a consistent denominator makes every bar in the funnel chart directly comparable, and it means the chart is *monotonically non-increasing* in expectation (each lesson can only have as many completions as earlier ones).

---

## Feature: Instructor Analytics Dashboard — Phase 5 (Drop-off Chart UI)

### What we built

The lesson drop-off data that Phase 4 wired up in the API is now **visible as a bar chart** inside the Analytics tab. Every lesson in curriculum order gets one bar; the bar's height encodes what percentage of enrolled students completed it.

### Changed files

- **`app/routes/instructor.$courseId.tsx`** — added `BarChart` to the Recharts import, then inserted a new "Lesson Drop-off Funnel" card after the time-series chart.

### How the chart works

The `BarChart` receives the `lessonDropoff` array directly as its `data` prop:

```tsx
<BarChart data={analyticsData.lessonDropoff} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
  <XAxis dataKey="title" tick={{ fontSize: 11, angle: -40, textAnchor: "end" }} interval={0} />
  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
  <Tooltip formatter={(value) => [`${value.toFixed(1)}%`, "Completion rate"]} />
  <Bar dataKey="completionRate" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
</BarChart>
```

A few design decisions worth noting:

- **`interval={0}`** forces every lesson title to render on the X-axis, with a `−40°` rotation to prevent overlap. The `bottom: 60` margin gives the angled labels room to breathe below the axis.
- **`domain={[0, 100]}`** pins the Y-axis range to the full 0–100% scale rather than auto-fitting to the data. This makes it immediately obvious when no lesson has a high completion rate — a chart that auto-scales to 30% and fills the height looks healthier than it is.
- **`var(--chart-3)`** for fill color keeps the funnel visually distinct from the enrollment bars (`--chart-1`) and revenue line (`--chart-2`) in the time-series chart above it.

### Empty states

Two distinct empty states cover the cases where the chart has nothing to show:

1. **`totalEnrolled === 0`** — The entire funnel section renders a "No student progress data yet" message. There's no point computing drop-off when nobody has enrolled.
2. **`lessonDropoff.length === 0`** — The course exists but has no lessons yet. The message "No lessons in this course yet" is shown instead of a blank chart area.

### Why a separate BarChart instead of ComposedChart

The time-series card above already uses `ComposedChart` because it needs *two Y-axes* (enrollments left, revenue right) and two series types (Bar + Line). The drop-off funnel is simpler: one series, one axis, uniform bar color. Using plain `BarChart` keeps the component's intent clear and avoids the extra configuration overhead of `ComposedChart`.

---

*This log will be updated as we add more features.*
