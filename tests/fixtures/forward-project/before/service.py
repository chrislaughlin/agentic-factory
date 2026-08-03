from pathlib import Path


def normalize_name(filename: str) -> str:
    return Path(filename).stem.lower().replace(" ", "-")
