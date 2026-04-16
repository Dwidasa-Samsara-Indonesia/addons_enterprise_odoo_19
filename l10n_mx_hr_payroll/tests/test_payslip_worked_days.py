from datetime import datetime
from freezegun import freeze_time

from odoo.addons.hr_payroll.tests.common import TestPayslipBase
from odoo.tests.common import tagged


@tagged('-at_install', 'post_install_l10n', 'post_install')
class TestPayrollWorkedDays(TestPayslipBase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        mexico = cls.env.ref('base.mx')
        cls.env.company.write({
            'country_id': mexico.id
        })
        cls.richard_emp.write({
            'company_id': cls.env.company,
            'country_id': mexico.id,
        })
        sw_structure = cls.env['hr.payroll.structure.type'].create({
            'name': 'Software Developer'
        })
        developer_pay_structure = cls.env['hr.payroll.structure'].create({
            'name': 'Salary Structure for Software Developer',
            'type_id': sw_structure.id,
            'unpaid_work_entry_type_ids': [(4, cls.work_entry_type_unpaid.id, False)],
        })
        cls.richard_emp.write({
            'contract_date_end': datetime(2050, 1, 1),
        })
        cls.payslip = cls.env['hr.payslip'].create({
            'name': 'Payslip of Richard Quarter',
            'employee_id': cls.richard_emp.id,
            'struct_id': developer_pay_structure.id,
            'date_from': datetime(2030, 1, 1).date(),
            'date_to': datetime(2030, 2, 1).date(),
        })
        cls.richard_emp.wage = 5000

    def _reset_work_entries(self, emp):
        self.env['hr.work.entry'].search([('employee_id', '=', emp.id)]).unlink()
        now = datetime(2030, 1, 1, 0, 0, 0)
        emp.write({
            'date_generated_from': now,
            'date_generated_to': now,
        })

    def test_monthly_payslip(self):
        self._reset_work_entries(self.richard_emp)
        amount_to_be_paid = sum(line.amount for line in self.payslip.worked_days_line_ids)
        self.assertEqual(amount_to_be_paid, 5000)
        self.env['resource.calendar.leaves'].create({
            'name': 'Doctor Appointment',
            'date_from': datetime.strptime('2030-01-01 07:00:00', '%Y-%m-%d %H:%M:%S'),
            'date_to': datetime.strptime('2030-01-16 18:00:00', '%Y-%m-%d %H:%M:%S'),
            'resource_id': self.richard_emp.resource_id.id,
            'calendar_id': self.richard_emp.resource_calendar_id.id,
            'work_entry_type_id': self.work_entry_type_unpaid.id,
            'time_type': 'leave',
        })
        self.payslip._compute_worked_days_line_ids()
        amount_to_be_paid = sum(line.amount for line in self.payslip.worked_days_line_ids)
        self.assertAlmostEqual(amount_to_be_paid, 2500, places=2)

    def test_hourly_payslip(self):
        self._reset_work_entries(self.richard_emp)
        self.richard_emp.wage_type = 'hourly'
        self.richard_emp.hourly_wage = 20
        self.payslip._compute_worked_days_line_ids()
        amount_to_be_paid = sum(line.amount for line in self.payslip.worked_days_line_ids)
        self.assertEqual(amount_to_be_paid, 3840)
        self.env['resource.calendar.leaves'].create({
            'name': 'Doctor Appointment',
            'date_from': datetime.strptime('2030-01-01 07:00:00', '%Y-%m-%d %H:%M:%S'),
            'date_to': datetime.strptime('2030-01-16 18:00:00', '%Y-%m-%d %H:%M:%S'),
            'resource_id': self.richard_emp.resource_id.id,
            'calendar_id': self.richard_emp.resource_calendar_id.id,
            'work_entry_type_id': self.work_entry_type_unpaid.id,
            'time_type': 'leave',
        })
        self._reset_work_entries(self.richard_emp)
        self.payslip._compute_worked_days_line_ids()
        amount_to_be_paid = sum(line.amount for line in self.payslip.worked_days_line_ids)
        self.assertEqual(amount_to_be_paid, 1920)

    def test_partial_payslip_new_hire(self):
        self.richard_emp.contract_date_start = '2026-01-10'
        payslip_run = self.env['hr.payslip.run'].create({
            'date_start': '2026-01-01',
            'date_end': '2026-01-31',
        })
        payslip_run.generate_payslips(employee_ids=[self.richard_emp.id])

        out_of_contract_type = self.env.ref('hr_work_entry.hr_work_entry_type_out_of_contract')
        attendance_type = self.env.ref('hr_work_entry.work_entry_type_attendance')
        payslip_work_entry_types = payslip_run.slip_ids.worked_days_line_ids.mapped('work_entry_type_id')

        self.assertIn(out_of_contract_type, payslip_work_entry_types)
        self.assertIn(attendance_type, payslip_work_entry_types)

    @freeze_time('2026-03-10')
    def test_years_worked(self):
        """
        Test the number of years worked by an employee taking gaps between contracts into consideration
        """
        self.richard_contract.contract_date_end = datetime(2025, 1, 31)
        new_contract_1 = self.richard_emp.create_version({
            'date_version': datetime(2025, 2, 1),
            'contract_date_start': datetime(2025, 2, 1),
            'contract_date_end': datetime(2026, 1, 31),
        })
        new_contract_2 = self.richard_emp.create_version({
            'date_version': datetime(2026, 3, 1),
            'contract_date_start': datetime(2026, 3, 1),
        })
        payslip_run = self.env['hr.payslip.run'].create({
            'date_start': '2026-01-01',
            'date_end': '2026-01-15',
        })

        payslip_run.generate_payslips(employee_ids=[self.richard_emp.id])
        self.assertEqual(payslip_run.slip_ids.version_id.id, new_contract_1.id)
        self.assertEqual(payslip_run.slip_ids.l10n_mx_years_worked, 9)

        payslip_run = self.env['hr.payslip.run'].create({
            'date_start': '2026-03-01',
            'date_end': '2026-03-15',
        })

        payslip_run.generate_payslips(employee_ids=[self.richard_emp.id])
        self.assertEqual(payslip_run.slip_ids.version_id.id, new_contract_2.id)
        self.assertEqual(payslip_run.slip_ids.l10n_mx_years_worked, 1)
