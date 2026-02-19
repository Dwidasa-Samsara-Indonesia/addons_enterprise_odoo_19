from itertools import product
from unittest.mock import patch

from odoo.addons.documents_account.tests.common import DocumentsAccountActionsServerCommon
from odoo.exceptions import ValidationError
from odoo.tests.common import tagged


@tagged('post_install', '-at_install', 'test_document_bridge')
class TestIrActionsServer(DocumentsAccountActionsServerCommon):

    def test_documents_account_record_create(self):
        """Test documents_account_record_create action server type (state)."""
        test_cases = [
            ('in_invoice', 'purchase'),
            ('in_refund', 'purchase'),
            ('in_receipt', 'purchase'),
            ('out_invoice', 'sale'),
            ('out_refund', 'sale'),
            ('entry', 'general'),
        ]

        for (move_type, journal_type), with_journal in product(test_cases, (True, False)):
            with self.subTest(move_type=move_type, with_journal=with_journal):
                expected_journal = self.journals_by_type[journal_type]

                action = self.env['ir.actions.server'].create({
                    'name': f'test {move_type}',
                    'model_id': self.env['ir.model']._get_id('documents.document'),
                    'state': 'documents_account_record_create',
                    'documents_account_create_model': f'account.move.{move_type}',
                    'documents_account_journal_id': expected_journal.id if with_journal else False,
                    'usage': 'documents_embedded',
                })

                document = self.document_pdf.copy()
                document.folder_id._embed_action(action.id)
                self._run_action_and_assert_sync(action, document, expected_journal)

    def test_documents_account_standard_actions(self):
        """Test the pre-configured financial server actions work as expected."""
        IrEmbeddedActions = self.env['ir.embedded.actions']

        for journal_type, action_xml_ids in self.actions_by_type.items():
            self.assertTrue(action_xml_ids)
            for action_xml_id in action_xml_ids:

                action = self.env.ref(action_xml_id)
                expected_journal = self.journals_by_type[journal_type]

                journal_folder_name = self.journal_type_labels[expected_journal.type]
                journal_folder = self.env['documents.document'].search([
                    *self.env['account.journal']._check_company_domain(self.env.company),
                    ('name', '=', journal_folder_name),
                ], limit=1)

                folders = self.finance_folder | journal_folder
                embedded_actions = folders._get_folder_embedded_actions(folders.ids)
                self.assertIn(action.id, embedded_actions.get(self.finance_folder.id, IrEmbeddedActions).action_id.ids)
                self.assertIn(action.id, embedded_actions.get(journal_folder.id, IrEmbeddedActions).action_id.ids)

                if journal_type == 'bank':
                    # These are tested in test_documents_full for dependency reasons
                    continue

                with self.subTest(action_name=action.name):
                    document = self.pdf_in_finance_folder.copy()
                    self._run_action_and_assert_sync(action, document, expected_journal)

    def test_documents_account_record_create_on_invalid_model(self):
        """Test that calling a documents_account_record_create action on a non-document record does nothing."""
        partner = self.env['res.partner'].create({'name': 'test'})
        with patch.object(self.env.registry["documents.document"], 'account_create_account_bank_statement') as mock:
            action = self.env['ir.actions.server'].create({
                'name': 'account.bank.statement',
                'model_id': self.env['ir.model']._get_id('documents.document'),
                'state': 'documents_account_record_create',
                'documents_account_create_model': 'account.bank.statement',
            })
            action.with_context({'active_model': 'res.partner', 'active_id': partner.id}).run()
            mock.assert_not_called()

    def test_documents_account_record_create_documents_only(self):
        """Test model enforcement on documents_account_record_create server action (can only be applied on Document)."""
        with self.assertRaises(ValidationError, msg='"New Journal Entry" can only be applied to Document.'):
            self.env['ir.actions.server'].create({
                'name': 'Wrong model',
                'model_id': self.env['ir.model']._get_id('res.partner'),
                'state': 'documents_account_record_create',
                'documents_account_create_model': 'account.move.in_invoice',
            })
