# Detailed Design — Customized Reporting (RoPA & PIA)

## Document Metadata

| Field        | Value                        |
|--------------|------------------------------|
| Feature      | Customized Reporting         |
| Apps         | RoPA, PIA                    |
| Author       | Muthu Qumar S                |
| Status       | Draft                        |
| Last Updated | 2026-05-19                   |

---

## Overview

Extends the existing JSON-based report pipeline to produce branded, configurable PDFs. Users select a Legal Entity at export time (branding source), toggle specific sections on/off, choose a risk detail level, and optionally persist their config to the instance. A global fallback config lives in Collaboration Global Settings.

**Existing assets that this feature builds on:**

| Asset | Location |
|-------|----------|
| `ReportSettings` interface | `shared/types/global-settings-interfaces.ts` |
| `reportConfig` field on `InstanceDataModel` | `shared/types/instance-data.model.ts` |
| `CollaborationGlobalSettings.reportSettings` | `shared/types/global-settings-interfaces.ts` |
| `ReportsManager` (JSON report builder) | `server/src/generic-template-manager/service/managers/reports-manager.ts` |
| `ReportsController` | `server/src/controllers/reports-controller.ts` |
| `BigIdServiceBaseImpl.getLegalEntity()` | `server/src/generic-template-manager/bigid-service/bigid-service-base-impl.ts` |
| `SettingsManager<CollaborationGlobalSettings>` | `server/src/generic-template-manager/service/managers/settings-manager.ts` |

---

## Architecture Changes

```
                        Browser
                           │
           ┌───────────────┼───────────────┐
           │               │               │
     [Export Dialog]  [Preview btn]  [Generate btn]
           │               │               │
           └───────────────┴───────────────┘
                           │
                    POST /reports/export
                    { sections, legalEntityId,
                      riskMode, saveAsDefault,
                      isPreview }
                           │
                  ReportsController
                           │
           ┌───────────────┼───────────────────────┐
           │               │                       │
    ReportsManager  BigIdServiceBaseImpl    InstancesDaoBaseImpl
    (JSON builder)  .getLegalEntityBranding()  (save reportConfig
           │               │                    if saveAsDefault)
           │               │
           └───────┬───────┘
                   │
          PdfReportService          ← NEW
          (puppeteer renderer)
                   │
           streamed PDF response
           (Content-Disposition:
            inline → preview tab
            attachment → download)
```

**No changes to existing JSON report endpoints.** The new PDF endpoint is additive.

---

## Data Models / Schemas

### 1. Extend `ReportSettings`

**File:** `shared/types/global-settings-interfaces.ts`

```typescript
// BEFORE
export interface ReportSettings {
  selectedSections?: string[];
  legalEntityId?: string;
}

// AFTER
export type RiskDisplayMode = 'overview' | 'detailed';

export interface ReportSettings {
  selectedSections?: ReportSectionId[];   // replaces string[]
  legalEntityId?: string;
  riskDisplayMode?: RiskDisplayMode;      // NEW
}

// Enum for section IDs — replaces magic strings
export type ReportSectionId =
  | 'tableOfContents'
  | 'summary'
  | 'collaborators'
  | 'risks'
  | 'insights'
  | 'conclusionsAndRecommendations'
  | 'questionnaireAndAnswers'
  | 'dataFlows';                          // RoPA only
```

`selectedSections` contains only the sections that are **ON**. Absent = section is OFF.

### 2. New `LegalEntityBrandingDto`

**File:** `shared/types/legal-entities-interfaces.ts`

```typescript
export interface LegalEntityBrandingDto {
  id: string;
  name: string;
  logoUrl?: string;      // URL to logo asset served by BigID
  primaryColor?: string; // hex, e.g. "#003366"
  secondaryColor?: string;
}
```

> **Assumption:** BigID's Legal Entity Module stores `logoUrl` and `primaryColor`/`secondaryColor` fields. Verify against the Legal Entity API response during implementation. If absent, a separate branding sub-object must be requested from the BigID platform team.

