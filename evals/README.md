# Agent evaluation suite

The repository-only TypeScript suite is the CI-facing evaluator:

```sh
npm install --prefix evals
npm run eval
```

It needs no model credentials. `npm run eval:live -- --harness codex` is an opt-in adapter mode; configure `CODEX_EVAL_COMMAND` with a local launcher that accepts a case JSON argument and prints a scored case JSON result. Live access is never part of normal validation.

Fixtures are deterministic, harness-neutral JSON records. Each fixture names a specialist, scenario, required finding IDs, forbidden (false-positive) IDs, an `observed` list, and filesystem/Git state for machine-checkable assertions. The TypeScript runner validates the fixture schema and scores exact IDs: recall over required findings and false-positive rate over observed findings. The checked-in regression corpus must have full recall and zero forbidden findings. The original `python3 evals/run.py` scorer remains available for the existing planning regression corpus.

To add a regression after an agent failure, minimize it to repository evidence and decision context, assign stable semantic IDs, record only machine-checkable expected/forbidden outcomes, and add the corrected observed output. Avoid prose matching, timestamps, network calls, or harness-specific transcripts. A fixture should test one failure mode and include both a tempting false positive and the missed finding where practical. Update prompt/skill behavior separately, then run the suite locally and in CI.
