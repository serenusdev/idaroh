# Pondok OS — Design System

> A mobile-first operational platform for the Pondok community. Calm, clear, dependable, and practical in daily use.

## 1. Product and design direction

Pondok OS is an internal platform for santri, pengurus, coordinators, teams, and foundation administrators. It supports daily operations such as attendance, activity reports, schedules, announcements, resources, tasks, and administration.

This is an operational tool—not a marketing website, social network, or decorative dashboard. The interface should help people understand what needs attention and complete routine actions quickly.

### Primary design principle: mobile first

Mobile is the primary experience, not a reduced desktop layout. Many users will access Pondok OS from a phone throughout the day and will not have a laptop available.

- Design and validate the phone layout first, then expand it for tablets and desktop.
- Every essential workflow must be usable on a narrow phone screen.
- Do not hide essential actions, statuses, or information behind desktop-only interactions.
- Prefer short, focused tasks and clear next actions over dense dashboards.
- Desktop may show more information at once, but it must preserve the same hierarchy and workflows.

### Product personality

- **Calm:** no visual noise, excessive gradients, or unnecessary animation.
- **Clear:** labels and statuses are explicit; users should not have to guess.
- **Trustworthy:** administrative and attendance information should feel precise and consistent.
- **Approachable:** friendly rounded surfaces without looking childish or overly playful.
- **Efficient:** common actions should take as few steps as reasonably possible.

### Visual direction: Forest Green, Sand Beige, and Electric Purple

Use **Sand Beige** as the calm foundation, **Forest Green** for structure and primary actions, and **Electric Purple** as a restrained 10% accent for focus, highlights, and selected states. Warm white is used only as a readable content surface—not as a fourth brand color.

Borrow only selected qualities from **Aurora Glass**: subtle color atmosphere, gentle surface layering, and soft transitions. Do not apply heavy glassmorphism throughout the product. Operational screens must remain crisp, readable, fast, and accessible.

The result should feel like a well-designed campus operations system—not a healthcare portal and not a wellness app.

## 2. Responsive strategy

### Breakpoints

Use these breakpoints as layout guidance. Components may adapt fluidly between them.

| Range | Layout intent |
|---|---|
| `< 640px` | Phone-first, single column, bottom navigation, compact page header |
| `640–767px` | Large phone / small tablet, mostly single column |
| `768–1023px` | Tablet, adaptive navigation and two-column layouts where useful |
| `1024–1279px` | Desktop, sidebar navigation and wider content |
| `≥ 1280px` | Wide desktop, centered content with controlled maximum width |

Do not design for a specific device model. Test at widths around 320px, 360px, 390px, 430px, 768px, 1024px, and 1440px.

### Mobile layout rules

- Use a single-column default layout. Add columns only when the content genuinely benefits.
- Keep page gutters around 16px on phones and 24px on larger screens.
- Avoid horizontal page scrolling. If a data table cannot reasonably become cards, contain its horizontal scroll inside the table region and make the overflow discoverable.
- Keep important content near the top. Do not make users scroll past decorative hero areas to reach daily actions.
- Use full-width primary actions when that improves reachability and clarity.
- Keep forms in one column on phones. Use two columns only on sufficiently wide screens and for closely related fields.
- Respect device safe areas, especially for fixed bottom navigation and sticky actions.
- Avoid fixed elements that cover form fields, validation messages, or the final list item.
- Use sticky headers only when they solve a real navigation or context problem.

### Desktop adaptation

At desktop widths, use a persistent left sidebar for primary navigation and a clear top utility area for page context, notifications, and account controls.

- Main content maximum width: approximately 1200px.
- Use a 12-column grid where useful; do not force every page into a complex grid.
- Dashboards may use multiple columns, but operational forms and reading flows should remain focused.
- Tables and administrative data views may use desktop density, with adequate row height and readable spacing.
- Do not simply stretch phone cards to fill a wide screen.

## 3. Navigation and information architecture

Navigation must reflect the user's permissions and responsibilities. A user may hold more than one role, so the interface must not assume that every account has only one identity or workspace.

### Mobile navigation

