# Agent evaluation suite

Fixtures are deterministic, harness-neutral JSON records. Each fixture names a specialist, scenario, required finding IDs, forbidden (false-positive) IDs, and an `observed` list produced by a prompt snapshot or manually captured run. `python3 evals/run.py` validates the schema and scores exact IDs: recall over required findings and false-positive rate over observed findings. The checked-in regression corpus must have full recall and zero forbidden findings.

To add a regression after an agent failure, minimize it to repository evidence and decision context, assign stable semantic IDs, record only machine-checkable expected/forbidden outcomes, and add the corrected observed output. Avoid prose matching, timestamps, network calls, or harness-specific transcripts. A fixture should test one failure mode and include both a tempting false positive and the missed finding where practical. Update prompt/skill behavior separately, then run the suite locally and in CI.
