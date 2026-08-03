import unittest

from service import convert_document


class ConvertDocumentTests(unittest.TestCase):
    def test_pdf_name(self):
        self.assertEqual(convert_document("Quarterly Report.docx", "pdf", quiet=True), "quarterly-report.pdf")