### 3. New `ReportExportRequest` (API contract)

**File:** `shared/types/reports.model.ts`

```typescript
export interface ReportExportRequest {
  sections: ReportSectionId[];
  legalEntityId?: string;
  riskDisplayMode: RiskDisplayMode;
  saveAsDefault: boolean;
  isPreview: boolean;        // true → Content-Disposition: inline
}
```

### 4. Extend `RiskSummary` for detailed mode

**File:** `shared/types/reports.model.ts`

```typescript
// BEFORE (existing)
export interface RiskSummary { /* existing fields */ }

// AFTER — add optional fields populated only in 'detailed' mode
export interface RiskSummary {
  // ... existing fields ...
  mitigationTasks?: MitigationTask[];   // NEW
  owner?: string;                       // NEW
  impact?: string;                      // NEW
  probability?: string;                 // NEW
}

export interface MitigationTask {
  id: string;
  title: string;
  status: string;
}
```

### 5. `InstanceDataModel.reportConfig` — already exists

No schema change needed. `reportConfig: ReportSettings` is already typed on `InstanceDataModel`. The extended `ReportSettings` above automatically applies.

### 6. MongoDB write — no migration needed

`reportConfig` is an optional embedded document. Existing instance documents without it continue to work; the global config fallback handles them.

---

## API Endpoints

### New: `POST /reports/instance-report/:id/export`

Generates and streams a PDF. Replaces the concept of separate preview/download routes — the `isPreview` flag controls `Content-Disposition`.

**Request body:** `ReportExportRequest`

**Response:**
- `200 OK` with `Content-Type: application/pdf`
- `Content-Disposition: inline` when `isPreview: true` (browser opens PDF in new tab)
- `Content-Disposition: attachment; filename="report-<id>.pdf"` when `isPreview: false`

**Permission:** Same as existing `getInstanceReportById` — `INSTANCE_DETAILS_READ_ACTIONS`

**Audit log entry written on every call** (preview and download alike).

---

### Enhanced: `GET /reports/instance-report/:id`

Add `reportConfig` to the response so the UI can pre-populate the export dialog.

**Response change:** append `reportConfig: ReportSettings | null` to existing response shape.

The UI reads this on dialog open:
- Instance has saved config → pre-populate from `reportConfig`
- Instance has no config → fetch global config via `GET /settings/collaboration` and use `reportSettings`

---

### Enhanced: `GET /settings/collaboration` & `PUT /settings/collaboration`

No structural change. `CollaborationGlobalSettings.reportSettings` already exists. The UI needs to expose the full `ReportSettings` fields (now extended with `riskDisplayMode`) in the Collaboration Settings admin page.

---

## Service Design

### New: `PdfReportService`

**File:** `server/src/generic-template-manager/service/pdf-report-service.ts`

**Dependencies:** `puppeteer` (headless Chrome)

**Core method:**

```typescript
class PdfReportService {
  async generatePdf(
    report: ReportModel,
    branding: LegalEntityBrandingDto | null,
    settings: ReportSettings,
    appType: AppType,   // 'pia' | 'ropa'
  ): Promise<Buffer>
}
```

**Rendering approach:**

1. `PdfReportService` renders an HTML template (Handlebars or inline template literals) hydrated with the `ReportModel` JSON.
2. Passes the HTML string to puppeteer's `page.setContent()`.
3. Calls `page.pdf({ format: 'A4', printBackground: true })`.
4. Returns the buffer — controller streams it to the response.

**Section rendering — plugin pattern:**

Each section is a standalone HTML partial registered by section ID:

```
/pdf-templates/
  ├── cover.hbs          (branding: logo, colors, entity name)
  ├── table-of-contents.hbs
  ├── summary.hbs
  ├── collaborators.hbs
  ├── risks-overview.hbs
  ├── risks-detailed.hbs
  ├── insights.hbs
  ├── conclusions.hbs
  ├── questionnaire.hbs  (top-down Q&A alignment; inline risks if present)
  └── data-flows.hbs     (RoPA only)
```

