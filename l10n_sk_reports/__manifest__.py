{
    'name': 'Slovakia - Accounting Reports',
    'icon': '/account/static/description/l10n.png',
    'description': """
Accounting reports for Slovakia
=====================================
This module includes accounting reports for Slovakia, including:
-Balance Sheet + Profit and Loss (XML export)
    """,
    'category': 'Accounting/Localizations/Reporting',
    'depends': ['l10n_sk', 'account_reports'],
    'data': [
        'data/annual_statements_menuitem.xml',
        'data/balance_sheet.xml',
        'data/profit_loss.xml',
        'data/annual_statements.xml',
        'data/annual_statements_export.xml',
        'views/res_company_views.xml',
        'wizard/l10n_sk_generate_annual_statements_report.xml',
        'security/ir.model.access.csv',
    ],
    'demo': ['demo/demo_company.xml'],
    'auto_install': True,
    'author': 'Odoo S.A.',
    'license': 'OEEL-1',
}
