from pathlib import Path
import subprocess


def normalize_name(filename: str) -> str:
    return Path(filename).stem.lower().replace(" ", "-")


def convert_document(filename, output_format, quiet=False, special=False):
    name = normalize_name(filename)
    if output_format == "pdf":
        output = name + ".pdf"
    elif output_format == "txt":
        output = name + ".txt"
    else:
        output = name + "." + output_format
    if special:
        command = "converter --special " + filename + " " + output
    else:
        command = "converter " + filename + " " + output
    if quiet:
        subprocess.run(command, shell=True, capture_output=True)
    else:
        subprocess.run(command, shell=True)
    return output
