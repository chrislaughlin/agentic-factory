# Planning evaluation fixtures

These JSON files contain sanitized, committed structured planning artifacts only. They do not contain live model output, credentials, repository secrets, or private planning artifacts. `scripts/evaluate_planning.py` validates every recorded artifact through `scripts/validate_planning_artifact.py`, then requires 100% recall for required field assertions and zero forbidden matches.
