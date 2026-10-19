# @hanuanalytics/sdk

The browser SDK for [HanuAnalytics](https://github.com/madhudream/hanuanalytics): pageviews, sessions, clicks,
forms, errors, Core Web Vitals and rrweb session replay from one ~8 KB script.

```html
<script async src="https://analytics.example.com/hanu.js" data-token="ha_pk_…"></script>
```

See `docs/SDK.md` in the repository for every option and API call.

```sh
npm install           # once
npm run build         # dist/hanu.js, dist/hanu-rec.js, dist/hanu.esm.js, dist/hanu.d.ts
npm test              # vitest + jsdom
npm run demo          # http://127.0.0.1:5174/?token=ha_pk_…  against a server on :8090
```
