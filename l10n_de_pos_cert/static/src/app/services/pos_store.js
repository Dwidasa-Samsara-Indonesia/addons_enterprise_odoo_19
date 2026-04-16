import { CONSOLE_COLOR, PosStore } from "@point_of_sale/app/services/pos_store";
import { logPosMessage } from "@point_of_sale/app/utils/pretty_console_log";
import { patch } from "@web/core/utils/patch";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { ask } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { _t } from "@web/core/l10n/translation";
import { roundCurrency } from "@point_of_sale/app/models/utils/currency";
import { uuidv4 } from "@point_of_sale/utils";

const RATE_ID_MAPPING = {
    1: "NORMAL",
    2: "REDUCED_1",
    3: "SPECIAL_RATE_1",
    4: "SPECIAL_RATE_2",
    5: "NULL",
};

patch(PosStore.prototype, {
    // @Override
    async setup() {
        this.token = "";
        this.vatRateMapping = {};
        this.validateOrderFree = false;
        await super.setup(...arguments);
    },
    // @Override
    async _onBeforeDeleteOrder(order) {
        await this.handleFiskalyCancellation(order);
        return super._onBeforeDeleteOrder(...arguments);
    },
    //@Override
    async afterProcessServerData() {
        if (this.isCountryGermanyAndFiskaly()) {
            const data = await this.data.call("pos.config", "l10n_de_get_fiskaly_urls_and_keys", [
                this.config.id,
            ]);

            this.company.l10n_de_fiskaly_api_key = data["api_key"];
            this.company.l10n_de_fiskaly_api_secret = data["api_secret"];
            this.useKassensichvVersion2 = this.config.l10n_de_fiskaly_tss_id.includes("|");
            this.apiUrl =
                data["kassensichv_url"] + "/api/v" + (this.useKassensichvVersion2 ? "2" : "1"); // use correct version
            this.initVatRates(data["dsfinvk_url"] + "/api/v0");
        }
        return super.afterProcessServerData(...arguments);
    },
    _authenticate() {
        const data = {
            api_key: this.company.l10n_de_fiskaly_api_key,
            api_secret: this.company.l10n_de_fiskaly_api_secret,
        };

        return fetch(this.getApiUrl() + "/auth", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
            .then((response) => response.json())
            .then((data) => {
                this.setApiToken(data.access_token);
            })
            .catch((error) => {
                error.source = "authenticate";
                return Promise.reject(error);
            });
    },
    async createTransaction(order) {
        const transactionUuid = uuidv4();
        const data = {
            state: "ACTIVE",
            client_id: this.getClientId(),
        };
        const payload = `${transactionUuid}${this.isUsingApiV2() ? "?tx_revision=1" : ""}`;
        await this.transactionCall(payload, data, order);
        // Success
        order.l10n_de_fiskaly_transaction_uuid = transactionUuid;
        order.transactionStarted();
    },
    _createAmountPerVatRateArray(order) {
        const expectedBase = order.prices.taxDetails.base_amount;
        let baseAmountSum = 0;
        const result = order.prices.taxDetails.subtotals[0].tax_groups.map((group) => {
            const amount = parseFloat((group.tax_amount + group.base_amount) * order.orderSign);
            baseAmountSum += group.base_amount;
            const tax_id = Object.values(group.involved_tax_ids)[0];
            let tax_amount = 0;
            if (tax_id) {
                tax_amount = this.data.models["account.tax"].get(tax_id).amount;
            }
            return {
                vat_rate: roundCurrency(tax_amount, this.currency).toString(),
                amount: amount.toFixed(5),
            };
        });

        // Adjustments (e.g., gift cards, tips) may lack tax info, default it to 0% to avoid mismatches.
        const difference = parseFloat(
            (expectedBase + order.requiredSettlementAmount() - baseAmountSum) * order.orderSign
        );
        if (difference) {
            const existingNullEntry = result.find((item) => item.vat_rate === "0");
            if (existingNullEntry) {
                existingNullEntry.amount = roundCurrency(
                    parseFloat(existingNullEntry.amount) + difference,
                    this.currency
                ).toFixed(2);
            } else {
                result.push({
                    vat_rate: "0",
                    amount: roundCurrency(difference, this.currency).toFixed(2),
                });
            }
        }
        return result;
    },
    async finishShortTransaction(order) {
        const amountPerVatRateArray = this._createAmountPerVatRateArray(order);
        const amountPerPaymentTypeArray = order._createAmountPerPaymentTypeArray();
        const data = {
            state: "FINISHED",
            client_id: this.getClientId(),
            schema: {
                standard_v1: {
                    receipt: {
                        receipt_type: "RECEIPT",
                        amounts_per_vat_rate: amountPerVatRateArray,
                        amounts_per_payment_type: amountPerPaymentTypeArray,
                    },
                },
            },
        };
        const payload = `${order.l10n_de_fiskaly_transaction_uuid}?${
            this.isUsingApiV2() ? "tx_revision=2" : "last_revision=1"
        }`;
        const result = await this.transactionCall(payload, data, order);
        // Success
        if (!order.uiState.fiskalyServerError) {
            order._updateTssInfo(result);
        }
    },
    async cancelTransaction(order) {
        const data = {
            state: "CANCELLED",
            client_id: this.getClientId(),
            schema: {
                standard_v1: {
                    receipt: {
                        receipt_type: "CANCELLATION",
                        amounts_per_vat_rate: [],
                    },
                },
            },
        };
        const payload = `${order.l10n_de_fiskaly_transaction_uuid}?${
            this.isUsingApiV2() ? "tx_revision=2" : "last_revision=1"
        }`;
        return await this.transactionCall(payload, data, order);
    },
    async transactionCall(payload, data, order, retryCount = 0) {
        let token = this.getApiToken();
        try {
            if (!token) {
                await this._authenticate();
                token = this.getApiToken();
            }
            const response = await fetch(
                `${this.getApiUrl()}/tss/${this.getTssId()}/tx/${payload}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    method: "PUT",
                    body: JSON.stringify(data),
                }
            );
            const result = await response.json();
            if (!response.ok) {
                let errorCode;
                try {
                    errorCode = await this.handleRequestError(result, order, retryCount);
                } catch {
                    // Non-retryable error (e.g. revision conflict, terminal state mismatch).
                    // For API v2, GET the current transaction state and recover if possible.
                    if (this.isUsingApiV2()) {
                        return await this._handleTransactionStateConflict(payload, data, order);
                    }
                    throw result;
                }
                if (errorCode === "retry") {
                    return await this.transactionCall(payload, data, order, retryCount + 1);
                }
            }
            return result;
        } catch (error) {
            // Need to reject to keep track of rejected orders in syncAllOrders
            // don't show popup for single order failures, it should be handled later in syncAllOrders
            logPosMessage("Store", "transactionCall", "Error", CONSOLE_COLOR, [error]);
            return Promise.reject(error);
        }
    },
    /**
     * Called when a PUT to Fiskaly fails with a non-retryable error (revision conflict or
     * "transaction already CANCELLED/FINISHED"). GETs the actual transaction state and resolves
     * the conflict based on what we were trying to do (data.state) vs what Fiskaly has:
     *
     * - Cancelling a transaction that is already CANCELLED → ignore, nothing to do
     * - Finishing a transaction that is already FINISHED → return the existing data so the
     *   caller can update the order's TSS info
     * - Finishing a transaction that is CANCELLED (cancelled externally, e.g. by another session
     *   closing) → create a fresh transaction and finish it
     */
    async _handleTransactionStateConflict(payload, data, order) {
        const txId = payload.split("?")[0];
        try {
            const token = this.getApiToken();
            const response = await fetch(`${this.getApiUrl()}/tss/${this.getTssId()}/tx/${txId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                method: "GET",
            });
            if (response.ok) {
                const tx = await response.json();
                if (data.state === "CANCELLED" && tx.state === "CANCELLED") {
                    return tx;
                }
                if (data.state === "FINISHED") {
                    if (tx.state === "FINISHED") {
                        return tx;
                    }
                    if (tx.state === "CANCELLED") {
                        await this.createTransaction(order);
                        return await this.transactionCall(
                            `${order.l10n_de_fiskaly_transaction_uuid}?tx_revision=2`,
                            data,
                            order
                        );
                    }
                }
            }
        } catch {
            // GET failed — fall through and reject
        }
        return Promise.reject(data);
    },
    async handleRequestError(result, order, retryCount) {
        if (result.status_code === 401) {
            if (!retryCount) {
                await this._authenticate();
                return "retry";
            }
        } else if (result.status_code >= 500 && result.status_code <= 599) {
            if (retryCount < 2) {
                const delay = (retryCount + 1) * 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
                return "retry";
            } else {
                // while closing remained active orders on fiskaly no orders will be available in odoo
                if (order) {
                    order.fiskalyServerError = true; // server unreachable after retries
                }
                return;
            }
        }
        // Need for keeping track of rejected orders in syncAllOrders
        return Promise.reject(result);
    },
    async addLineToCurrentOrder(vals, opts = {}, configure = true) {
        if (!this.isCountryGermanyAndFiskaly()) {
            return await super.addLineToCurrentOrder(vals, opts, configure);
        }
        const order = this.getOrder();
        // If same product added multiple times it will be better to check before adding line if there was an empty order or not
        const isNewOrder = order.isEmpty();
        const newLine = await super.addLineToCurrentOrder(vals, opts, configure);
        if (isNewOrder && order.isTransactionInactive()) {
            try {
                await this.createTransaction(order);
            } catch (error) {
                this.fiskalyError(error);
                return false;
            }
        }
        return newLine;
    },
    async handleFiskalyCancellation(order) {
        try {
            if (this.isCountryGermanyAndFiskaly() && order.isTransactionStarted()) {
                await this.cancelTransaction(order);
            }
        } catch (error) {
            this.fiskalyError(error);
            return false;
        }
    },
    async cancelActiveTransactions(retryCount = 0) {
        let token = this.getApiToken();
        try {
            if (!token) {
                await this._authenticate();
                token = this.getApiToken();
            }
            // fetch all active transactions
            const url = new URL(`${this.getApiUrl()}/tx`);
            url.searchParams.append("states[]", "ACTIVE");
            const response = await fetch(url.toString(), {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });
            const result = await response.json();
            if (!response.ok) {
                return await this.handleRequestError(result, false, retryCount);
            }

            // cancel all active transactions
            if (result.data.length) {
                const data = {
                    state: "CANCELLED",
                    client_id: this.getClientId(),
                    schema: {
                        standard_v1: {
                            receipt: {
                                receipt_type: "CANCELLATION",
                                amounts_per_vat_rate: [],
                            },
                        },
                    },
                };
                for (const transaction of result.data) {
                    const payload = `${transaction._id}?tx_revision=2`;
                    await this.transactionCall(payload, data, false);
                }
            }
        } catch (error) {
            // Need to reject to keep track of rejected orders in syncAllOrders
            // don't show popup for single order failures, it should be handled later in syncAllOrders
            this.fiskalyError(error);
        }
    },
    getApiToken() {
        return this.token;
    },
    setApiToken(token) {
        this.token = token;
    },
    getApiUrl() {
        return this.apiUrl;
    },
    getApiKey() {
        return this.company.l10n_de_fiskaly_api_key;
    },
    getApiSecret() {
        return this.company.l10n_de_fiskaly_api_secret;
    },
    getTssId() {
        return (
            this.config.l10n_de_fiskaly_tss_id && this.config.l10n_de_fiskaly_tss_id.split("|")[0]
        );
    },
    getClientId() {
        return this.config.l10n_de_fiskaly_client_id;
    },
    isUsingApiV2() {
        return this.useKassensichvVersion2;
    },
    isCountryGermany() {
        return this.config.is_company_country_germany;
    },
    isCountryGermanyAndFiskaly() {
        return this.isCountryGermany() && !!this.getTssId();
    },
    initVatRates(url) {
        const data = {
            api_key: this.getApiKey(),
            api_secret: this.getApiSecret(),
        };

        return fetch(url + "/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error("Auth request failed");
                }
                return response.json();
            })
            .then((data) =>
                fetch(url + "/vat_definitions", {
                    headers: { Authorization: `Bearer ${data.access_token}` },
                })
            )
            .then((response) => {
                if (!response.ok) {
                    throw new Error("VAT definitions request failed");
                }
                return response.json();
            })
            .then((vat_data) => {
                vat_data.data.forEach((vat_definition) => {
                    if (!(vat_definition.percentage in this.vatRateMapping)) {
                        this.vatRateMapping[vat_definition.percentage] =
                            RATE_ID_MAPPING[vat_definition.vat_definition_export_id];
                    }
                });
            })
            .catch((error) => {
                logPosMessage("Store", "initVatRates", "Error fetching VAT data", CONSOLE_COLOR, [
                    error,
                ]);
                // This is a fallback where we hardcode the taxes hoping that they didn't change ...
                this.vatRateMapping = {
                    19: "NORMAL",
                    7: "REDUCED_1",
                    10.7: "SPECIAL_RATE_1",
                    5.5: "SPECIAL_RATE_2",
                    0: "NULL",
                };
            });
    },
    //@Override
    /**
     * This function first attempts to send the orders remaining in the queue to Fiskaly before trying to
     * send it to Odoo. Two cases can happen:
     * - Failure to send to Fiskaly => we assume that if one order fails, EVERY order will fail
     * - Failure to send to Odoo => the order is already sent to Fiskaly, we store them locally with the TSS info
     */
    async syncAllOrders(options = {}) {
        if (!this.isCountryGermanyAndFiskaly()) {
            return super.syncAllOrders(options);
        }

        const { orderToCreate, orderToUpdate } = this.getPendingOrder();
        const orders = [...orderToCreate, ...orderToUpdate];

        if (orders.length === 0 || this.data.network.offline) {
            orders.forEach((order) => {
                order.uiState.networkError = true;
            });
            return super.syncAllOrders({ ...options, orders });
        }

        const orderObjectMap = {};
        for (const order of orders) {
            orderObjectMap[order.id] = order;
        }

        let fiskalyError;
        const sentToFiskaly = [];
        const fiskalyFailure = [];
        const ordersToUpdate = {};
        for (const order of orders) {
            try {
                const orderObject = orderObjectMap[order.id];
                if (
                    !fiskalyError &&
                    !orderObject.uiState.fiskalyServerError &&
                    !orderObject.uiState.networkError
                ) {
                    if (orderObject.isTransactionInactive()) {
                        await this.createTransaction(orderObject);
                        ordersToUpdate[order.id] = true;
                    }
                    if (orderObject.isTransactionStarted() && !this.config.module_pos_restaurant) {
                        // In restaurant only finish the transaction at validation not every time we order
                        await this.finishShortTransaction(order);
                        ordersToUpdate[order.id] = true;
                    }
                }
                if (
                    !orderObject.isTransactionInactive() ||
                    orderObject.uiState.fiskalyServerError ||
                    orderObject.uiState.networkError
                ) {
                    sentToFiskaly.push(order);
                } else {
                    fiskalyFailure.push(order);
                }
            } catch (error) {
                fiskalyError = error;
                fiskalyError.code = "fiskaly";
                fiskalyFailure.push(order);
            }
        }

        let result, odooError;
        if (sentToFiskaly.length > 0) {
            for (const orderJson of sentToFiskaly) {
                if (ordersToUpdate[orderJson["id"]]) {
                    orderJson["data"] = orderObjectMap[orderJson["id"]].raw;
                }
            }
            try {
                result = await super.syncAllOrders({ ...options, orders });
            } catch (error) {
                odooError = error;
            }
        }
        if (fiskalyFailure.length === 0 && !odooError) {
            return result;
        } else {
            if (Object.keys(ordersToUpdate).length) {
                for (const orderJson of fiskalyFailure) {
                    if (ordersToUpdate[orderJson["id"]]) {
                        orderJson["data"] = orderObjectMap[orderJson["id"]].raw;
                    }
                }
            }
            throw odooError || fiskalyError;
        }
    },
    async fiskalyError(error, message = {}) {
        if (error.status === 0 || this.data.network.offline) {
            const title = _t("No internet");
            const body = _t(
                "Check the internet connection then try to validate(sync) or cancel the order. " +
                    "Do not delete your browsing, cookies and cache data in the meantime!"
            );
            this.dialog.add(AlertDialog, { title, body });
        } else if (error.status_code === 401) {
            await this._showUnauthorizedPopup();
        } else if (
            (error.status_code === 400 && error.message?.includes("tss_id")) ||
            (error.status_code === 404 && error.code === "E_TSS_NOT_FOUND")
        ) {
            await this._showBadRequestPopup("TSS ID");
        } else if (
            (error.status_code === 400 && error.message?.includes("client_id")) ||
            (error.status_code === 400 && error.code === "E_CLIENT_NOT_FOUND")
        ) {
            // the api is actually sending an 400 error for a "Not found" error
            await this._showBadRequestPopup("Client ID");
        } else {
            const title = error.error || _t("Unknown error");
            const body =
                error.message ||
                _t(
                    "An unknown error has occurred! Try to validate this order or cancel it again. " +
                        "Please contact Odoo for more information."
                );
            this.dialog.add(AlertDialog, { title, body });
        }
    },
    async showFiskalyNoInternetConfirmPopup(event) {
        // This function is not used anymore
        const confirmed = await ask(this.dialog, {
            title: _t("Problem with internet"),
            body: _t(
                "You can either wait for the connection issue to be resolved or continue with a non-compliant receipt (the order will still be sent to Fiskaly once the connection issue is resolved).\n" +
                    "Do you want to continue with a non-compliant receipt?"
            ),
        });
        if (confirmed) {
            event.detail();
        }
    },
    async _showBadRequestPopup(data) {
        const title = _t("Bad request");
        const body = _t("Your %s is incorrect. Update it in your PoS settings", data);
        this.dialog.add(AlertDialog, { title, body });
    },
    async _showUnauthorizedPopup() {
        const title = _t("Unauthorized error to Fiskaly");
        const body = _t(
            "It seems that your Fiskaly API key and/or secret are incorrect. Update them in your company settings."
        );
        this.dialog.add(AlertDialog, { title, body });
    },
    async _processSaleOrder(sale_order) {
        if (
            sale_order.partner_id &&
            this.isCountryGermanyAndFiskaly() &&
            (!sale_order.partner_id.street || !sale_order.partner_id.zip)
        ) {
            return this.dialog.add(ConfirmationDialog, {
                title: _t("Invalid or missing customer information"),
                body: _t(
                    "The customer of the selected sale order must have a street and ZIP code.\nUpdate the customer's details to continue."
                ),
            });
        }
        return super._processSaleOrder(sale_order);
    },
});
