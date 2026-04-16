from odoo import Command
from odoo.tests import Form, tagged

from .common import TestPayrollCommon


@tagged("post_install_l10n", "post_install", "-at_install", "l10n_au_hr_payroll")
class TestVersion(TestPayrollCommon):

    def test_version_creation_with_zero_working_hours(self):
        self.env.company.resource_calendar_id.attendance_ids = [Command.clear()]
        with Form(self.env['hr.employee']) as employee_form:
            employee_form.name = "Au Employee"
            employee_form.company_id = self.australian_company
            employee_form.wage = 100
            employee_form.l10n_au_yearly_wage = 1200
        employee = employee_form.save()

        self.assertTrue(employee)
        self.assertTrue(employee.version_ids)
        self.assertEqual(employee.version_ids[0].hourly_wage, 0.0)