Use a bottom navigation bar for the most frequently used destinations. Keep it to approximately 3–5 primary items; place less frequent destinations under a clearly named **More** or **Menu** destination.

Suggested starting structure (final visibility depends on role and usage):

1. Beranda
2. Kehadiran
3. Laporan
4. Tugas / Agenda (choose based on the user's most common workflow)
5. Lainnya

Rules:
- Use an icon plus a short text label. Never rely on icons alone for primary navigation.
- Make the active destination visually clear using the primary Forest Green treatment.
- Keep the bar compact and safe-area aware.
- Do not put every module in the bottom bar.
- Provide a visible route to profile, help, notifications, and other modules.
- If the user has access to multiple workspaces or responsibilities, make switching context explicit and understandable.

### Desktop navigation

Use a left sidebar with grouped destinations. The sidebar may collapse, but collapsed navigation must retain accessible labels through tooltips and screen-reader text.

The desktop header should contain page title/context, relevant breadcrumbs when needed, notifications, and account controls. Avoid duplicating the full navigation in multiple places.

### Navigation behavior

- Preserve the user's current location when opening and closing detail panels where possible.
- Use clear page titles and back navigation on mobile.
- Avoid deeply nested navigation. Prefer a shallow structure with clear page-level tabs or filters.
- Permission-restricted destinations should not appear as usable links. Backend authorization remains mandatory; hiding a link is not security.

## 4. Color system

Use semantic tokens. Components must not hardcode unrelated hex values. The light theme is the default; dark theme is supported and must be tested, not treated as an afterthought.

### Light theme

| Token | Value | Purpose |
|---|---|---|
| `background` | `#f3ebdd` | Main Sand Beige page canvas |
| `foreground` | `#12382c` | Forest Green text |
| `card` | `#fffdf8` | Warm white cards, sheets, menus |
| `card-foreground` | `#12382c` | Text on cards |
| `muted` | `#e6e0d4` | Quiet Sand Beige surfaces |
| `muted-foreground` | `#52615a` | Secondary text |
| `primary` | `#185c45` | Forest Green actions and navigation |
| `primary-foreground` | `#fffdf8` | Text/icons on primary |
| `secondary` | `#3d6b58` | Forest Green secondary surfaces |
| `secondary-foreground` | `#fffdf8` | Text on secondary |
| `accent` | `#ede5ff` | Electric Purple tint for highlights |
| `accent-foreground` | `#5b21b6` | Text on purple accent |
| `border` | `rgba(18,56,44,0.14)` | Dividers and outlines |
| `input` | `rgba(18,56,44,0.28)` | Input borders |
| `ring` | `#7c3aed` | Electric Purple focus indicator |
| `destructive` | `#b42f3a` | Destructive actions and blocking errors |
| `success` | `#1e7a4c` | Successful or approved state |
| `warning` | `#f0b94a` | Caution, pending attention, deadline reminders |

### Dark theme

| Token | Value |
|---|---|
| `background` | `#185c45` |
| `foreground` | `#fffdf8` |
| `card` | `#2d7357` |
| `card-foreground` | `#fffdf8` |
| `muted` | `#3d6b58` |
| `muted-foreground` | `#e4dacc` |
| `primary` | `#f3ebdd` |
| `primary-foreground` | `#185c45` |
| `secondary` | `#e4dacc` |
| `secondary-foreground` | `#185c45` |
| `accent` | `#ede5ff` |
| `accent-foreground` | `#5b21b6` |
| `border` | `rgba(255,253,248,0.20)` |
| `input` | `rgba(255,253,248,0.32)` |
| `ring` | `#c4b5fd` |
| `destructive` | `#ffb3b8` |
| `destructive-foreground` | `#5c0b12` |
| `success` | `#9bd8b5` |
| `success-foreground` | `#185c45` |
| `warning` | `#fbe6a9` |
| `warning-foreground` | `#3d2a00` |

### Color usage rules

- Forest Green is the primary action color. Use it deliberately, not as decoration on every element.
- Keep the visual ratio near 60% Sand Beige/warm neutral surfaces, 30% Forest Green structure, and 10% Electric Purple accents.
- Keep one visually dominant primary action per screen or section. Other actions should be secondary, outline, or ghost.
- Status colors must always be paired with a readable text label and, where useful, an icon.
- Never communicate attendance or report status by color alone.
- Red is reserved for destructive actions, serious errors, or states that genuinely require urgent attention.
- Warning amber is for caution and pending attention, not general decoration.
- Use charts with distinct colors and labels; do not rely on red/green distinctions alone.
- Do not use pure black as the default text color.

### Optional atmosphere

A very subtle peach, lilac, or mint tint may be used in a nonessential page background or empty state. Keep it low contrast and behind content. Never put gradients behind dense tables, forms, or critical status information. Avoid large animated background blobs on frequently used operational pages.

## 5. Typography

Use **Hanken Grotesk** for interface and headings, with **IBM Plex Mono** for IDs, timestamps, and technical values.

| Role | Font | Size | Weight | Line height |
|---|---|---:|---:|---:|
| Display | Hanken Grotesk | 31–56px | 600 | 1.08 |
| H1 | Hanken Grotesk | 27–40px | 600 | 1.12 |
| H2 | Hanken Grotesk | 22–28px | 600 | 1.25 |
| H3 | Hanken Grotesk | 20px | 600 | 1.35 |
| Body | Hanken Grotesk | 16–17px | 400 | 1.6 |
| Small | Hanken Grotesk | 14–15px | 400 | 1.5 |
| Label | Hanken Grotesk | 14px | 600 | 1.35 |
| Mono | IBM Plex Mono | 13px | 400–500 | 1.5 |

Rules:
- Body text should normally be 16px or larger, including on mobile.
- Do not use tiny text to squeeze more information into a screen.
- Use 14px as the practical minimum for secondary interface text; essential instructions must remain comfortably readable.
- Use sentence case for headings and labels. Avoid all-caps labels except for very short metadata.
- Use tabular numerals for times, dates, counts, and numeric summaries.
- Keep long paragraphs to roughly 60–65 characters per line.
- Use font weight and spacing—not color alone—to establish hierarchy.

## 6. Spacing, surfaces, and shape

Use a consistent 4px spacing scale:

| Token | Value |
|---|---:|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-10` | 40px |
| `space-14` | 56px |
| `space-18` | 72px |
| `space-26` | 104px |

### Radius

| Token | Value | Use |
|---|---:|---|
| `radius-sm` | 8px | Small chips, badges, compact controls |
| `radius-md` | 12px | Inputs, buttons, tabs |
| `radius-lg` | 14px | Cards and panels |
| `radius-xl` | 22px | Dialogs and large sheets |
| `radius-full` | 9999px | Avatars, pills, toggles |

### Surface rules

- Use a pearl canvas with white or dark-mode equivalent content surfaces.
- Separate cards primarily through spacing, a subtle border, and a restrained shadow.
- Use the small shadow for resting cards. Reserve stronger elevation for menus, dialogs, and overlays.
- Avoid nesting cards inside cards without a clear information hierarchy.
- Do not use glass blur on every surface. If used, reserve it for a small number of floating elements such as a translucent navigation surface or contextual overlay.
- Keep mobile cards compact. Do not use desktop-sized padding on a phone.
- Avoid excessive rounded pills for every control; pills are appropriate for compact filters and status chips, not every container.

## 7. Core components

All components must use the semantic color, type, spacing, radius, and motion tokens defined in this document. Prefer accessible, established components (for example, shadcn/ui) and customize them to this system rather than creating inconsistent one-off patterns.

### Buttons

Variants:
- **Primary:** the main action, such as Check in, Submit report, or Save.
- **Secondary:** a lower-priority action.
- **Outline:** a clearly available alternative.
- **Ghost:** low-emphasis actions, especially in toolbars.
- **Destructive:** delete, revoke, or other irreversible actions.

Rules:
- Minimum interactive height: 44px; target 48px for common touch actions.
- On mobile, primary actions may be full width.
- Button labels should use clear verbs.
- Include loading, disabled, success, and error states.
- Prevent duplicate submissions while a request is processing.
- Do not use icon-only buttons for important actions unless the meaning is universally clear and an accessible label is provided.

### Inputs and forms

- Input height: 48px minimum; use 52px when the control benefits from extra room.
- Use 16px text to prevent mobile browsers from zooming on focus.
- Every field needs a persistent label. Placeholder text is an example or hint, never the only label.
- Put validation feedback next to the relevant field and explain how to fix the problem.
- Preserve user-entered values when validation fails.
- Use the correct mobile keyboard type for email, number, date, and search fields.
- Group related fields and keep forms in a single column on mobile.
- Clearly distinguish required and optional fields.
- Use confirmation for destructive or irreversible actions, not for every routine action.

### Cards

Cards are for grouping related information or actions—not for decorating every block.

- Use 14px radius, subtle border, and restrained shadow.
- On mobile, use approximately 16–20px internal padding.
- On desktop, 20–24px padding is generally sufficient.
- A whole card may be interactive only when its click behavior is obvious. Otherwise provide a clear action link or button.
- Keep card titles, supporting text, status, and actions in a predictable order.

### Status badges

Use soft, readable status badges with a text label. Examples:
- `Tepat waktu`
- `Masa toleransi`
- `Terlambat`
- `Menunggu pemeriksaan`
- `Disetujui`
- `Perlu tindakan`

A badge must not be the only place where a critical status is communicated. Provide explanatory text in detail views.

### Tabs and filters

- Use tabs for a small number of closely related views.
- On mobile, allow horizontal scrolling for a short tab row if necessary, but keep the active tab visible and avoid wrapping into multiple confusing rows.
- Use filter sheets or compact filter controls on mobile when a full filter sidebar would consume too much space.
- Show active filters and provide a clear way to reset them.

### Tables and data lists

Tables are appropriate for dense administrative data on desktop, but they are not the default mobile presentation.

On mobile:
- Convert rows into stacked cards or clearly structured list items whenever practical.
- Prioritize the most useful 2–4 fields; put secondary details in a detail view.
- Put row actions in a visible, reachable menu or detail page.
- Avoid shrinking text or compressing columns to force a desktop table onto a phone.
- If horizontal scrolling is genuinely necessary, keep it inside the table container, show a visual overflow cue, and preserve access to key identifiers.

On desktop:
- Use clear column headings, adequate row height, and aligned numeric data.
- Provide sorting and filtering only where useful.
- Keep row actions consistent.
- Use pagination or incremental loading for large datasets.

### Dialogs, sheets, and confirmation

- On desktop, use centered dialogs for short decisions and focused forms.
- On mobile, prefer a bottom sheet or full-screen page for complex forms and multi-step tasks.
- Keep dialogs narrow and focused. Do not place long workflows inside tiny modal windows.
- Always provide a clear close/cancel path.
- Confirmation text must explain the consequence of the action.

### Navigation and menus

- Use Lucide icons with consistent 1.75–2px stroke.
- Pair important navigation icons with labels.
- Use a visible focus state for keyboard users.
- Menus must be usable by touch, keyboard, and assistive technology.

## 8. Mobile interaction and ergonomics

Mobile use should feel intentional and comfortable, including when users are moving between daily activities.

- Minimum touch target: 44×44px; prefer 48×48px for primary controls.
- Keep sufficient spacing between adjacent destructive and non-destructive actions.
- Put the most frequent action within easy reach, without covering content.
- Avoid hover-only interactions. Every hover behavior needs an equivalent tap/focus behavior.
- Do not require drag-and-drop for essential workflows. Provide buttons or menus as alternatives.
- Use native-feeling input controls where appropriate, especially for date and time selection.
- Make long forms save progress where feasible, or clearly warn before leaving with unsaved changes.
- Provide clear feedback after check-in, report submission, task updates, and other important actions.
- Support portrait orientation first. Landscape should remain functional.
- Do not assume a fast connection or a powerful phone.

## 9. Module-specific design guidance

### Dashboard

The dashboard is a role-aware summary, not a wall of charts.

Mobile priority order:
1. Greeting and date/context.
2. One most important pending action.
3. Today's attendance/report status where relevant.
4. Upcoming schedule or deadlines.
5. Relevant announcements and assigned tasks.

Show only information the current user is authorized to see. Keep the first screen useful without excessive scrolling. Desktop may show additional summaries and side panels.

### Attendance

- Make the current attendance state immediately understandable.
- Show the applicable attendance deadline and the user's recorded check-in time.
- The check-in action must be prominent when the user is eligible to check in.
- After submission, show a clear confirmation and the recorded time.
- Explain the difference between on-time, grace-period, and late states in plain language.
- If a correction request is supported, make its status and next step visible.
- Do not imply that an unrecorded check-in is automatically a verified disciplinary finding.

### Daily activity reports

- Make the report form comfortable to complete on a phone.
- Use clear prompts and sensible input lengths.
- Show the deadline and submission state.
- Distinguish submission state from review state.
- Let users understand whether a report is submitted, late, awaiting review, approved, or needs revision.
- Keep reviewer feedback close to the relevant report.

### Tasks and projects

- Make task title, due date, status, and assignee easy to scan.
- Use a compact card/list on mobile and richer table or board views on desktop where appropriate.
- Provide a simple task detail view with description, updates, files, and activity history.
- Do not make drag-and-drop the only way to change status or priority.

### Schedules and announcements

- Present the next relevant event first.
- Make date, time, location, and audience easy to identify.
- Use clear distinctions between upcoming, changed, and cancelled events.
- Announcements should be readable on mobile without tiny text or dense metadata.

### Resource library

- Prioritize search, categories, and quick access.
- Resource details should be readable in a single-column mobile layout.
- Keep access/setup instructions, how-to-use guidance, workflow/examples, limitations, official sources, and documentation status together with the resource record.
- Do not split essential resource instructions across unrelated pages.

### People and teams

- Use readable person cards or lists on mobile.
- Show only information relevant to the viewer's permission level.
- Make team membership and responsibilities understandable.
- Do not expose private contact or personal information to users without authorization.

### Analytics and administration

- Treat desktop as the richer analysis workspace, but make essential administrative review possible on mobile.
- On phones, summarize key figures and provide drill-down views instead of squeezing complex charts into narrow widths.
- Use clear date ranges, labels, units, and empty states.
- Exports and advanced bulk operations may be desktop-optimized, but should remain discoverable and usable where feasible.

## 10. Accessibility, feedback, and system states

Target WCAG 2.2 AA practices wherever practical.

- Maintain sufficient text and control contrast in both themes.
- All functionality must be keyboard accessible.
- Use visible focus indicators.
- Provide accessible labels for icon buttons and form controls.
- Respect reduced-motion preferences.
- Do not use color as the only indicator of state.
- Use semantic headings and landmarks.
- Ensure screen-reader announcements for important asynchronous outcomes.

Every data-driven screen must consider these states:
- Loading: use restrained skeletons or progress indicators.
- Empty: explain why there is no content and what the user can do next.
- Error: explain what happened in plain language and provide a recovery action.
- Success: confirm the completed action and its result.
- Offline / connection failure: preserve entered data where feasible and make retry behavior clear.
- Permission denied: explain that the user does not have access without leaking restricted information.

## 11. Motion

Motion should be subtle, brief, and functional.

| Token | Value | Use |
|---|---:|---|
| `duration-instant` | 100ms | Press feedback and toggles |
| `duration-fast` | 160ms | Hover, focus, and color changes |
| `duration-base` | 260ms | Tabs, menus, and sheets |
| `duration-slow` | 480ms | Dialog transitions and restrained reveals |

- Use `cubic-bezier(0.4, 0, 0.2, 1)` for standard state changes.
- Use `cubic-bezier(0.22, 1, 0.36, 1)` for entrances.
- Avoid bounce, parallax, looping decoration, and large animated background effects.
- Never delay access to content for an entrance animation.
- Respect `prefers-reduced-motion: reduce` by removing nonessential transitions and transforms.

## 12. Imagery and iconography

Pondok OS is primarily a functional interface. Use imagery only when it adds context or meaning.

- Prefer authentic, relevant photography of the institution, activities, facilities, and people when approved for use.
- Do not use generic stock imagery to fill empty space.
- Avoid decorative illustrations that make operational screens feel like a consumer wellness app.
- Use Lucide icons consistently, generally 20–24px with rounded line styling.
- Pair status icons with text.
- Use avatars only when they help identify a person or team; provide initials or a neutral fallback when no image exists.
- Respect privacy and permissions for photos and personal information.

## 13. Content and microcopy

Use Bahasa Indonesia as the default interface language unless the product explicitly supports another language.

- Write in plain, direct, respectful language.
- Prefer familiar verbs: `Absen`, `Kirim laporan`, `Lihat jadwal`, `Simpan`, `Ajukan koreksi`.
- Keep labels short but unambiguous.
- Explain unfamiliar terms at the point of use.
- Avoid overly formal bureaucratic wording in routine interactions.
- Be respectful and neutral when communicating late, missing, or rejected submissions. Do not shame users.
- Dates and times should use a consistent Indonesian format and WIB where relevant.
- Error messages should explain how to recover, not merely say “Something went wrong”.

## 14. Performance and implementation constraints

The interface must remain usable on mid-range and older phones and variable mobile connections.

- Prefer CSS-based surfaces over expensive blur, filters, and large animated effects.
- Avoid loading large images or charts before they are needed.
- Lazy-load noncritical media and below-the-fold content.
- Keep interaction feedback immediate; show loading states for slower network operations.
- Avoid layout shifts when content loads.
- Use responsive images and appropriate image sizes.
- Do not make core workflows depend on hover, high-end GPU effects, or large JavaScript bundles.
- Test on real mobile browsers, not only desktop responsive emulation.
- Treat authentication, role checks, and data authorization as backend responsibilities. UI visibility is not a security boundary.

## 15. Design acceptance checklist

A page or feature is not considered finished until it passes the relevant checks.

### Mobile-first
- [ ] Designed and reviewed at 360px and 390px widths.
- [ ] No unintended horizontal page overflow.
- [ ] Main action is visible and reachable.
- [ ] Touch targets are at least 44×44px, preferably 48×48px.
- [ ] Forms and lists are comfortable to use with one hand.
- [ ] Bottom navigation and sticky elements respect safe areas.
- [ ] No essential workflow requires a laptop or hover interaction.

### Responsive
- [ ] Tablet and desktop layouts are intentionally adapted.
- [ ] Desktop tables do not force tiny text on mobile.
- [ ] Content width remains readable on wide screens.
- [ ] Navigation works with keyboard, touch, and pointer.

### Quality
- [ ] Uses semantic design tokens.
- [ ] Light and dark themes are both legible.
- [ ] Statuses include text, not color alone.
- [ ] Loading, empty, error, success, and permission states are handled.
- [ ] Reduced motion is respected.
- [ ] Accessibility labels and visible focus states are present.
- [ ] Performance is acceptable on a mid-range phone and a variable connection.

## 16. Design tokens (CSS starter)

The following is the canonical starting token set for the project. Extend it only when a real interface need cannot be met by an existing semantic token. Keep token names stable across components.

```css
@import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap");

:root {
  color-scheme: light;

  --font-display: "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --background: #f3ebdd;
  --foreground: #12382c;
  --card: #fffdf8;
  --card-foreground: #12382c;
  --muted: #e6e0d4;
  --muted-foreground: #52615a;
  --primary: #185c45;
  --primary-foreground: #fffdf8;
  --secondary: #3d6b58;
  --secondary-foreground: #fffdf8;
  --accent: #ede5ff;
  --accent-foreground: #5b21b6;
  --electric: #7c3aed;
  --border: rgba(18, 56, 44, 0.14);
  --input: rgba(18, 56, 44, 0.28);
  --ring: #7c3aed;
  --destructive: #b42f3a;
  --destructive-foreground: #ffffff;
  --success: #1e7a4c;
  --success-foreground: #ffffff;
  --warning: #f0b94a;
  --warning-foreground: #2d2105;

  --chart-1: #185c45;
  --chart-2: #7c3aed;
  --chart-3: #e0a23c;
  --chart-4: #b7791f;
  --chart-5: #c96f6f;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-14: 56px;
  --space-18: 72px;
  --space-26: 104px;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 14px;
  --radius-xl: 22px;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px rgba(19, 38, 44, 0.05);
  --shadow-md: 0 6px 20px -8px rgba(11, 110, 106, 0.2),
               0 1px 3px rgba(19, 38, 44, 0.06);
  --shadow-lg: 0 28px 56px -20px rgba(19, 38, 44, 0.28),
               0 0 0 1px rgba(19, 38, 44, 0.05);

  --duration-instant: 100ms;
  --duration-fast: 160ms;
  --duration-base: 260ms;
  --duration-slow: 480ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);

  --container-max: 1200px;
  --gutter-mobile: 16px;
  --gutter-desktop: 24px;
  --content-measure: 65ch;
}

