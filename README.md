# Fynd - Growth

Preset PostHog dashboard for Fynd growth analytics. The app ships with fixed PostHog HogQL queries for:

- SEO funnels
- Console funnels
- Product performance diagnostics
- Revenue and plan mix
- Revenue attribution by primary tool usage

Every insight section includes a `<?>` query reveal so the team can inspect the exact query used.

## Environment variables

Add these in Vercel:

- `POSTHOG_API_KEY`
- `OPENAI_API_KEY`

Nothing else is required for the first deploy. The app is already pinned to the existing PostHog host and project used in the internal analytics workflow.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Product areas

- `Pixelbin`
  - SEO Funnels
  - Console Funnels
  - Product Performance
  - Revenue Insights
- `Watermarkremover`
  - SEO Funnels
  - Console Funnels
  - Product Performance
  - Revenue Insights
- `Upscale Media`
  - SEO Funnels
  - Console Funnels
  - Product Performance
  - Revenue Insights
- `Revenue`
  - Cross-product revenue insights

## Notes

- Payments use only `paddle_transaction` API-origin events.
- OpenAI is used only for recommendations and action suggestions.
- Queries are fixed in the repo. The app does not generate ad-hoc PostHog queries with AI.