`PdfReportService` iterates `settings.selectedSections` and includes only the matching partials. Adding a new section = add a new `.hbs` file and register its ID in `ReportSectionId` — no changes to existing partials.

**Branding injection:**

CSS custom properties are written into the document `<head>`:
```css
:root {
  --brand-primary: {{ branding.primaryColor | default '#003366' }};
  --brand-logo: url('{{ branding.logoUrl }}');
}
```

All templates reference `--brand-primary` for headers/footers. If `branding` is null (no Legal Entity selected), defaults apply.

**Risk mode branching:**

`PdfReportService` selects `risks-overview.hbs` or `risks-detailed.hbs` based on `settings.riskDisplayMode`. Both templates consume the same `RisksSummary` data; the detailed template additionally renders `mitigationTasks`, `owner`, `impact`, `probability`.

**Inline risks in questionnaire:**

`ReportInstanceField.riskValue` already exists in the data model. The `questionnaire.hbs` template renders `riskValue` inline below each field's answer when present and when `risks` is in `selectedSections`.

**Performance target: < 3 seconds**

Puppeteer launch is the bottleneck. Mitigation: keep a warm puppeteer browser instance (launched once at server startup, reused per request). Logo assets are fetched server-side and inlined as base64 to avoid cross-origin fetch latency in headless Chrome.

---

### Enhanced: `ReportsManager`

**File:** `server/src/generic-template-manager/service/managers/reports-manager.ts`

**Changes:**

1. `getInstanceReport()` already accepts `sections` query param — no change to JSON endpoint.
2. New method: `getInstanceReportForPdf(instanceId, settings, userId)`:
   - Calls existing `getInstanceReport()` for the JSON payload.
   - Calls `bigidService.getLegalEntityBranding(settings.legalEntityId)` if provided.
   - Enriches `RiskSummary` entries with mitigation/owner data when `riskDisplayMode === 'detailed'` (requires a new BigID service call — see below).
   - Returns `{ report: ReportModel, branding: LegalEntityBrandingDto | null }`.

---

### Enhanced: `BigIdServiceBaseImpl`

**File:** `server/src/generic-template-manager/bigid-service/bigid-service-base-impl.ts`

**New methods:**

```typescript
getLegalEntityBranding(legalEntityId: string): Promise<LegalEntityBrandingDto>
// Calls GET /management/legal-entities/:id, maps branding fields

getRiskMitigationTasks(riskId: string): Promise<MitigationTask[]>
// Calls existing BigID risk API — verify exact endpoint with BigID platform team
```

---

### Enhanced: `ReportsController`

**File:** `server/src/controllers/reports-controller.ts`

**New handler:** `exportInstanceReportAsPdf(req, res)`

1. Parse and validate `ReportExportRequest` body using `ReportSettingsValidator`.
2. Call `reportsManager.getInstanceReportForPdf()`.
3. Call `pdfReportService.generatePdf()`.
4. If `saveAsDefault` → call `instancesDao.updateReportConfig(instanceId, settings)`.
5. Write audit log entry via `ServiceTrackingHelper`.
6. Set response headers and pipe PDF buffer.

**Config loading logic (UI-driven, not server-driven):**

The server does not auto-merge global vs. instance config. The UI reads both and sends the resolved config in `ReportExportRequest`. This keeps the server stateless and the merge logic testable on the frontend.

---

### Enhanced: `SettingsController` / Collaboration Settings UI

**File:** `server/src/controllers/settings-controller.ts`

No new endpoints. The existing `updateCollaborationSettings()` accepts `reportSettings` already. The UI change is: expose `riskDisplayMode` and the full section toggle list in the Collaboration Settings admin form.

---

## Config Loading — UI Responsibility