.dark {
  color-scheme: dark;

  --background: #185c45;
  --foreground: #fffdf8;
  --card: #2d7357;
  --card-foreground: #fffdf8;
  --muted: #3d6b58;
  --muted-foreground: #e4dacc;
  --primary: #f3ebdd;
  --primary-foreground: #185c45;
  --secondary: #e4dacc;
  --secondary-foreground: #185c45;
  --accent: #ede5ff;
  --accent-foreground: #5b21b6;
  --border: rgba(255, 253, 248, 0.20);
  --input: rgba(255, 253, 248, 0.32);
  --ring: #c4b5fd;
  --destructive: #ffb3b8;
  --destructive-foreground: #5c0b12;
  --success: #9bd8b5;
  --success-foreground: #185c45;
  --warning: #fbe6a9;
  --warning-foreground: #3d2a00;

  --chart-1: #f3ebdd;
  --chart-2: #c4b5fd;
  --chart-3: #f0b94a;
  --chart-4: #b3a3e6;
  --chart-5: #ee8f8f;

  --shadow-sm: 0 0 0 1px rgba(190, 230, 230, 0.08);
  --shadow-md: 0 0 0 1px rgba(190, 230, 230, 0.1),
               0 10px 28px -10px rgba(0, 0, 0, 0.55);
  --shadow-lg: 0 0 0 1px rgba(190, 230, 230, 0.14),
               0 32px 72px -20px rgba(0, 0, 0, 0.75);
}

