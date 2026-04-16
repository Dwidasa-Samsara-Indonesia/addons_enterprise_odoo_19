# Part of Odoo. See LICENSE file for full copyright and licensing details.

from datetime import date

from odoo.tests import TransactionCase, tagged


@tagged('post_install_l10n', 'post_install', '-at_install')
class TestKeSalaryDeductions(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company_ke = cls.env['res.company'].create({
            'name': 'KE Test Co',
            'country_id': cls.env.ref('base.ke').id,
        })
        cls.employee = cls.env['hr.employee'].with_company(cls.company_ke).create({
            'name': 'KE Test Employee',
            'company_id': cls.company_ke.id,
            'date_version': date(2020, 1, 1),
            'contract_date_start': date(2020, 1, 1),
            'wage': 100000,
        })

    def test_attach_salary_deducted_from_net(self):
        """ Check attachment of salary deducts from NET """
        payslip = self.env['hr.payslip'].with_company(self.company_ke).create({
            'name': 'Test Payslip',
            'employee_id': self.employee.id,
            'date_from': date(2024, 1, 1),
            'date_to': date(2024, 1, 31),
        })
        payslip.compute_sheet()
        net_without = payslip.line_ids.filtered(lambda l: l.code == 'NET').total

        self.env['hr.salary.attachment'].create({
            'employee_ids': [self.employee.id],
            'description': 'Test attachment',
            'other_input_type_id': self.env.ref('hr_payroll.input_attachment_salary').id,
            'date_start': date(2024, 1, 1),
            'monthly_amount': 1500,
            'total_amount': 5000,
        })
        payslip = self.env['hr.payslip'].with_company(self.company_ke).create({
            'name': 'Test Payslip',
            'employee_id': self.employee.id,
            'date_from': date(2024, 1, 1),
            'date_to': date(2024, 1, 31),
        })
        payslip.compute_sheet()
        net_with = payslip.line_ids.filtered(lambda l: l.code == 'NET').total

        self.assertAlmostEqual(net_without - net_with, 1500, 2, "ATTACH_SALARY should reduce NET by the attachment amount")
