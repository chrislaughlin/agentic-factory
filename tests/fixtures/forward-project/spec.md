# Document conversion request

Add a public `convert_document(filename, output_format)` function. It should invoke the installed converter and return the output path. Preserve the existing normalization behavior.

The request does not yet define trusted input boundaries, supported formats, collision behavior, converter failures, or exact output naming.
