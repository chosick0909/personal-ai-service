# Operator-reviewed reference accounts

`home-2026-09-20.reviewed.json` contains the 44 domestic home/interior accounts
approved by the user on 2026-09-20 (including the previous 8 approvals).
Collection timestamps remain 2026-09-19. Approval does not extend the 30-day
verification lifetime. The file is not imported automatically at startup or deployment.

The export preserves metrics, dated reel samples, assessment evidence and public
post links. Raw provider dumps, images, full post captions and public contact details
are omitted from the committed export. Original evidence is retained locally.

Validate without connecting to a database or a paid provider:

```sh
node backend/scripts/manage-creator-tools.js catalog backend/catalog/home-2026-09-20.reviewed.json --validate-only
```

After a separately authorized database import, run the same command without
`--validate-only`. Expired or incomplete evidence is rejected; re-collect and review
instead of editing timestamps. Current instruction is **no further collection**.
See [the approved cross-category policy](../../docs/reference-accounts-policy.md).
