import { registry } from '@web/core/registry';

registry.category("web_tour.tours").add("hr_contract_salary_hidden_simulation_offer_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "Open Recruitment App",
            trigger: ".o_app:contains('Recruitment')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Open Applications Menu",
            trigger: ".o_menu_sections button.dropdown-toggle:contains('Applications')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Open Offers",
            trigger: ".dropdown-item:contains('Offers')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Check that list is empty initially",
            trigger: ".o_nocontent_help",
            run: () => {},
        },
        {
            content: "Go back to Home",
            trigger: ".o_menu_toggle, .o_menu_brand",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Open Payroll App",
            trigger: ".o_app:contains('Payroll')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Open Employees Menu",
            trigger: ".o_menu_sections button.dropdown-toggle:contains('Employees')", 
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Click Salary Calculator",
            trigger: ".dropdown-item:contains('Salary Calculator')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Enter salary amount",
            trigger: "#final_yearly_costs_0", 
            run: "edit 123456789",
            tooltipPosition: "bottom",
        },
        {
            content: "Focus footer (ensure blur on input)",
            trigger: ".o_technical_modal footer",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Click Close Button",
            trigger: ".o_technical_modal footer button:contains('Close')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Go back to Home",
            trigger: ".o_menu_toggle, .o_menu_brand",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Open Recruitment App",
            trigger: ".o_app:contains('Recruitment')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Open Applications Menu",
            trigger: ".o_menu_sections button.dropdown-toggle:contains('Applications')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Open Offers",
            trigger: ".dropdown-item:contains('Offers')",
            run: "click",
            tooltipPosition: "bottom",
        },
        {
            content: "Ensure simulation offer is hidden",
            trigger: ".o_nocontent_help",
            run: () => {},
        },
    ]
});
