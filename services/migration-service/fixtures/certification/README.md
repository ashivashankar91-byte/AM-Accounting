# CE-16 certification fixtures

**CERTIFICATION-ONLY: synthetic non-production data.**

Every file in this directory is fabricated for certification of the CE-16
accounting migration epic. None of it originates from a dealership, a customer,
or any production system. Account numbers, party references, document numbers
and amounts are invented and internally consistent only within their own file.

These fixtures exist so the certification scenarios can be reproduced exactly:

| Fixture | Proves |
|---|---|
| `fixture-multi-entity-source.json` | Legal-entity scoping across rooftops in one extract |
| `fixture-duplicate-records.json` | Duplicate-file refusal and row-hash idempotency on rerun |
| `fixture-invalid-mappings.json` | Mapping decisions that must be refused rather than guessed |
| `fixture-ambiguous-accounts.json` | Ambiguous/unmapped legacy values routed to the exception queue |
| `fixture-unbalanced-journals.json` | Unbalanced conversion batch cannot reach CE-07 posting |
| `fixture-open-ap-ar.json` | G2 subledger conservation against the converted TB control balance |
| `fixture-schedules.json` | G4 aging integrity, including rows that must fail it |
| `fixture-beginning-balances.json` | Beginning balances and comparative history conversion |
| `fixture-delta-extract.json` | Post-freeze delta staging without double-loading |
| `fixture-explained-parallel-diffs.json` | Every parallel-run difference explained and dispositioned |
| `fixture-rollback-scenario.json` | Governed financial reversal with original lineage preserved |

Do not copy these files into any environment that holds real data, and do not
add real data to them.