* {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

button,
input,
select,
textarea {
  font: inherit;
}

button,
[role="button"],
a {
  -webkit-tap-highlight-color: transparent;
}

:focus-visible {
  outline: 3px solid var(--ring);
  outline-offset: 3px;
}

.container {
  width: 100%;
  max-width: var(--container-max);
  margin-inline: auto;
  padding-inline: var(--gutter-mobile);
}

@media (min-width: 768px) {
  .container {
    padding-inline: var(--gutter-desktop);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

### Tailwind / component implementation notes

- Map semantic tokens to Tailwind theme colors (for example `bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`).
- If using shadcn/ui, map its CSS variables to the tokens above rather than introducing a second palette.
- Use the same tokens for web components and native-feeling mobile layouts.
- Do not copy either reference system's full component CSS wholesale. This document is the product-specific source of truth.

## 17. Instructions for AI coding agents

Before creating or modifying any UI:

1. Read this `design.md` completely.
2. Follow its mobile-first responsive strategy. Build the phone experience first and then adapt upward.
3. Use the semantic tokens and component rules defined here. Do not invent a new palette, typography system, radius scale, or spacing scale without a clear reason.
4. Treat accessibility, touch ergonomics, loading/error/empty states, and mobile performance as requirements—not optional polish.
5. Do not create desktop-only workflows for essential tasks.
6. When a design decision is not specified, choose the simplest accessible solution consistent with this file and document the decision.
7. If a proposed change conflicts with this file, explain the conflict and update this document deliberately rather than silently diverging.

**Source references:** the visual direction now uses the approved Forest Green, Sand Beige, and Electric Purple palette. The earlier Clinic Pearl reference remains historical only; production components must follow the tokens above.
