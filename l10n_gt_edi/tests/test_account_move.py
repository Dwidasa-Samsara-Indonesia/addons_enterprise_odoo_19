from odoo.addons.account.tests.common import AccountTestInvoicingCommon
from odoo.tests import tagged


@tagged('post_install_l10n', 'post_install', '-at_install')
class TestL10nGtEdi(AccountTestInvoicingCommon):

    @classmethod
    @AccountTestInvoicingCommon.setup_country('gt')
    def setUpClass(cls):
        super().setUpClass()
        ChartTemplate = cls.env['account.chart.template']

        # ==== Taxes ====
        cls.iva_withholding = ChartTemplate.ref('tax_vat_withhold')
        cls.isr_withholding = ChartTemplate.ref('tax_isr_withhold')

    def test_fesp_vendor_bill_report_values_with_withholding_taxes(self):
        bill = self._create_invoice_one_line(
            move_type='in_invoice',
            product_id=self.product_a,
            tax_ids=self.iva_withholding | self.isr_withholding,
            l10n_gt_edi_doc_type='FESP',
        )
        bill.action_post()

        self.env['l10n_gt_edi.document'].create({'invoice_id': bill.id, 'state': 'invoice_sent'})
        values = bill._l10n_gt_edi_get_extra_invoice_report_values()

        self.assertIn('gran_total', values)
        self.assertIn('retencion_gran_total', values)

    def test_nabn_available_only_for_vendor_credit_note(self):
        vendor_bill = self._create_invoice(move_type='in_invoice', company_id=self.company.id)
        vendor_bill_types = set(vendor_bill.l10n_gt_edi_available_doc_types.split(','))
        self.assertNotIn('NABN', vendor_bill_types)

        vendor_credit_note = self._create_invoice(move_type='in_refund', company_id=self.company.id)
        vendor_credit_note_types = set(vendor_credit_note.l10n_gt_edi_available_doc_types.split(','))
        self.assertIn('NABN', vendor_credit_note_types)

    def test_purchase_document_types_not_filtered_by_affiliation(self):
        move = self._create_invoice(move_type='in_invoice', company_id=self.company.id)
        available_types = set(move.l10n_gt_edi_available_doc_types.split(','))
        self.assertIn('FPEQ', available_types)
        self.assertIn('FCAP', available_types)
