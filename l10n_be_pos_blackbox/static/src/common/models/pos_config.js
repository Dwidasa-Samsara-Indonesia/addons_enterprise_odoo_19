import { PosConfig } from "@point_of_sale/app/models/pos_config";
import { patch } from "@web/core/utils/patch";

patch(PosConfig.prototype, {
    get posSwVersion() {
        return odoo.info?.server_version || this._server_version.server_version;
    },
});