```
Dialog opens
      │
      ├─ Fetch GET /reports/instance-report/:id
      │    ↳ response.reportConfig != null?
      │         YES → pre-populate dialog with reportConfig
      │         NO  → fetch GET /settings/collaboration
      │               ↳ use reportSettings as defaults
      │               ↳ if reportSettings also null → use hardcoded baseline
      │
User edits config → clicks Preview or Generate
      │
POST /reports/instance-report/:id/export
  { ...resolvedConfig, saveAsDefault, isPreview }
```

Hardcoded baseline (when no instance config and no global config):
- All sections ON
- `riskDisplayMode: 'overview'`
- No `legalEntityId`

---

## Audit Logging

Every call to `POST /reports/instance-report/:id/export` writes an entry via `ServiceTrackingHelper`:

```typescript
{
  eventType: 'REPORT_EXPORTED',
  instanceId: string,
  userId: string,
  timestamp: Date,
  isPreview: boolean,
  sectionsIncluded: ReportSectionId[],
  legalEntityId: string | null,
  riskDisplayMode: RiskDisplayMode,
}
```

This satisfies the auditability NFR and powers the success metrics (unique users who export, preview frequency).

---

## Section Visibility Matrix

| Section ID | RoPA | PIA | Notes |
|------------|------|-----|-------|
| `tableOfContents` | ✓ | ✓ | |
| `summary` | ✓ | ✓ | |
| `collaborators` | ✓ | ✓ | Respondents + reviewers + approvers |
| `risks` | ✓ | ✓ | Mode: overview or detailed |
| `insights` | ✓ | ✓ | Attributes, categories, AI models, locations |
| `conclusionsAndRecommendations` | ✓ | ✓ | |
| `questionnaireAndAnswers` | ✓ | ✓ | Top-down alignment; inline risks |
| `dataFlows` | ✓ | ✗ | Hidden from export dialog for PIA |

---

## Edge Cases & Error Handling

| # | Case | Handling |
|---|------|----------|
| 1 | Legal Entity has no `logoUrl` | Render cover without logo; no broken image |
| 2 | Legal Entity has no `primaryColor` | CSS falls back to `--brand-primary: #003366` |
| 3 | `legalEntityId` not provided | Branding is null; hardcoded defaults apply |
| 4 | `risks` in `selectedSections` but instance has zero risks | Omit risks section entirely from PDF |
| 5 | `dataFlows` selected for a PIA instance | `ReportSettingsValidator` rejects; returns 400 |
| 6 | PDF generation > 3 seconds | `puppeteer.pdf()` with 5s timeout; return 504 with user-facing error message |
| 7 | Puppeteer crashes mid-request | Catch error, restart browser instance, return 500 |
| 8 | Two users save config for same instance concurrently | Last write wins (MongoDB `findOneAndUpdate`) — acceptable per requirements |
| 9 | Global config not set by admin | Hardcoded baseline used; no 500 error |
| 10 | Logo URL is a cross-origin asset | Fetch server-side, inline as base64 in HTML — avoids headless Chrome CORS issues |

---

## Implementation Plan

### Phase 1 — Foundation (no UI changes)

**1.1 — Extend `ReportSettings` type**
- Add `riskDisplayMode: RiskDisplayMode` to `ReportSettings`
- Add `ReportSectionId` typed union
- Add `LegalEntityBrandingDto` interface
- Add `ReportExportRequest` interface
- Add `MitigationTask` interface and extend `RiskSummary`

**1.2 — BigID service: branding and mitigation**
- Implement `getLegalEntityBranding()` in `BigIdServiceBaseImpl`
- Implement `getRiskMitigationTasks()` in `BigIdServiceBaseImpl`
- Verify exact field names from BigID Legal Entity API response

**1.3 — Add `PdfReportService`**
- Add `puppeteer` dependency
- Implement warm browser singleton (launched in `service-initializer.ts`)
- Implement `generatePdf()` method
- Create `/pdf-templates/` directory with all section partials (empty stubs first)

