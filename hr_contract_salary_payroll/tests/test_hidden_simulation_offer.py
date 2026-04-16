from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestHiddenSimulationOffer(HttpCase):

    def test_hr_contract_salary_hidden_simulation_offer_tour(self):
        self.start_tour("/", 'hr_contract_salary_hidden_simulation_offer_tour', login='admin', timeout=350)
