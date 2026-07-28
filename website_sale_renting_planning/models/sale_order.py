# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _available_dates_for_renting(self):
        return (
            super()._available_dates_for_renting()
            and all(
                len(line._get_planning_resources_available()) >= int(line.product_uom_qty)
                for line in self.order_line
                if line._is_planning_rental_service()
                and line.product_id.planning_role_id.sync_shift_rental
            )
        )