**1.4 — Enhance `ReportsManager`**
- Add `getInstanceReportForPdf()` method
- Wire `getLegalEntityBranding()` and risk enrichment

**1.5 — New `POST /reports/instance-report/:id/export` endpoint**
- Add route to `reports-router.ts`
- Implement `exportInstanceReportAsPdf()` in `ReportsController`
- Wire `saveAsDefault` → `instancesDao.updateReportConfig()`
- Wire audit log

**1.6 — Enhance `GET /reports/instance-report/:id`**
- Append `reportConfig` field to response

### Phase 2 — PDF templates

**2.1 — Cover page + branding**
- Implement `cover.hbs` with logo, entity name, brand colors

**2.2 — Section templates**
- Implement all section `.hbs` partials
- Q&A top-down layout
- Inline risk rendering in `questionnaire.hbs`

**2.3 — Risk templates**
- Implement `risks-overview.hbs` (name + status)
- Implement `risks-detailed.hbs` (full detail)

### Phase 3 — Global Settings extension

**3.1 — Backend**
- `ReportSettingsValidator` already validates sections; extend to validate `riskDisplayMode`
- Collaboration Settings `PUT` already accepts `reportSettings`; no code change if type is extended

**3.2 — UI (separate ticket)**
- Extend Collaboration Settings admin page with new report config fields
- Extend export dialog with: Legal Entity dropdown, section toggles, risk mode selector, Save as default checkbox, Preview button

---

## Testing Strategy

| Layer | What to test |
|-------|-------------|
| Unit — `PdfReportService` | Section inclusion/exclusion, branding injection, risk mode selection, inline risk rendering |
| Unit — `ReportsManager.getInstanceReportForPdf` | Branding fetch, risk enrichment, null Legal Entity handling |
| Unit — `ReportsController.exportInstanceReportAsPdf` | `saveAsDefault` write, audit log write, `Content-Disposition` header selection |
| Unit — `ReportSettingsValidator` | Reject `dataFlows` for PIA, reject unknown section IDs, reject invalid `riskDisplayMode` |
| Integration — PDF endpoint | Full roundtrip: POST export → PDF buffer returned, config saved to DB |
| Integration — Global settings fallback | New instance with no `reportConfig` → global config used |
| E2E (Cypress) | Preview opens in new tab, toggle off Collaborators → absent from PDF, Legal Entity branding visible on cover |

---

## Definition of Done

- [ ] `POST /reports/instance-report/:id/export` returns a valid PDF within 3 seconds for a typical instance (< 50 questions, < 20 risks)
- [ ] PDF cover page reflects selected Legal Entity's logo and primary color
- [ ] Sections toggled OFF are entirely absent from PDF (verified by PDF text extraction in tests)
- [ ] Risk Overview mode: only name and status visible; Detailed mode: mitigation tasks, owner, impact, probability all present
- [ ] Risks linked to questions appear inline in the Q&A section
- [ ] `saveAsDefault: true` → re-opening dialog pre-populates from saved config
- [ ] `saveAsDefault: false` → no DB write occurs
- [ ] New instance dialog pre-populates from Collaboration Global Settings
- [ ] `dataFlows` section toggle not shown for PIA instances
- [ ] Every export (preview + download) writes an audit log entry
- [ ] Puppeteer browser instance is reused across requests (no per-request launch overhead)
- [ ] All unit tests pass; integration test covers the PDF generation roundtrip

---

## Open Questions

| # | Question | Owner |
|---|----------|-------|
| 1 | Does the BigID Legal Entity API response include `logoUrl`, `primaryColor`, `secondaryColor` fields? If not, what branding fields are available? | BigID Platform team |
| 2 | What BigID API endpoint provides risk mitigation task details for "Detailed" risk mode? | BigID Platform team |
| 3 | When `risks` is toggled ON but an instance has zero risks — omit the section silently, or show an empty-state message in the PDF? | Product |
| 4 | Should the `tableOfContents` section auto-update to reflect only the included sections? | Product / Design |
